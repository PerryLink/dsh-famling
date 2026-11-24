/**
 * WP-B release gating tests: check-fast / check-release / prepublish-check.
 *
 * The prepublish gate is exercised against the real package (npm pack happy
 * path) and against temporary mutated copies (each invariant must fail closed).
 * The check-fast/check-release orchestration is exercised against a stub root
 * (tiny fake gate scripts) so the tests do not re-run the full toolchain.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { buildReleaseSteps, runCheckRelease } from '../scripts/check-release.mjs'
import { buildSteps, runCheckFast } from '../scripts/check-fast.mjs'
import { TARBALL_BUDGET_BYTES, runPrePublishCheck } from '../scripts/prepublish-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PREPUBLISH_CLI = join(ROOT, 'scripts', 'prepublish-check.mjs')
const CHECK_FAST_CLI = join(ROOT, 'scripts', 'check-fast.mjs')
const BACKSLASH = String.fromCharCode(92)

/** Stable check id contract of prepublish-check --json. */
const EXPECTED_CHECK_IDS = [
  'pack-inventory',
  'exports-in-pack',
  'required-runtime',
  'forbidden-files',
  'size-budget',
  'cordis-patch',
  'client-module-ids',
  'version-truth',
  'locale-files',
  'icon',
  'private-paths',
]

function runJsonCli(script, args, timeout = 120000) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', timeout })
  let parsed = null
  try { parsed = JSON.parse(String(result.stdout ?? '').trim()) } catch { parsed = null }
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), json: parsed }
}

function failedCheckIds(result) {
  return result.checks.filter((check) => !check.ok).map((check) => check.id)
}

/** Copy the package to a temp dir (tests are skipped: they are not packaged). */
function makePackageCopy(t) {
  const parent = mkdtempSync(join(tmpdir(), 'dsh-famling-prepublish-'))
  const copy = join(parent, 'pkg')
  cpSync(ROOT, copy, {
    recursive: true,
    filter: (source) => {
      const rel = relative(ROOT, source)
      if (rel === '') return true
      const top = rel.split(sep)[0]
      return top !== 'test' && top !== '.git' && top !== 'node_modules'
    },
  })
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  return copy
}

