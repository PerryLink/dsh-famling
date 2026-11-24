#!/usr/bin/env node
/**
 * WP-A gate for scripts/verify-dsh.mjs: the offline DSH compatibility check.
 *
 * Proves the checker is honest in both directions: the committed package copy
 * passes every check, and a tampered copy (package manifest, patch, client
 * module id, icon limit, compatibility enum, private path, locale detail) fails
 * with the matching check id instead of silently passing. It also pins the
 * minimal SemVer comparator against the DSH engines semantics (prereleases take
 * part in matching, engines.dsh alone decides).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { compareSemver, satisfiesEngine } from '../scripts/verify-dsh.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts', 'verify-dsh.mjs')
const MERGED_ENGINE_RANGE = '>=0.2.1-rc.5 <0.3.0 || >=0.2.2-0 <0.3.0 || >=0.2.3-0 <0.3.0-0'

function runVerify(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000 })
}

function jsonReport(args) {
  const result = runVerify([...args, '--json'])
  const lines = String(result.stdout || '').split('\n').filter(function (line) { return line.startsWith('{') })
  assert.equal(lines.length, 1, 'verify-dsh --json prints exactly one JSON line, got: ' + String(result.stdout).slice(0, 400))
  return { status: result.status, report: JSON.parse(lines[0]) }
}

function failingIds(report) {
  return report.checks.filter(function (check) { return !check.ok }).map(function (check) { return check.id })
}

function assertCheckFails(report, ids) {
  const failed = failingIds(report)
  for (const id of ids) assert.ok(failed.indexOf(id) !== -1, 'expected check ' + id + ' to fail, failed checks: ' + failed.join(', '))
}

function withCopy(run) {
  const destination = mkdtempSync(join(tmpdir(), 'dsh-famling-verify-dsh-'))
  try {
    cpSync(ROOT, destination, {
      recursive: true,
      filter: function (source) {
        const name = source.split(/[\\/]/).pop()
        if (name === 'node_modules' || name === '.git' || name === '.cache') return false
        return !source.endsWith('.tgz')
      },
    })
    return run(destination)
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}

function mutateJson(file, mutate) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  mutate(data)
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

function verifyTamperedCopy(mutate) {
  return withCopy(function (destination) {
    mutate(destination)
    return jsonReport(['--root', destination])
  })
}

const PACKAGE_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

test('the committed package copy passes every verify-dsh check', function () {
  const { status, report } = jsonReport([])
  assert.equal(status, 0, 'verify-dsh exits 0 on the shipped copy: ' + JSON.stringify(failingIds(report)))
  assert.equal(report.ok, true)
  assert.equal(report.target, resolve(ROOT), 'target is the verified package root')
  assert.equal(report.dshVersion, null, 'no --dsh-version means no engine-target check')
  for (const check of report.checks) assert.equal(check.ok, true, check.id + ': ' + check.detail)
  const ids = report.checks.map(function (check) { return check.id })
  for (const id of ['package-name', 'package-main', 'package-icon', 'package-exports', 'patch-insert', 'dsh-client-platform', 'compat-matrix', 'engine-range', 'client-module-id', 'client-chunks', 'client-generated-blocks', 'locale-meta', 'locale-detail', 'hygiene', 'files-required']) {
    assert.ok(ids.indexOf(id) !== -1, 'report carries the ' + id + ' check')
  }
})

test('--json report has the documented shape', function () {
  const { status, report } = jsonReport([])
  assert.equal(status, 0)
  assert.deepEqual(Object.keys(report).sort(), ['checks', 'dshVersion', 'ok', 'target'])
  assert.equal(typeof report.ok, 'boolean')
  assert.equal(typeof report.target, 'string')
  assert.ok(Array.isArray(report.checks) && report.checks.length > 0)
  for (const check of report.checks) {
    assert.deepEqual(Object.keys(check).sort(), ['detail', 'id', 'ok'])
    assert.equal(typeof check.detail, 'string')
    assert.equal(typeof check.id, 'string')
    assert.equal(typeof check.ok, 'boolean')
  }
  assert.equal(report.ok, report.checks.every(function (check) { return check.ok }))
})

test('--dsh-version accepts every declared compatible release and the 0.2.x finals', function () {
  for (const version of ['0.2.2-rc.5', '0.2.3-alpha.1', '0.2.3-alpha.2', '0.2.2', '0.2.3']) {
    const { status, report } = jsonReport(['--dsh-version', version])
    assert.equal(status, 0, version + ' should pass: ' + JSON.stringify(failingIds(report)))
    assert.equal(report.dshVersion, version)
    const byId = Object.fromEntries(report.checks.map(function (check) { return [check.id, check.ok] }))
    assert.equal(byId['engine-range'], true, version + ' satisfies engines.dsh')
    assert.equal(byId['compat-version'], true, version + ' is compatible in the matrix or not listed')
  }
})

test('0.2.3-alpha.2 is accepted by the merged engines range (DSH prerelease semantics)', function () {
  assert.equal(satisfiesEngine('0.2.3-alpha.2', MERGED_ENGINE_RANGE), true)
  assert.equal(satisfiesEngine('0.2.3-alpha.2', '>=0.2.3-0 <0.3.0-0'), true)
  assert.equal(satisfiesEngine('0.3.0-alpha.1', MERGED_ENGINE_RANGE), false)
  assert.equal(satisfiesEngine('0.3.0', MERGED_ENGINE_RANGE), false)
  assert.equal(satisfiesEngine('0.2.1-rc.4', MERGED_ENGINE_RANGE), false)
})

test('--dsh-version outside engines.dsh fails the engine-range check', function () {
  for (const version of ['0.3.0', '0.2.1-rc.4', '1.0.0']) {
    const { status, report } = jsonReport(['--dsh-version', version])
    assert.equal(status, 1, version + ' should fail')
    assert.equal(report.ok, false)
    assertCheckFails(report, ['engine-range'])
  }
})

test('usage errors exit 2 and print the usage line', function () {
  const cases = [
    ['--dsh-version', 'not-semver'],
    ['--dsh-version'],
    ['--unknown-flag'],
    ['--root', join(tmpdir(), 'dsh-famling-verify-dsh-does-not-exist')],
  ]
  for (const args of cases) {
    const result = runVerify(args)
    assert.equal(result.status, 2, 'usage error exits 2 for ' + JSON.stringify(args) + ': ' + String(result.stderr).trim())
    assert.match(String(result.stderr), /usage:/)
  }
})

test('a --root copy passes on its own (verifies an arbitrary package copy)', function () {
  withCopy(function (destination) {
    const { status, report } = jsonReport(['--root', destination])
    assert.equal(status, 0, 'clean copy should pass: ' + JSON.stringify(failingIds(report)))
    assert.equal(report.target, resolve(destination))
  })
})

test('tampered package manifest fails: main / package.json export / oversized icon / files allowlist', function () {
  const { status, report } = verifyTamperedCopy(function (destination) {
    mutateJson(join(destination, 'package.json'), function (data) {
      data.main = 'missing-main.js'
      delete data.exports['./package.json']
      data.files = data.files.filter(function (entry) { return entry !== 'cordis.patch.yml' })
    })
    const icon = readFileSync(join(destination, 'icon.png'))
    writeFileSync(join(destination, 'icon.png'), Buffer.concat([icon, Buffer.alloc(300 * 1024, 0)]))
  })
  assert.equal(status, 1)
  assertCheckFails(report, ['package-main', 'package-exports', 'package-icon', 'files-required'])
})

test('a tampered cordis.patch.yml insert row fails the patch checks', function () {
  const { status, report } = verifyTamperedCopy(function (destination) {
    writeFileSync(join(destination, 'cordis.patch.yml'), '- insert:\n    - id: other-plugin\n      name: other-plugin\n')
  })
  assert.equal(status, 1)
  assertCheckFails(report, ['patch-insert'])
})

test('a tampered client module id or generated marker fails the client checks', function () {
  const { status, report } = verifyTamperedCopy(function (destination) {
    const clientFile = join(destination, 'client.js')
    const client = readFileSync(clientFile, 'utf8')
    writeFileSync(clientFile, client.split("id: 'dsh-famling'").join("id: 'not-dsh-famling'").split('// <dsh-famling:anims:end>').join('// <dsh-famling:anims:stop>'))
    const contentFile = join(destination, 'client.content.js')
    const content = readFileSync(contentFile, 'utf8')
    writeFileSync(contentFile, content.replace("const PLUGIN_VERSION = '" + PACKAGE_VERSION + "'", "const PLUGIN_VERSION = '9.9.9'"))
  })
  assert.equal(status, 1)
  assertCheckFails(report, ['client-module-id', 'client-generated-blocks', 'client-content-version'])
})

test('a tampered compatibility enum fails the matrix check', function () {
  const { status, report } = verifyTamperedCopy(function (destination) {
    mutateJson(join(destination, 'package.json'), function (data) {
      data.dsh.compatibility.dshReleases['0.2.3-alpha.2'] = 'maybe'
    })
  })
  assert.equal(status, 1)
  assertCheckFails(report, ['compat-matrix'])
})

test('a private absolute path in a packed text file fails the hygiene check', function () {
  const { status, report } = verifyTamperedCopy(function (destination) {
    const indexFile = join(destination, 'index.js')
    writeFileSync(indexFile, readFileSync(indexFile, 'utf8') + '\n// local checkout: D:\\private\\dev\\plugin\n')
  })
  assert.equal(status, 1)
  assertCheckFails(report, ['hygiene'])
})

test('a tampered locale meta.detail or empty meta.title fails the locale checks', function () {
  const { status, report } = verifyTamperedCopy(function (destination) {
    mutateJson(join(destination, 'locale/zh.json'), function (data) { data.meta.detail = 'docs/DOES-NOT-EXIST.md' })
    mutateJson(join(destination, 'locale/en.json'), function (data) { data.meta.title = '' })
  })
  assert.equal(status, 1)
  assertCheckFails(report, ['locale-detail', 'locale-meta'])
})

test('the engines comparator implements the SemVer ordering rules', function () {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareSemver(ordered[index - 1], ordered[index]), -1, ordered[index - 1] + ' < ' + ordered[index])
    assert.equal(compareSemver(ordered[index], ordered[index - 1]), 1)
  }
  assert.equal(compareSemver('1.0.0+build.5', '1.0.0'), 0, 'build metadata is ignored')
  assert.equal(satisfiesEngine('0.2.2-rc.1', '^0.2.2-alpha.2'), true, 'DSH dsh-version example accepts 0.2.2-rc.1')
  assert.equal(satisfiesEngine('0.2.2-alpha.1', '^0.2.2-alpha.2'), false)
  assert.equal(satisfiesEngine('0.3.0', '^0.2.2-alpha.2'), false)
  assert.throws(function () { satisfiesEngine('0.2.2', 'latest') }, /unsupported comparator/)
  assert.throws(function () { satisfiesEngine('not-semver', MERGED_ENGINE_RANGE) }, /valid semver/)
})

test('the human output reports the target and a final ok line', function () {
  const result = runVerify([])
  assert.equal(result.status, 0)
  assert.match(String(result.stdout), /\[verify-dsh\] target: /)
  assert.match(String(result.stdout), /\[verify-dsh\] ok \(\d+ checks\)/)
})

