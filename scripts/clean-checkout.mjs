#!/usr/bin/env node
/**
 * Clean-checkout rebuild gate (MB-004): prove dsh-famling rebuilds, tests and
 * verifies in an isolated plugin-only checkout with NO private famling repo.
 *
 * The plugin ships every animation frame inside its own lazy chunks, but the
 * development-time generators historically read the sibling private famling
 * checkout. This gate copies the package into a fresh temporary directory,
 * points every private-root environment override at a nonexistent path, runs
 * the reproducible install LOCK (`npm ci --offline`), the full test suite, and
 * each release gate, then asserts the standalone evidence:
 *
 *   - `npm ci` succeeds offline from the committed package-lock.json;
 *   - `node --test test/*.test.js` has 0 failures and the only skips are the
 *     documented cross-repo `famling` parity checks (no private asset/character
 *     skips remain - those are now covered by the vendored anim spec);
 *   - `embed-anims --check` runs in `standalone spec mode` and matches the
 *     vendored spec (a missing/tampered spec is a hard failure, never a skip);
 *   - `verify-anims` validates the vendored spec and reports `private assets:
 *     absent` instead of skipping its byte-level cross-check;
 *   - `gen-content-constants --check` falls back to the static marker check;
 *   - `check-package --pack`, `check-jsdoc` and an honest `typecheck` pass;
 *   - no `.git`/`node_modules`/tarballs exist in the copied checkout.
 *
 * Usage:
 *   node scripts/clean-checkout.mjs                  # temp checkout + all gates (deleted afterwards)
 *   node scripts/clean-checkout.mjs --keep           # keep the temp checkout, print its path
 *   node scripts/clean-checkout.mjs --json           # machine-readable JSON summary only
 *   node scripts/clean-checkout.mjs --export DIR     # stage a public-repo tree + static gates
 *   node scripts/clean-checkout.mjs --export DIR --verify  # staged tree + the full gate run
 *
 * This script never commits, pushes or writes to the source checkout. The
 * public-repo export is a staging step: first-push git commands are printed but
 * deliberately not executed by this workspace agent.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { staticReport } from './check-package.mjs'

/** Absolute plugin package root (the source checkout that must stay untouched). */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Temp checkout directory prefix; the cleanup guard only removes this prefix. */
export const TEMP_PREFIX = 'dsh-famling-standalone-'
/** File/dir names that are development artifacts, never part of a checkout. */
const COPY_SKIP_NAMES = new Set(['node_modules', '.git', '.cache', '.DS_Store', 'npm-debug.log', '.npm'])

/** Resolve a path to POSIX-style relative form for messages. */
function rel(root, file) { return file.slice(root.length + 1).split(sep).join('/') }

/** True when a source path must not be copied into a checkout/export. */
function shouldSkip(source) {
  const name = basename(source)
  return COPY_SKIP_NAMES.has(name) || name.endsWith('.tgz')
}

/** Recursively list files under a root (absolute paths, sorted). */
function listFiles(root) {
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(absolute))
    else if (entry.isFile()) out.push(absolute)
  }
  return out.sort()
}

/**
 * Copy the plugin package into a destination directory, skipping dev artifacts.
 * @param {string} destination Absolute destination directory (created).
 * @param {{ source?: string }} [options] Source root override (tests).
 * @returns {{ files: string[], bytes: number, skipped: string[] }} Copy inventory.
 */
export function copyCheckout(destination, options = {}) {
  const source = options.source || PLUGIN_ROOT
  mkdirSync(destination, { recursive: true })
  const skipped = []
  cpSync(source, destination, {
    recursive: true,
    filter: (candidate) => {
      if (candidate === source) return true
      if (shouldSkip(candidate)) { skipped.push(candidate); return false }
      return true
    },
  })
  const files = listFiles(destination)
  let bytes = 0
  for (const file of files) bytes += statSync(file).size
  return { files: files.map((file) => rel(destination, file)), bytes, skipped }
}

