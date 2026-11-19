/**
 * MB-023 / E3-T3: one plugin version truth.
 *
 * package.json is the single source. This file validates that every public
 * surface that states the current version agrees with it, and can regenerate
 * those references from package.json:
 *
 *   node test/version-truth.test.js --write   # sync references, then verify
 *   node --test test/version-truth.test.js    # verify only (CI / npm test)
 *
 * It also keeps the safety-floor invariants that the README / LEGAL-NOTICE are
 * required to disclose (sending destination, crisis resources, clear/withdraw),
 * so the docs cannot silently drift away from the implemented behaviour.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const LEGAL_FILE = 'docs/LEGAL-NOTICE-2026-11-18.md'

function read(file) { return readFileSync(join(ROOT, file), 'utf8') }

/** Every current-version statement, as [file, pattern] pairs used by check and write. */
const CLIENT_VERSION = /version: 'dsh-famling (\d+\.\d+\.\d+)/g
const README_VERSION = /(## 当前实现（)(\d+\.\d+\.\d+)(）)/
const LEGAL_VERSION = /(适用插件版本：dsh-famling )(\d+\.\d+\.\d+)/

function foundVersions() {
  const result = {}
  result['client.js'] = [...read('client.js').matchAll(new RegExp(CLIENT_VERSION.source, 'g'))].map((match) => match[1])
  result['client.content.js'] = [...read('client.content.js').matchAll(new RegExp(CLIENT_VERSION.source, 'g'))].map((match) => match[1])
  result['README.md'] = [...read('README.md').matchAll(new RegExp(README_VERSION.source, 'g'))].map((match) => match[2])
  result[LEGAL_FILE] = [...read(LEGAL_FILE).matchAll(new RegExp(LEGAL_VERSION.source, 'g'))].map((match) => match[2])
  for (const file of ['locale/zh.json', 'locale/en.json']) result[file] = [JSON.parse(read(file)).meta.version]
  return result
}

/** Regenerate every version reference from package.json (idempotent). */
export function syncVersionReferences(version = VERSION) {
  const replace = (file, pattern, replacement) => {
    const before = read(file)
    const after = before.replace(pattern, replacement)
    if (after !== before) writeFileSync(join(ROOT, file), after)
  }
  replace('client.js', CLIENT_VERSION, (whole, old) => old === version ? whole : "version: 'dsh-famling " + version)
  replace('client.content.js', CLIENT_VERSION, (whole, old) => old === version ? whole : "version: 'dsh-famling " + version)
  replace('README.md', new RegExp(README_VERSION.source, 'g'), (_whole, start, _old, end) => start + version + end)
  replace(LEGAL_FILE, new RegExp(LEGAL_VERSION.source, 'g'), (_whole, start) => start + version)
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const data = JSON.parse(read(file))
    if (data.meta.version !== version) {
      data.meta.version = version
      writeFileSync(join(ROOT, file), JSON.stringify(data, null, 2) + '\n')
    }
  }
}

test('package.json is a valid single source of truth', () => {
  assert.equal(typeof VERSION, 'string')
  assert.match(VERSION, SEMVER, 'package.json version is semver')
})

test('client.js, client.content.js, README, LEGAL-NOTICE and locale all state the package version', () => {
  const found = foundVersions()
  for (const [file, versions] of Object.entries(found)) {
    assert.ok(versions.length > 0, file + ': no current version statement found')
    for (const version of versions) assert.equal(version, VERSION, file + ': stale version ' + version + ' (expected ' + VERSION + ')')
  }
  assert.equal(found['client.js'].length, 2, 'client.js states the version in zh and en')
  assert.equal(found['client.content.js'].length, 2, 'client.content.js states the version in zh and en')
})

test('safety floor docs stay truthful: destination, crisis resources, clear/withdraw, cross-product wording', () => {
  const readme = read('README.md')
  const legal = read(LEGAL_FILE)
  const client = read('client.js')
  const content = read('client.content.js')
  for (const [name, text] of [['README.md', readme], [LEGAL_FILE, legal]]) {
    assert.ok(text.includes('模型供应商'), name + ': discloses the configured model provider')
    assert.ok(text.includes('12356'), name + ': crisis hotline')
    assert.ok(text.includes('110') && text.includes('120'), name + ': emergency numbers')
    assert.ok(text.includes('清除'), name + ': clear-local-data entry is documented')
  }
  assert.ok(readme.includes('工作助手') || readme.includes('工作助理'), 'README states the work-assistant chat positioning')
  assert.equal(/不提供自由 LLM 角色扮演/.test(readme), false, 'README does not claim the plugin has no free-form LLM chat at all')
  assert.ok(client.includes('模型供应商'), 'client zh disclosure')
  assert.ok(client.includes('model provider'), 'client en disclosure')
  assert.ok(content.includes('createFirstRunNotice'), 'first-run notice factory')
  assert.ok(content.includes('清除本机设置与同意'), 'clear-local-data control')
  assert.ok(content.includes('撤回'), 'consent withdrawal is stated')
})

// Generation mode: explicit flag only, never under `node --test`.
if (process.argv.includes('--write') && process.argv[1] && process.argv[1].endsWith('version-truth.test.js')) {
  syncVersionReferences()
  console.log('[version-truth] synced current-version references to ' + VERSION)
}
