/**
 * MB-004: clean-checkout rebuild gate tests.
 *
 * Pins the plugin-only checkout evidence: a reproducible package-lock LOCK, a
 * vendored animation spec that verifies the committed chunks without the
 * private famling repository, docs for both, and the `scripts/clean-checkout.mjs`
 * gate itself (copied temp checkout + full test/release-gate run).
 *
 * Inside the clean-checkout copy the child test suite is started with
 * DSH_FAMLING_STANDALONE_CHILD=1, so this file registers only the static
 * LOCK/spec checks there instead of spawning another checkout (no recursion).
 * The parent `npm test` run executes the real rebuild and the public-repo
 * export staging checks.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { LOCKFILE_NAME, loadLockfile, lockProblems, staticReport } from '../scripts/check-package.mjs'
import { SPEC_RELATIVE_PATH, readAnimationSpec, validateEmbeddedAgainstSpec } from '../scripts/anim-spec.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEEP_CHECKOUT = join(ROOT, 'scripts', 'clean-checkout.mjs')
const IS_CHILD = process.env.DSH_FAMLING_STANDALONE_CHILD === '1'
const REBUILD_DOC = join(ROOT, 'docs', 'INDEPENDENT-REBUILD-2026-11-20.md')
const SYNC_DOC = join(ROOT, 'docs', 'PUBLIC-REPO-SYNC-2026-11-20.md')

test('package-lock.json is a committed root-only install LOCK', () => {
  const lock = loadLockfile(ROOT)
  assert.ok(lock, LOCKFILE_NAME + ' is committed')
  assert.equal(lock.lockfileVersion, 3, 'lockfileVersion 3')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(lock.name, pkg.name, 'lock name matches package.json')
  assert.equal(lock.version, pkg.version, 'lock version matches package.json')
  assert.deepEqual(Object.keys(lock.packages), [''], 'dependency-free package => root-only lock (no private/local package entries)')
  assert.deepEqual(lockProblems(ROOT), [], 'the release gate accepts the committed lock')
})

test('vendored spec and clean-checkout docs/scripts are committed', () => {
  const { spec } = readAnimationSpec(ROOT)
  const embedded = validateEmbeddedAgainstSpec({ pluginRoot: ROOT, spec })
  assert.equal(embedded.ok, true, embedded.errors.join('; '))
  assert.ok(existsSync(DEEP_CHECKOUT), 'scripts/clean-checkout.mjs exists')
  assert.ok(existsSync(REBUILD_DOC), 'docs/INDEPENDENT-REBUILD-2026-11-20.md exists')
  assert.ok(existsSync(SYNC_DOC), 'docs/PUBLIC-REPO-SYNC-2026-11-20.md exists')
  const rebuildDoc = readFileSync(REBUILD_DOC, 'utf8')
  for (const needle of ['MB-004', 'package-lock.json', 'anim-spec.json', 'clean-checkout.mjs', 'standalone spec mode', 'private repo']) {
    assert.ok(rebuildDoc.includes(needle), 'rebuild doc mentions ' + needle)
  }
  const syncDoc = readFileSync(SYNC_DOC, 'utf8')
  for (const needle of ['PerryLink/dsh-famling', 'package-lock.json', 'clean-checkout.mjs --export', 'git push', 'external']) {
    assert.ok(syncDoc.includes(needle), 'sync doc mentions ' + needle)
  }
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.ok(readme.includes('INDEPENDENT-REBUILD-2026-11-20.md'), 'README links the independent-rebuild doc')
  assert.ok(readme.includes('PUBLIC-REPO-SYNC-2026-11-20.md'), 'README links the public-repo sync doc')
  const hygiene = readFileSync(join(ROOT, 'docs', 'RELEASE-HYGIENE.md'), 'utf8')
  assert.ok(hygiene.includes('package-lock.json'), 'RELEASE-HYGIENE documents the LOCK')
  assert.ok(hygiene.includes('clean-checkout.mjs'), 'RELEASE-HYGIENE documents the clean-checkout gate')
})

if (IS_CHILD) {
  test('standalone child checkout: static LOCK/spec gates only (parent runs the rebuild)', () => {
    assert.equal(process.env.DSH_FAMLING_STANDALONE_CHILD, '1', 'child marker is set by scripts/clean-checkout.mjs')
    assert.deepEqual(lockProblems(ROOT), [], 'child copy keeps the committed lock valid')
    const { spec } = readAnimationSpec(ROOT)
    const result = validateEmbeddedAgainstSpec({ pluginRoot: ROOT, spec })
    assert.equal(result.ok, true, 'child copy keeps the vendored spec green: ' + result.errors.join('; '))
    assert.equal(result.stats.frames, 208, 'child copy still validates 208 frames from the vendored spec')
  })
} else {
  /** Run the clean-checkout CLI in JSON mode and parse its summary. */
  function runCleanCheckout(args, timeout = 240000) {
    const result = spawnSync(process.execPath, [DEEP_CHECKOUT, ...args], { cwd: ROOT, encoding: 'utf8', timeout })
    assert.equal(result.error, undefined, 'clean-checkout spawn failed: ' + String(result.error))
    assert.equal(result.status, 0, 'clean-checkout exited ' + result.status + ': ' + (result.stderr || result.stdout).slice(-2000))
    const lines = result.stdout.trim().split('\n').filter((line) => line.startsWith('{'))
    assert.equal(lines.length, 1, 'clean-checkout --json prints exactly one JSON line')
    return JSON.parse(lines[0])
  }

  test('a plugin-only checkout rebuilds and verifies without the private repo', () => {
    const summary = runCleanCheckout(['--json'])
    assert.equal(summary.ok, true, 'clean-checkout problems: ' + JSON.stringify(summary.problems))
    assert.equal(summary.mode, 'temp-checkout', 'temp checkout mode')
    assert.ok(summary.privateRootsForcedAbsent.endsWith('__no_private_repo__'), 'private roots are forced absent')
    assert.ok(!summary.privateRootsForcedAbsent.includes('desktop-games'), 'no real private checkout path is used')
    assert.ok(summary.files.count >= 60, 'checkout copies the full package (' + summary.files.count + ' files)')
    assert.ok(Array.isArray(summary.files.skipped) && summary.files.skipped.every((name) => name === 'node_modules' || name === '.git'), 'only dev artifacts were skipped when copying, got ' + JSON.stringify(summary.files.skipped))
    assert.equal(summary.test.fail, 0, 'clean checkout test failures: ' + summary.test.fail)
    assert.ok(summary.test.pass >= 200, 'clean checkout pass count ' + summary.test.pass)
    assert.equal(summary.test.skipped, summary.test.skipReasons.length, 'every skipped test reports a parseable reason')
    assert.equal(summary.test.skipped, 10, 'the 10 remaining standalone skips are the documented cross-repo famling parity checks')
    for (const reason of summary.test.skipReasons) assert.match(reason, /famling/i, 'cross-repo skip only: ' + reason)
    assert.equal(summary.gates.npmCi, 'offline lock install ok', 'npm ci works offline from package-lock.json')
    assert.equal(summary.gates.embed, 'standalone spec mode', 'embed --check uses the vendored spec, not private assets')
    assert.equal(summary.gates.verify, 'ok', 'verify-anims passes against the vendored spec')
    assert.equal(summary.gates.checkScript, 'npm run check ok', 'the package check script runs standalone')
    assert.equal(summary.gates.contentConstants, 'static block check ok', 'content-constants static fallback')
    assert.equal(summary.gates.package, 'pack ok', 'check-package --pack works standalone')
    assert.equal(summary.gates.jsdoc, 'ok', 'check-jsdoc works standalone')
    assert.ok(['checkJs ok', 'honest skip (no TypeScript in checkout)'].includes(summary.gates.typecheck), 'typecheck is real or an honest skip: ' + summary.gates.typecheck)
    assert.ok(summary.steps.every((step) => step.ok), 'every gate step exited 0')
    for (const name of ['npm-ci', 'node-test', 'embed-anims-check', 'verify-anims', 'check-script', 'check-package', 'check-jsdoc', 'typecheck']) {
      assert.ok(summary.steps.some((step) => step.name === name && step.ok), 'gate step ran and passed: ' + name)
    }
  })

  test('public-repo export stages a self-sufficient tree with static gates green', () => {
    const parent = mkdtempSync(join(tmpdir(), 'dsh-famling-export-test-'))
    const destination = join(parent, 'repo')
    try {
      const summary = runCleanCheckout(['--export', destination, '--json'])
      assert.equal(summary.ok, true, 'export problems: ' + JSON.stringify(summary.problems))
      assert.equal(summary.mode, 'export', 'export mode')
      assert.equal(summary.steps.length, 2, 'static package + vendored spec checks ran on the exported tree')
      assert.ok(summary.steps.every((step) => step.ok), 'exported tree gates are green')
      assert.ok(summary.instructions.some((line) => line.includes('git init -b main')), 'first-push instructions include git init')
      assert.ok(summary.instructions.some((line) => line.includes('https://github.com/PerryLink/dsh-famling.git')), 'first-push instructions point at the canonical repository')
      assert.ok(summary.instructions.some((line) => line.includes('EXTERNAL step')), 'push is marked external (not executed)')
      const required = [
        'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'index.js', 'client.js',
        'content-extension.mjs', 'scripts/spec/anim-spec.json', 'scripts/clean-checkout.mjs',
        'scripts/anim-spec.mjs', 'test/clean-checkout.test.js', 'test/anim-spec.test.js',
        'docs/INDEPENDENT-REBUILD-2026-11-20.md', 'docs/PUBLIC-REPO-SYNC-2026-11-20.md',
      ]
      for (const file of required) assert.ok(existsSync(join(destination, file)), 'export contains ' + file)
      assert.equal(existsSync(join(destination, '.git')), false, 'export has no .git')
      assert.equal(existsSync(join(destination, 'node_modules')), false, 'export has no node_modules')
      assert.equal(readdirSync(destination).some((file) => file.endsWith('.tgz')), false, 'export has no tarballs')
      const pkg = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'))
      assert.equal(pkg.repository.url, 'git+https://github.com/PerryLink/dsh-famling.git', 'exported metadata points at the public repository')
      assert.deepEqual(staticReport(destination).problems, [], 'exported tree passes the static package + LOCK gate')
      const { spec } = readAnimationSpec(destination)
      const embedded = validateEmbeddedAgainstSpec({ pluginRoot: destination, spec })
      assert.equal(embedded.ok, true, 'exported tree validates its committed animation artifacts: ' + embedded.errors.join('; '))
      assert.equal(embedded.stats.frames, 208, 'exported tree verifies 208 frames')
      assert.ok(statSync(join(destination, 'package-lock.json')).size > 100, 'exported LOCK is a real file')
    } finally {
      const absolute = resolve(parent)
      const tempRoot = resolve(tmpdir())
      assert.ok(absolute.startsWith(tempRoot + sep) && absolute !== tempRoot, 'export test cleanup stays inside the temp dir')
      rmSync(absolute, { recursive: true, force: true })
    }
  })
}