/**
 * Guard for recursive deletion: only temp dirs created by this script may be
 * removed (workspace red line: deletion must be dry-run/verified first).
 * @param {string} directory Absolute candidate.
 * @returns {string} The resolved directory when safe.
 */
export function assertSafeTempDir(directory) {
  const absolute = resolve(directory)
  const root = resolve(tmpdir())
  if (absolute === root || !absolute.startsWith(root + sep) || !basename(absolute).startsWith(TEMP_PREFIX)) {
    throw new Error('refusing to delete non-script temp directory: ' + absolute)
  }
  return absolute
}

/**
 * Environment for a standalone child: every private-root override points at a
 * path that cannot exist, so a hidden private dependency fails loudly.
 * @param {string} checkout Absolute checkout root.
 * @returns {Record<string, string>} Child environment.
 */
export function privateEnv(checkout) {
  const absent = join(checkout, '__no_private_repo__')
  return {
    ...process.env,
    FAMLING_ANIM_DIR: absent,
    FAMLING_CHARACTERS_DIR: absent,
    FAMLING_REPO_DIR: absent,
    FAMLING_PRIVATE_REPO_ABSENT: absent,
  }
}

/**
 * Run one gate command, capturing both streams.
 * @param {string} name Step name.
 * @param {string} command Executable.
 * @param {string[]} args Arguments.
 * @param {{ cwd: string, env: Record<string, string>, shell?: boolean }} options Spawn options.
 * @returns {{ name: string, ok: boolean, status: number|null, ms: number, stdout: string, stderr: string, command: string }} Step result.
 */
export function runStep(name, command, args, options) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: 180000,
    shell: options.shell === true && process.platform === 'win32',
    maxBuffer: 16 * 1024 * 1024,
  })
  return {
    name,
    command: [command, ...args].join(' '),
    ok: result.status === 0,
    status: result.status,
    ms: Date.now() - started,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  }
}

/**
 * Parse the node --test summary (tests/pass/fail/skipped) and every skip line.
 * @param {string} stdout Test runner output.
 * @returns {{ tests: number, pass: number, fail: number, skipped: number, durationMs: number, skipReasons: string[] }} Summary.
 */