/** Write a fake gate checkout: every script exits 0 unless overridden. */
function makeStubRoot(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-famling-gate-stub-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  const stubScripts = {
    'check-jsdoc.mjs': 'process.exit(0)\n',
    'typecheck.mjs': "console.log('[typecheck] skipped: TypeScript is not installed here')\n",
    'embed-anims.mjs': 'process.exit(0)\n',
    'gen-content-constants.mjs': 'process.exit(0)\n',
    'verify-anims.mjs': 'process.exit(0)\n',
    'check-package.mjs': 'process.exit(0)\n',
    'plugin-manifest.mjs': 'process.exit(0)\n',
    'prepublish-check.mjs': 'console.log(JSON.stringify({ ok: true, checks: [{ id: "stub-check", ok: true }], packing: { tarballVerified: true, source: "npm", reason: null }, warnings: [] }))\n',
    'measure-bundle.mjs': 'console.log("[measure-bundle] stub")' + '\n',
  }
  for (const [name, body] of Object.entries(stubScripts)) {
    writeFileSync(join(root, 'scripts', name), body)
  }
  if (options.failScript !== undefined) {
    writeFileSync(join(root, 'scripts', options.failScript), "console.error('stub failure detail'); process.exit(3)".replaceAll(';', '\n') + '\n')
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('prepublish-check CLI passes on the real package and prints stable JSON', () => {
  const run = runJsonCli(PREPUBLISH_CLI, ['--json'])
  assert.equal(run.status, 0, 'exit 0\n' + run.stderr)
  assert.ok(run.json !== null, 'stdout is one JSON object')
  assert.equal(run.json.tool, 'prepublish-check')
  assert.equal(run.json.schemaVersion, 1)
  assert.equal(run.json.ok, true)
  assert.deepEqual(run.json.checks.map((check) => check.id), EXPECTED_CHECK_IDS)
  for (const check of run.json.checks) assert.equal(check.ok, true, check.id + ': ' + check.problems.join('; '))
  assert.ok(['npm', 'fallback'].includes(run.json.packing.source), 'packing.source is npm or fallback')
  assert.equal(run.json.packing.tarballVerified, run.json.packing.source === 'npm')
  assert.ok(run.json.packing.packedBytes > 0, 'reports the packed byte total')
  assert.ok(Array.isArray(run.json.warnings) && Array.isArray(run.json.problems))
})

test('prepublish-check fallback never pretends the tarball was verified', () => {
  const run = runJsonCli(PREPUBLISH_CLI, ['--no-npm', '--json'])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.json.packing.source, 'fallback')
  assert.equal(run.json.packing.tarballVerified, false)
  assert.equal(typeof run.json.packing.reason, 'string')
  assert.ok(run.json.warnings.some((warning) => warning.includes('tarball NOT verified')), 'JSON warns that the tarball was not verified')
  const human = spawnSync(process.execPath, [PREPUBLISH_CLI, '--no-npm'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 })
  assert.equal(human.status, 0, human.stderr)
  assert.ok(human.stdout.includes('tarball NOT verified'), 'human output prints the fallback WARN')
  assert.ok(human.stdout.includes('WARN'), 'human output prints a WARN line for the fallback')
})

test('prepublish-check in-process API passes on the real package (allowlist expansion)', () => {
  const result = runPrePublishCheck({ root: ROOT, npm: false })
  assert.equal(result.ok, true, result.problems.join('; '))
  assert.deepEqual(result.checks.map((check) => check.id), EXPECTED_CHECK_IDS)
  assert.equal(result.packing.source, 'fallback')
  assert.equal(result.packing.tarballVerified, false)
  assert.ok(result.packing.fileCount > 0)
  assert.ok(result.warnings.some((warning) => warning.includes('files allowlist expansion')))
})

test('prepublish-check fails closed on an oversized icon', (t) => {
  const root = makePackageCopy(t)
  writeFileSync(join(root, 'icon.png'), Buffer.alloc(300 * 1024, 7))
  const result = runPrePublishCheck({ root, npm: false })
  assert.equal(result.ok, false)
  assert.ok(failedCheckIds(result).includes('icon'), 'icon check failed')
  const icon = result.checks.find((check) => check.id === 'icon')
  assert.ok(icon.problems.some((problem) => problem.includes('256 KiB')), 'icon problem names the 256 KiB budget')
})

test('prepublish-check fails closed when cordis.patch.yml is missing', (t) => {
  const root = makePackageCopy(t)
  rmSync(join(root, 'cordis.patch.yml'))
  const result = runPrePublishCheck({ root, npm: false })
  assert.equal(result.ok, false)
  const failed = failedCheckIds(result)
  assert.ok(failed.includes('cordis-patch'), 'cordis-patch check failed: ' + failed.join(','))
  assert.ok(failed.includes('pack-inventory'), 'pack-inventory check failed: ' + failed.join(','))
})

test('prepublish-check fails closed when an exports target is not packed', (t) => {
  const root = makePackageCopy(t)
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  pkg.exports['./missing'] = './missing.js'
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  const result = runPrePublishCheck({ root, npm: false })
  assert.equal(result.ok, false)
  const failed = failedCheckIds(result)
  assert.ok(failed.includes('exports-in-pack'), 'exports-in-pack check failed: ' + failed.join(','))
  const exportsCheck = result.checks.find((check) => check.id === 'exports-in-pack')
  assert.ok(exportsCheck.problems.some((problem) => problem.includes('./missing.js')), 'problem names the missing target')
})

test('prepublish-check fails closed on a leaked private absolute path', (t) => {
  const root = makePackageCopy(t)
  const readme = join(root, 'README.md')
  const leak = 'Maintainer note: D:' + BACKSLASH + 'Projects' + BACKSLASH + 'dsh' + BACKSLASH + 'secret.json'
  writeFileSync(readme, readFileSync(readme, 'utf8') + '\n' + leak + '\n')
  const result = runPrePublishCheck({ root, npm: false })
  assert.equal(result.ok, false)
  const failed = failedCheckIds(result)
  assert.ok(failed.includes('private-paths'), 'private-paths check failed: ' + failed.join(','))
  const privateCheck = result.checks.find((check) => check.id === 'private-paths')
  assert.ok(privateCheck.problems.some((problem) => problem.startsWith('README.md:')), 'problem names README.md')
  assert.ok(privateCheck.problems.some((problem) => problem.includes('windows-drive-path')), 'problem names the pattern id')
})

test('prepublish-check fails closed when the packed bytes exceed the budget', (t) => {
  const root = makePackageCopy(t)
  writeFileSync(join(root, 'docs', 'SIZE-BUDGET-PADDING.bin'), Buffer.alloc(TARBALL_BUDGET_BYTES, 1))
  const result = runPrePublishCheck({ root, npm: false })
  assert.equal(result.ok, false)
  const failed = failedCheckIds(result)
  assert.ok(failed.includes('size-budget'), 'size-budget check failed: ' + failed.join(','))
  const sizeCheck = result.checks.find((check) => check.id === 'size-budget')
  assert.ok(sizeCheck.problems.some((problem) => problem.includes('2 MiB budget')), 'problem names the budget')
})

test('check-fast reports PASS/SKIP steps, skips absent verify-dsh and --no-tests', (t) => {
  const root = makeStubRoot(t)
  const result = runCheckFast({ root, noTests: true, json: true })
  assert.equal(result.ok, true)
  assert.equal(result.tool, 'check-fast')
  assert.deepEqual(result.steps.map((step) => step.id), ['jsdoc', 'typecheck', 'embed-anims', 'content-constants', 'verify-dsh', 'tests'])
  assert.equal(result.steps[0].status, 'pass')
  assert.equal(result.steps[1].status, 'skip', 'self-reported typecheck skip is surfaced as SKIP')
  assert.ok(result.steps[1].skipReason.includes('TypeScript is not installed'))
  const verifyDsh = result.steps.find((step) => step.id === 'verify-dsh')
  assert.equal(verifyDsh.status, 'skip')
  assert.ok(verifyDsh.skipReason.includes('verify-dsh.mjs is not present'), 'SKIP reason explains the missing WP-A artifact')
  assert.equal(result.steps.find((step) => step.id === 'tests').status, 'skip')
  const specs = buildSteps({ root, noTests: true })
  assert.equal(specs.at(-1).kind, 'tests')
})

test('check-fast stops at the first failure and reports its output tail', (t) => {
  const root = makeStubRoot(t, { failScript: 'embed-anims.mjs' })
  const result = runCheckFast({ root, noTests: true, json: true })
  assert.equal(result.ok, false)
  assert.equal(result.steps.length, 3, 'later steps do not run')
  const failed = result.steps.at(-1)
  assert.equal(failed.id, 'embed-anims')
  assert.equal(failed.status, 'fail')
  assert.equal(failed.exitCode, 3)
  assert.ok(failed.outputTail.includes('stub failure detail'), 'output tail is captured')
})

test('check-release runs the ordered gate and flags measure-bundle as informational', (t) => {
  const root = makeStubRoot(t)
  const result = runCheckRelease({ root, noTests: true, json: true })
  assert.equal(result.ok, true)
  assert.equal(result.tool, 'check-release')
  assert.equal(result.schemaVersion, 1)
  assert.deepEqual(result.steps.map((step) => step.id), ['check-fast', 'verify-anims', 'check-package', 'plugin-manifest', 'prepublish-check', 'measure-bundle'])
  assert.equal(result.steps[0].status, 'pass')
  assert.equal(result.checkFast.ok, true)
  const prepublish = result.steps.find((step) => step.id === 'prepublish-check')
  assert.equal(prepublish.status, 'pass')
  assert.equal(prepublish.detail, '1/1 checks, tarball verified')
  assert.deepEqual(prepublish.data, { ok: true, checkCount: 1, failedChecks: [], packing: { tarballVerified: true, source: 'npm', reason: null }, warnings: [] })
  const measure = result.steps.find((step) => step.id === 'measure-bundle')
  assert.equal(measure.status, 'pass')
  assert.equal(measure.informational, true, 'measure-bundle is information only')
  assert.deepEqual(buildReleaseSteps({ noTests: true }).map((step) => step.id), ['check-fast', 'verify-anims', 'check-package', 'plugin-manifest', 'prepublish-check', 'measure-bundle'])
})

test('gate CLIs reject unknown arguments with exit code 2', () => {
  for (const script of [CHECK_FAST_CLI, PREPUBLISH_CLI]) {
    const run = spawnSync(process.execPath, [script, '--definitely-not-a-flag'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 })
    assert.equal(run.status, 2, script + ' exits 2 on a usage error')
    assert.ok(String(run.stderr).includes('unknown argument'), script + ' names the offending argument')
  }
})
