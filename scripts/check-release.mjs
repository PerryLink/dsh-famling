#!/usr/bin/env node
/**
 * Authoritative release gate for the dsh-famling package (WP-B, layer 2).
 *
 * `check-fast.mjs` is the cheap inner loop; this file adds the release-only
 * evidence a tarball consumer depends on:
 *
 *   1. check-fast.mjs            (syntax/JSDoc, generated blocks, full test suite)
 *   2. verify-anims.mjs          (chunk/frame integrity)
 *   3. check-package.mjs --pack  (metadata + npm pack inventory equality)
 *   4. plugin-manifest.mjs --check (committed manifest drift)
 *   5. prepublish-check.mjs      (offline 'breaks after install' invariants)
 *   6. measure-bundle.mjs        (information only - never fails on a size
 *      warning; a non-zero exit is still a failure)
 *
 * Steps run in order and the gate stops at the first failure. Every child's
 * output is captured; failures print only a bounded tail. `--no-tests` is
 * forwarded to check-fast for quick release rehearsal.
 *
 * Usage:
 *   node scripts/check-release.mjs             # full release gate
 *   node scripts/check-release.mjs --no-tests  # rehears mode (skips the suite)
 *   node scripts/check-release.mjs --json      # machine-readable result
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PLUGIN_ROOT as FAST_ROOT, STEP_TIMEOUT_MS as FAST_STEP_TIMEOUT_MS, listTestFiles, outputTail, runCheckFast } from './check-fast.mjs'

/** Absolute plugin package root (the parent of scripts/). */
export const PLUGIN_ROOT = FAST_ROOT
/** Stable schema version of the --json payload. */
export const SCHEMA_VERSION = 1
/** Per-step wall-clock budget; check-fast already bounds its own steps. */
export const RELEASE_STEP_TIMEOUT_MS = 600_000

/**
 * Describe the release steps (pure; no child processes are spawned).
 * @param {{ noTests?: boolean }} [options] Forwarded --no-tests flag.
 * @returns {{ id: string, label: string, script: string, args: string[], informational?: boolean, parsesJson?: boolean }[]} Step descriptors.
 */
export function buildReleaseSteps(options = {}) {
  return [
    { id: 'check-fast', label: 'check-fast.mjs', script: 'scripts/check-fast.mjs', args: options.noTests === true ? ['--no-tests', '--json'] : ['--json'], internal: 'check-fast' },
    { id: 'verify-anims', label: 'verify-anims.mjs', script: 'scripts/verify-anims.mjs', args: [] },
    { id: 'check-package', label: 'check-package.mjs --pack', script: 'scripts/check-package.mjs', args: ['--pack'] },
    { id: 'plugin-manifest', label: 'plugin-manifest.mjs --check', script: 'scripts/plugin-manifest.mjs', args: ['--check'] },
    { id: 'prepublish-check', label: 'prepublish-check.mjs', script: 'scripts/prepublish-check.mjs', args: ['--json'], parsesJson: true },
    { id: 'measure-bundle', label: 'measure-bundle.mjs', script: 'scripts/measure-bundle.mjs', args: [], informational: true },
  ]
}

function baseStep(step, result) {
  return {
    id: step.id,
    label: step.label,
    status: result.status,
    informational: step.informational === true && result.status === 'pass',
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    skipReason: result.skipReason,
    outputTail: result.outputTail,
    detail: null,
    data: null,
  }
}

function failingTail(result) {
  if (result.status !== 'fail') return ''
  return result.outputTail
}

/**
 * Spawn one release step and capture its stdout (needed by --json parsing).
 * @param {object} step Step descriptor.
 * @param {{ root: string, node: string, timeoutMs: number }} context Execution context.
 * @returns {object} Step result with an extra `stdout` string.
 */
