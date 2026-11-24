#!/usr/bin/env node
/**
 * Fast local gate for the dsh-famling package (WP-B release gating, layer 1).
 *
 * This is the cheap half of the release gate: offline, zero-dependency, a few
 * seconds, and it stops at the first failing step. `check-release.mjs` wraps it
 * with the slower/authoritative release checks (packing, manifest drift,
 * prepublish invariants, bundle measurement).
 *
 * Steps, in order:
 *   1. node scripts/check-jsdoc.mjs                  (syntax + JSDoc/lint gate)
 *   2. node scripts/typecheck.mjs                   (self-skips when tsc absent)
 *   3. node scripts/embed-anims.mjs --check         (generated anim blocks)
 *   4. node scripts/gen-content-constants.mjs --check
 *   5. node scripts/verify-dsh.mjs                  (SKIP when absent: WP-A
 *      artifact; the merged package runs it for real)
 *   6. node --test <explicit test/*.test.js files>
 *
 * The test files are enumerated with readdirSync and passed as explicit argv
 * entries instead of relying on a shell glob, so the gate behaves identically
 * in cmd.exe, PowerShell, bash and CI runners.
 *
 * Usage:
 *   node scripts/check-fast.mjs              # full fast gate
 *   node scripts/check-fast.mjs --no-tests   # skip step 6 while iterating
 *   node scripts/check-fast.mjs --json       # machine-readable result
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute plugin package root (the parent of scripts/). */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Stable schema version of the --json payload. */
export const SCHEMA_VERSION = 1
/** Per-step wall-clock budget; the full test suite is the slowest step (~4s). */
export const STEP_TIMEOUT_MS = 300_000
/** How many trailing output lines are kept when a step fails. */
export const OUTPUT_TAIL_LINES = 40

/**
 * Keep only the trailing lines of a captured child output.
 * @param {unknown} value Captured stdout/stderr text.
 * @param {number} [maxLines] Line budget; defaults to OUTPUT_TAIL_LINES.
 * @returns {string} Trimmed tail (empty string when there was no output).
 */
export function outputTail(value, maxLines = OUTPUT_TAIL_LINES) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trimEnd()
  if (text === '') return ''
  const parts = text.split('\n')
  return parts.length <= maxLines ? parts.join('\n') : parts.slice(-maxLines).join('\n')
}

/**
 * Detect a step that reports its own skip on stdout, e.g. typecheck.mjs.
 * @param {string} text Captured child output.
 * @returns {string|null} The skip line, or null when the step did real work.
 */
export function detectSelfSkip(text) {
  const match = String(text ?? '').match(/^\[[^\]\n]+\]\s+skipped:.*$/m)
  return match ? match[0].trim() : null
}

/**
 * List the top-level test/*.test.js files in stable order.
 * @param {string} [root] Package root.
 * @returns {string[]} Package-relative POSIX paths (empty when test/ is absent).
 */
export function listTestFiles(root = PLUGIN_ROOT) {
  const directory = join(resolve(root), 'test')
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => 'test/' + entry.name)
    .sort()
}

/**
 * Describe the gate steps for one root (pure; no child processes are spawned).
 * @param {{ root?: string, noTests?: boolean }} [options] Root + --no-tests flag.
 * @returns {object[]} Step descriptors consumed by runStep().
 */
export function buildSteps(options = {}) {
  const root = resolve(options.root ?? PLUGIN_ROOT)
  const noTests = options.noTests === true
  const steps = [
    { id: 'jsdoc', label: 'check-jsdoc.mjs', script: 'scripts/check-jsdoc.mjs', args: [] },
    { id: 'typecheck', label: 'typecheck.mjs', script: 'scripts/typecheck.mjs', args: [] },
    { id: 'embed-anims', label: 'embed-anims.mjs --check', script: 'scripts/embed-anims.mjs', args: ['--check'] },
    { id: 'content-constants', label: 'gen-content-constants.mjs --check', script: 'scripts/gen-content-constants.mjs', args: ['--check'] },
    {
      id: 'verify-dsh',
      label: 'verify-dsh.mjs',
      script: 'scripts/verify-dsh.mjs',
      args: [],
      optionalPath: 'scripts/verify-dsh.mjs',
      missingSkipReason: 'scripts/verify-dsh.mjs is not present in this checkout (WP-A artifact); the merged package runs it for real',
    },
  ]
  steps.push({
    id: 'tests',
    label: 'node --test test/*.test.js',
    kind: 'tests',
    testFiles: listTestFiles(root),
    skipReason: noTests ? '--no-tests requested' : null,
  })
  return steps
}