export function parseTestSummary(stdout) {
  const number = (name) => {
    const match = new RegExp('(?:^|\\n)\\u2139 ' + name + ' (\\d+)').exec(stdout)
    return match ? Number(match[1]) : 0
  }
  const skipReasons = []
  for (const line of stdout.split('\n')) {
    const skipped = /^\s*﹣ (.+?) \(.+?\) # (.+)$/.exec(line)
    if (skipped) skipReasons.push(skipped[2].trim())
    else {
      const tap = /^not ok \d+ (.+?) # SKIP (.+)$/.exec(line.trim())
      if (tap) skipReasons.push(tap[2].trim())
    }
  }
  return { tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped'), durationMs: number('duration_ms'), skipReasons }
}

/** Resolve the npm CLI name for this platform. */
function npmCommand() { return process.platform === 'win32' ? 'npm.cmd' : 'npm' }

/**
 * Run the full standalone gate list in one copied checkout.
 * @param {string} checkout Absolute checkout directory.
 * @returns {{ steps: any[], test: any, gates: Record<string, string>, problems: string[] }} Evidence.
 */
export function runStandaloneGates(checkout) {
  const env = privateEnv(checkout)
  const childEnv = { ...env, DSH_FAMLING_STANDALONE_CHILD: '1' }
  // When this gate is spawned from inside `node --test` (test/clean-checkout.test.js),
  // the parent runner exports NODE_TEST_CONTEXT; a nested test-runner process would
  // then behave as a child reporter instead of printing the normal summary. Drop it so
  // the copied checkout runs the suite exactly like a plain `npm test` invocation.
  delete childEnv.NODE_TEST_CONTEXT
  const testFiles = readdirSync(join(checkout, 'test'))
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => join('test', file))
  const steps = []
  steps.push(runStep('npm-ci', npmCommand(), ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: checkout, env, shell: true }))
  steps.push(runStep('node-test', process.execPath, ['--test', ...testFiles], { cwd: checkout, env: childEnv }))
  steps.push(runStep('embed-anims-check', process.execPath, ['scripts/embed-anims.mjs', '--check'], { cwd: checkout, env }))
  steps.push(runStep('verify-anims', process.execPath, ['scripts/verify-anims.mjs'], { cwd: checkout, env }))
  // Run the package's own `check` script so any gate wired into it later
  // (i18n, generated single-source checks, ...) is exercised in the clean
  // checkout too, without duplicating the script wiring here.
  steps.push(runStep('check-script', npmCommand(), ['run', 'check'], { cwd: checkout, env, shell: true }))
  steps.push(runStep('check-package', process.execPath, ['scripts/check-package.mjs', '--pack'], { cwd: checkout, env }))
  steps.push(runStep('check-jsdoc', process.execPath, ['scripts/check-jsdoc.mjs'], { cwd: checkout, env }))
  steps.push(runStep('typecheck', process.execPath, ['scripts/typecheck.mjs'], { cwd: checkout, env }))
  const byName = Object.fromEntries(steps.map((step) => [step.name, step]))
  const test = parseTestSummary(byName['node-test'].stdout)
  const gates = {
    npmCi: byName['npm-ci'].ok ? 'offline lock install ok' : 'FAILED',
    embed: /standalone spec mode/.test(byName['embed-anims-check'].stdout) ? 'standalone spec mode' : 'private-asset mode',
    verify: /\[verify-anims\] OK/.test(byName['verify-anims'].stdout) ? 'ok' : 'FAILED',
    checkScript: byName['check-script'].ok ? 'npm run check ok' : 'FAILED',
    contentConstants: /static block check ok/.test(byName['check-script'].stdout) ? 'static block check ok' : 'FAILED',
    package: /check-package: pack ok/.test(byName['check-package'].stdout) ? 'pack ok' : 'FAILED',
    jsdoc: /\[check-jsdoc\] ok/.test(byName['check-jsdoc'].stdout) ? 'ok' : 'FAILED',
    typecheck: /checkJs ok/.test(byName['typecheck'].stdout) ? 'checkJs ok' : (/skipped: TypeScript is not installed here/.test(byName['typecheck'].stdout) ? 'honest skip (no TypeScript in checkout)' : 'FAILED'),
  }
  const problems = []
  for (const step of steps) if (!step.ok) problems.push(step.name + ' failed (exit ' + step.status + '): ' + (step.stderr.trim().split('\n').slice(-4).join(' / ') || step.stdout.trim().split('\n').slice(-2).join(' / ')))
  if (test.fail !== 0) problems.push('test suite has ' + test.fail + ' failure(s)')
  if (test.pass < 200) problems.push('test suite pass count is suspiciously low (' + test.pass + ')')
  if (test.skipped !== test.skipReasons.length) problems.push('could not parse all skip lines (' + test.skipped + ' skipped, ' + test.skipReasons.length + ' reasons)')
  for (const reason of test.skipReasons) {
    if (!/famling/i.test(reason)) problems.push('unexpected standalone skip (not a cross-repo famling check): ' + reason)
  }
  if (gates.embed !== 'standalone spec mode') problems.push('embed --check did not run in standalone spec mode (private assets unexpectedly found?)')
  if (!byName['check-script'].ok) problems.push('npm run check failed in the clean checkout')
  if (!/vendored spec:/.test(byName['verify-anims'].stdout)) problems.push('verify-anims did not report the vendored spec')
  if (!/private assets: absent/.test(byName['verify-anims'].stdout)) problems.push('verify-anims did not report the absent private assets')
  if (/skipped byte-level source cross-check/.test(byName['verify-anims'].stdout)) problems.push('verify-anims still skips its cross-check instead of using the vendored spec')
  if (!/lockfileVersion 3/.test(byName['check-package'].stdout)) problems.push('check-package did not report lockfileVersion 3')
  if (gates.typecheck === 'FAILED') problems.push('typecheck failed')
  return { steps, test, gates, problems }
}