function spawnReleaseStep(step, context) {
  const startedAt = Date.now()
  const script = join(context.root, step.script)
  if (!existsSync(script)) {
    return {
      id: step.id,
      label: step.label,
      status: 'fail',
      exitCode: null,
      durationMs: Date.now() - startedAt,
      skipReason: null,
      outputTail: 'required gate script is missing: ' + step.script,
      stdout: '',
    }
  }
  const result = spawnSync(context.node, [script, ...(step.args ?? [])], {
    cwd: context.root,
    encoding: 'utf8',
    timeout: context.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  const durationMs = Date.now() - startedAt
  const combined = [result.stdout, result.stderr].filter((value) => typeof value === 'string' && value !== '').join('\n')
  const base = { id: step.id, label: step.label, exitCode: result.status ?? null, durationMs, skipReason: null, stdout: String(result.stdout ?? '') }
  if (result.error) {
    return { ...base, status: 'fail', outputTail: outputTail([result.error.message, combined].filter(Boolean).join('\n')) }
  }
  if (result.status !== 0) return { ...base, status: 'fail', outputTail: outputTail(combined) || 'exited with code ' + String(result.status) }
  return { ...base, status: 'pass', outputTail: '' }
}

function parseJsonOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

function fastStepResult(fast) {
  const passCount = fast.steps.filter((step) => step.status === 'pass').length
  const skipCount = fast.steps.filter((step) => step.status === 'skip').length
  const failed = fast.steps.find((step) => step.status === 'fail') ?? null
  return {
    id: 'check-fast',
    label: 'check-fast.mjs',
    status: fast.ok ? 'pass' : 'fail',
    informational: false,
    exitCode: fast.ok ? 0 : 1,
    durationMs: fast.durationMs,
    skipReason: null,
    outputTail: failed === null ? '' : '[' + failed.label + ']\n' + failed.outputTail,
    detail: passCount + ' pass, ' + skipCount + ' skip, ' + fast.steps.length + ' steps',
    data: null,
  }
}

function printStep(result, position, total, stdout, stderr) {
  const prefix = '[check-release] ' + position + '/' + total
  if (result.status === 'pass') {
    const suffix = result.detail ? '; ' + result.detail : ''
    const info = result.informational ? ' (informational)' : ''
    stdout(prefix + ' PASS ' + result.label + ' (' + result.durationMs + 'ms' + suffix + ')' + info)
    return
  }
  stderr(prefix + ' FAIL ' + result.label + ' (exit ' + String(result.exitCode) + ', ' + result.durationMs + 'ms)')
  if (result.outputTail !== '') {
    stderr('[check-release] --- output tail ---')
    for (const line of result.outputTail.split('\n')) stderr(line)
  }
}

/**
 * Run the release gate. Stops at the first failing step.
 * @param {{ root?: string, noTests?: boolean, timeoutMs?: number, node?: string, json?: boolean, stdout?: (line: string) => void, stderr?: (line: string) => void }} [options] Options.
 * @returns {object} Result payload ({ ok, steps, durationMs, ... }).
 */
export function runCheckRelease(options = {}) {
  const root = resolve(options.root ?? PLUGIN_ROOT)
  const noTests = options.noTests === true
  const node = options.node ?? process.execPath
  const timeoutMs = options.timeoutMs ?? RELEASE_STEP_TIMEOUT_MS
  const json = options.json === true
  const stdout = options.stdout ?? ((line) => console.log(line))
  const stderr = options.stderr ?? ((line) => console.error(line))
  const startedAt = Date.now()
  const specs = buildReleaseSteps({ noTests })
  const steps = []
  let checkFast = null
  let failed = null
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index]
    let result
    let data = null
    if (spec.internal === 'check-fast') {
      const fast = runCheckFast({ root, noTests, timeoutMs: FAST_STEP_TIMEOUT_MS, node, json: true })
      checkFast = fast
      result = fastStepResult(fast)
    } else {
      const spawned = spawnReleaseStep(spec, { root, node, timeoutMs })
      result = baseStep(spec, spawned)
      if (spec.parsesJson === true && spawned.status === 'pass') {
        data = parseJsonOutput(spawned.stdout)
        if (data === null) {
          result.status = 'fail'
          result.outputTail = outputTail(spawned.stdout) || 'expected one JSON object on stdout'
        }
      }
      if (data !== null) {
        const checks = Array.isArray(data.checks) ? data.checks : []
        const okChecks = checks.filter((check) => check.ok === true).length
        const packing = data.packing ?? null
        const tarball = packing === null ? 'no packing report' : packing.tarballVerified === true ? 'tarball verified' : 'tarball NOT verified (fallback)'
        result.detail = okChecks + '/' + checks.length + ' checks, ' + tarball
        result.data = {
          ok: data.ok === true,
          checkCount: checks.length,
          failedChecks: checks.filter((check) => check.ok !== true).map((check) => check.id),
          packing,
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        }
      }
    }
    if (spec.informational === true && result.status === 'pass') result.informational = true
    steps.push(result)
    if (!json) printStep(result, index + 1, specs.length, stdout, stderr)
    if (!json && spec.parsesJson === true && result.data !== null) {
      for (const warning of result.data.warnings) stdout('[check-release] WARN ' + warning)
    }
    if (result.status === 'fail') {
      failed = result
      break
    }
  }
  const durationMs = Date.now() - startedAt
  const ok = failed === null
  if (!json) {
    if (ok) stdout('[check-release] OK (' + steps.length + ' steps, ' + durationMs + 'ms)')
    else stderr('[check-release] FAILED at ' + failed.label + ' (' + (steps.length - 1) + ' step(s) passed before it, ' + durationMs + 'ms)')
  }
  return {
    tool: 'check-release',
    schemaVersion: SCHEMA_VERSION,
    ok,
    root,
    noTests,
    durationMs,
    testFiles: listTestFiles(root),
    steps,
    checkFast,
  }
}

const USAGE = [
  'Usage: node scripts/check-release.mjs [--no-tests] [--json] [--root DIR] [--timeout-ms N]',
  '  --no-tests     forward --no-tests to check-fast (skip the test suite)',
  '  --json         print one machine-readable JSON object (no human lines)',
  "  --root DIR     package root to gate (default: this script's package)",
  '  --timeout-ms   per-step timeout in milliseconds (default: 600000)',
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
  const options = { json: false, noTests: false, root: PLUGIN_ROOT, timeoutMs: RELEASE_STEP_TIMEOUT_MS }
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
      if (value === undefined || value === '') { stderr('[check-release] ' + arg + ' requires a value'); return 2 }
      if (arg === '--root') options.root = resolve(value)
      else {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed <= 0) { stderr('[check-release] --timeout-ms requires a positive number'); return 2 }
        options.timeoutMs = Math.round(parsed)
      }
    } else {
      stderr('[check-release] unknown argument: ' + arg)
      for (const line of USAGE) stderr(line)
      return 2
    }
  }
  if (!existsSync(options.root)) {
    stderr('[check-release] root does not exist: ' + options.root)
    return 2
  }
  try {
    const result = runCheckRelease({
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
    stderr('[check-release] error: ' + (error instanceof Error ? error.message : String(error)))
    return 2
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(runCli(process.argv.slice(2)))