function stepResult(step, fields) {
  return {
    id: step.id,
    label: step.label,
    status: fields.status,
    exitCode: fields.exitCode ?? null,
    durationMs: fields.durationMs,
    skipReason: fields.skipReason ?? null,
    outputTail: fields.outputTail ?? '',
  }
}

function skippedResult(step, startedAt, reason) {
  return stepResult(step, { status: 'skip', exitCode: null, durationMs: Date.now() - startedAt, skipReason: reason })
}

/**
 * Run one step with spawnSync and normalize the result.
 * @param {object} step Step descriptor from buildSteps().
 * @param {{ root?: string, node?: string, timeoutMs?: number }} [options] Execution options.
 * @returns {{ id: string, label: string, status: string, exitCode: number|null, durationMs: number, skipReason: string|null, outputTail: string }}
 */
export function runStep(step, options = {}) {
  const root = resolve(options.root ?? PLUGIN_ROOT)
  const node = options.node ?? process.execPath
  const timeoutMs = options.timeoutMs ?? STEP_TIMEOUT_MS
  const startedAt = Date.now()
  if (typeof step.skipReason === 'string' && step.skipReason !== '') return skippedResult(step, startedAt, step.skipReason)
  if (typeof step.optionalPath === 'string' && !existsSync(join(root, step.optionalPath))) {
    return skippedResult(step, startedAt, String(step.missingSkipReason ?? 'optional script is absent'))
  }
  let argv
  if (step.kind === 'tests') {
    if (!Array.isArray(step.testFiles) || step.testFiles.length === 0) {
      return stepResult(step, { status: 'fail', durationMs: Date.now() - startedAt, outputTail: 'no test/*.test.js files found in ' + root })
    }
    argv = ['--test', ...step.testFiles]
  } else {
    argv = [join(root, step.script), ...(step.args ?? [])]
  }
  const result = spawnSync(node, argv, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  const durationMs = Date.now() - startedAt
  const combined = [result.stdout, result.stderr].filter((value) => typeof value === 'string' && value !== '').join('\n')
  const shared = { exitCode: result.status ?? null, durationMs }
  if (result.error) {
    return stepResult(step, { ...shared, status: 'fail', outputTail: outputTail([result.error.message, combined].filter(Boolean).join('\n')) })
  }
  if (result.status !== 0) {
    return stepResult(step, { ...shared, status: 'fail', outputTail: outputTail(combined) || 'exited with code ' + String(result.status) })
  }
  const skipped = detectSelfSkip(combined)
  if (skipped !== null) return stepResult(step, { ...shared, status: 'skip', skipReason: skipped })
  return stepResult(step, { ...shared, status: 'pass' })
}

function printStep(result, position, total, stdout, stderr) {
  const prefix = '[check-fast] ' + position + '/' + total
  if (result.status === 'pass') {
    stdout(prefix + ' PASS ' + result.label + ' (' + result.durationMs + 'ms)')
    return
  }
  if (result.status === 'skip') {
    stdout(prefix + ' SKIP ' + result.label + (result.skipReason ? ' - ' + result.skipReason : ''))
    return
  }
  stderr(prefix + ' FAIL ' + result.label + ' (exit ' + String(result.exitCode) + ', ' + result.durationMs + 'ms)')
  if (result.outputTail !== '') {
    stderr('[check-fast] --- output tail ---')
    for (const line of result.outputTail.split('\n')) stderr(line)
  }
}

/**
 * Run the fast gate. Pure orchestration over runStep(); every child output is
 * captured, so --json stays machine-readable.
 * @param {{ root?: string, noTests?: boolean, timeoutMs?: number, node?: string, json?: boolean, stdout?: (line: string) => void, stderr?: (line: string) => void }} [options] Options.
 * @returns {object} Result payload ({ ok, steps, durationMs, ... }).
 */
export function runCheckFast(options = {}) {
  const root = resolve(options.root ?? PLUGIN_ROOT)
  const noTests = options.noTests === true
  const node = options.node ?? process.execPath
  const timeoutMs = options.timeoutMs ?? STEP_TIMEOUT_MS
  const json = options.json === true
  const stdout = options.stdout ?? ((line) => console.log(line))
  const stderr = options.stderr ?? ((line) => console.error(line))
  const startedAt = Date.now()
  const specs = buildSteps({ root, noTests })
  const steps = []
  let failed = null
  for (let index = 0; index < specs.length; index += 1) {
    const result = runStep(specs[index], { root, node, timeoutMs })
    steps.push(result)
    if (!json) printStep(result, index + 1, specs.length, stdout, stderr)
    if (result.status === 'fail') {
      failed = result
      break
    }
  }
  const durationMs = Date.now() - startedAt
  const passCount = steps.filter((step) => step.status === 'pass').length
  const skipCount = steps.filter((step) => step.status === 'skip').length
  const ok = failed === null
  if (!json) {
    if (ok) stdout('[check-fast] OK (' + passCount + ' pass, ' + skipCount + ' skip, ' + steps.length + ' steps, ' + durationMs + 'ms)')
    else stderr('[check-fast] FAILED at ' + failed.label + ' (' + passCount + ' pass, ' + skipCount + ' skip, ' + steps.length + ' of ' + specs.length + ' steps ran, ' + durationMs + 'ms)')
  }
  return {
    tool: 'check-fast',
    schemaVersion: SCHEMA_VERSION,
    ok,
    root,
    noTests,
    testFiles: listTestFiles(root),
    durationMs,
    steps,
  }
}

const USAGE = [
  'Usage: node scripts/check-fast.mjs [--no-tests] [--json] [--root DIR] [--timeout-ms N]',
  '  --no-tests     skip the node --test step',
  '  --json         print one machine-readable JSON object (no human lines)',
  "  --root DIR     package root to gate (default: this script's package)",
  '  --timeout-ms   per-step timeout in milliseconds (default: 300000)',
]

/**
 * CLI entry point.
 * @param {string[]} argv Arguments after the script name.
 * @param {{ stdout?: (line: string) => void, stderr?: (line: string) => void }} [io] Output sinks.
 * @returns {number} 0 ok / 1 a step failed / 2 usage error.
 */
export function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((line) => console.log(line))
  const stderr = io.stderr ?? ((line) => console.error(line))
  const options = { json: false, noTests: false, root: PLUGIN_ROOT, timeoutMs: STEP_TIMEOUT_MS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      for (const line of USAGE) stdout(line)
      return 0
    } else if (arg === '--json') options.json = true
    else if (arg === '--no-tests') options.noTests = true
    else if (arg === '--root' || arg === '--timeout-ms') {
      const value = argv[index + 1]
      index += 1
      if (value === undefined || value === '') { stderr('[check-fast] ' + arg + ' requires a value') ; return 2 }
      if (arg === '--root') options.root = resolve(value)
      else {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed <= 0) { stderr('[check-fast] --timeout-ms requires a positive number') ; return 2 }
        options.timeoutMs = Math.round(parsed)
      }
    } else {
      stderr('[check-fast] unknown argument: ' + arg)
      for (const line of USAGE) stderr(line)
      return 2
    }
  }
  if (!existsSync(options.root)) {
    stderr('[check-fast] root does not exist: ' + options.root)
    return 2
  }
  try {
    const result = runCheckFast({
      root: options.root,
      noTests: options.noTests,
      timeoutMs: options.timeoutMs,
      json: options.json,
      stdout,
      stderr,
    })
    if (options.json) stdout(JSON.stringify(result))
    return result.ok ? 0 : 1
  } catch (error) {
    stderr('[check-fast] error: ' + (error instanceof Error ? error.message : String(error)))
    return 2
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(runCli(process.argv.slice(2)))