/** Look for development artifacts that must never reach a public-repo export. */
function exportProblems(destination) {
  const problems = []
  const files = listFiles(destination)
  const relative = files.map((file) => rel(destination, file))
  for (const forbidden of ['node_modules', '.git', '.cache', '.DS_Store', 'npm-debug.log']) {
    if (existsSync(join(destination, forbidden))) problems.push('export contains development artifact: ' + forbidden)
  }
  for (const file of relative) {
    if (file.endsWith('.tgz')) problems.push('export contains tarball: ' + file)
    if (/^node_modules\//.test(file)) problems.push('export contains node_modules file: ' + file)
    if (/^\.git\//.test(file)) problems.push('export contains .git file: ' + file)
  }
  for (const required of ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'index.js', 'client.js', 'content-extension.mjs', 'scripts/spec/anim-spec.json', 'scripts/clean-checkout.mjs', 'test/clean-checkout.test.js', 'docs/INDEPENDENT-REBUILD-2026-11-20.md']) {
    if (!relative.includes(required)) problems.push('export is missing required file: ' + required)
  }
  const report = staticReport(destination)
  for (const problem of report.problems) problems.push('export static package check: ' + problem)
  return { problems, fileCount: relative.length, bytes: files.reduce((sum, file) => sum + statSync(file).size, 0) }
}

/** First-push instructions printed for a staged public-repo export (not executed). */
function exportInstructions(destination) {
  return [
    'cd ' + destination,
    'git init -b main',
    'git add .',
    'git status --short          # inspect the first-commit file list (no node_modules/.git/tarballs)',
    'npm ci --offline && npm test && node scripts/embed-anims.mjs --check && node scripts/verify-anims.mjs',
    'npm run check && npm run verify:package && node scripts/check-jsdoc.mjs && node scripts/typecheck.mjs',
    'git commit -m "chore: standalone plugin checkout (MB-004)"',
    'git remote add origin https://github.com/PerryLink/dsh-famling.git',
    'git push -u origin main    # EXTERNAL step: not executed by the workspace agent',
  ]
}

/** Parse CLI arguments. */
function parseArgs(argv) {
  const options = { keep: false, json: false, export: null, verify: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--keep') options.keep = true
    else if (arg === '--json') options.json = true
    else if (arg === '--verify') options.verify = true
    else if (arg === '--export') {
      const value = argv[index + 1]
      if (!value) throw new Error('--export requires a directory')
      options.export = resolve(value)
      index += 1
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('unknown argument: ' + arg)
  }
  return options
}

/** Print a human summary for a gate result. */
function printHuman(summary) {
  console.log('[clean-checkout] mode: ' + summary.mode)
  console.log('[clean-checkout] checkout: ' + summary.checkout)
  console.log('[clean-checkout] private roots forced absent: ' + summary.privateRootsForcedAbsent)
  console.log('[clean-checkout] copied files: ' + summary.files.count + ' (' + (summary.files.bytes / 1024).toFixed(1) + ' KiB)')
  for (const step of summary.steps) console.log('[clean-checkout] ' + (step.ok ? 'ok  ' : 'FAIL') + ' ' + step.name + ' (' + step.ms + ' ms)')
  if (summary.test) {
    console.log('[clean-checkout] tests: ' + summary.test.pass + ' pass / ' + summary.test.fail + ' fail / ' + summary.test.skipped + ' cross-repo skip (' + summary.test.durationMs + ' ms)')
    for (const reason of summary.test.skipReasons) console.log('[clean-checkout]   skip: ' + reason)
  }
  console.log('[clean-checkout] gates: ' + JSON.stringify(summary.gates))
  if (summary.instructions) for (const line of summary.instructions) console.log('[clean-checkout] next: ' + line)
  if (summary.problems.length > 0) {
    for (const problem of summary.problems) console.error('[clean-checkout] FAIL: ' + problem)
  } else {
    console.log('[clean-checkout] OK: ' + (summary.mode === 'export' ? 'public-repo export staged and verified' : 'plugin-only checkout rebuilds and verifies without the private repo'))
  }
}

/** CLI entry point. */
async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error('[clean-checkout] ' + error.message)
    process.exitCode = 1
    return
  }
  if (options.help) {
    console.log('usage: node scripts/clean-checkout.mjs [--keep] [--json] [--export DIR [--verify]]')
    return
  }
  const started = Date.now()
  try {
    if (options.export) {
      const destination = options.export
      if (existsSync(destination) && readdirSync(destination).length > 0) throw new Error('--export destination must be missing or empty: ' + destination)
      const copy = copyCheckout(destination)
      const exportCheck = exportProblems(destination)
      const problems = [...exportCheck.problems]
      let steps = []
      let test = null
      let gates = { staticPackageCheck: 'ok' }
      let privateRootsForcedAbsent = join(destination, '__no_private_repo__')
      if (options.verify) {
        const evidence = runStandaloneGates(destination)
        steps = evidence.steps
        test = evidence.test
        gates = evidence.gates
        privateRootsForcedAbsent = join(destination, '__no_private_repo__')
        for (const problem of evidence.problems) problems.push(problem)
      } else {
        const staticCheck = runStep('export-static-check', process.execPath, ['scripts/check-package.mjs'], { cwd: destination, env: privateEnv(destination) })
        steps = [staticCheck]
        if (!staticCheck.ok) problems.push('exported tree failed check-package: ' + staticCheck.stderr.trim())
        const specCheck = runStep('export-spec-check', process.execPath, ['scripts/embed-anims.mjs', '--check'], { cwd: destination, env: privateEnv(destination) })
        steps.push(specCheck)
        if (!specCheck.ok) problems.push('exported tree failed standalone spec check: ' + specCheck.stderr.trim())
      }
      const summary = {
        ok: problems.length === 0,
        mode: 'export',
        checkout: destination,
        privateRootsForcedAbsent,
        files: { count: copy.files.length, bytes: copy.bytes },
        steps,
        test,
        gates,
        instructions: exportInstructions(destination),
        durationMs: Date.now() - started,
        problems,
      }
      if (options.json) console.log(JSON.stringify(summary))
      else printHuman(summary)
      if (problems.length > 0) process.exitCode = 1
      return
    }
    const checkout = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
    const copy = copyCheckout(checkout)
    const problems = []
    if (existsSync(join(checkout, '.git'))) problems.push('copied checkout contains .git')
    if (existsSync(join(checkout, 'node_modules'))) problems.push('copied checkout contains node_modules')
    const evidence = runStandaloneGates(checkout)
    for (const problem of evidence.problems) problems.push(problem)
    const summary = {
      ok: problems.length === 0,
      mode: 'temp-checkout',
      checkout,
      privateRootsForcedAbsent: join(checkout, '__no_private_repo__'),
      files: { count: copy.files.length, bytes: copy.bytes, skipped: copy.skipped.map((source) => basename(source)) },
      steps: evidence.steps,
      test: evidence.test,
      gates: evidence.gates,
      instructions: [
        'npm run release:check  # still runs in the source checkout (add this gate when package.json allows)',
      ],
      durationMs: Date.now() - started,
      problems,
    }
    if (!options.keep) rmSync(assertSafeTempDir(checkout), { recursive: true, force: true })
    else summary.kept = checkout
    if (options.json) console.log(JSON.stringify(summary))
    else printHuman(summary)
    if (problems.length > 0) process.exitCode = 1
  } catch (error) {
    console.error('[clean-checkout] ' + error.message)
    process.exitCode = 1
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) await main()
