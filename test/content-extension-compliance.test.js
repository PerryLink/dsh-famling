/**
 * MB-032 / MB-033 (E3 / 0.10.9): v3 compliance metadata.
 *
 * The v3 contract stays at schemaVersion 3 and gains license / aiProvenance /
 * pack-level compatibility plus the optional canonical usage statement/ref/SHA
 * as additive fields. Pre-0.10.9 v3 packs keep validating (warnings only); a
 * host that loads untrusted packs can opt into fail-closed validation with
 * { requireCompliance: true } and host-version compatibility gating with
 * { pluginVersion: 'x.y.z' }. No network, no execution, no asset loading.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isSafeLicenseFile,
  CONTENT_AI_PROVENANCE_TEMPLATE,
  CONTENT_EXTENSION_COMPATIBILITY,
  CONTENT_EXTENSION_POINTS,
  CONTENT_EXTENSION_VERSION,
  CONTENT_LICENSE_TEMPLATE,
  CONTENT_LIMITS,
  CONTENT_PACK_EXAMPLE,
  CONTENT_PACK_SCHEMA_VERSION,
  CONTENT_USAGE_STATEMENT,
  CONTENT_USAGE_STATEMENT_REF,
  CONTENT_USAGE_STATEMENT_SHA256,
  PROHIBITED_USES,
  USAGE_DECLARATION_TEMPLATE,
  isContentExtensionCompatible,
  isPackCompatibleWithPlugin,
  validateContentPack,
} from '../content-extension.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const clone = () => JSON.parse(JSON.stringify(CONTENT_PACK_EXAMPLE))
const roleEntry = (pack) => pack.entries.find((entry) => entry.kind === 'role')

/** A minimal pre-0.10.9 v3 pack: no compliance metadata, no canonical fields. */
function legacyV3Pack() {
  return {
    schemaVersion: 3,
    id: 'com.example.legacy-v3',
    name: 'Legacy V3',
    version: '0.9.0',
    source: 'local',
    usageDeclaration: { researchOnly: true, prohibitedUses: [...PROHIBITED_USES] },
    entries: [{
      kind: 'theme',
      id: 'legacy',
      name: 'Legacy',
      version: '1.0.0',
      source: 'local',
      preview: { kind: 'color', value: '#ffffff' },
      permissions: ['apply:theme'],
      apply: { variables: { '--dsh-famling-bubble-bg': '#ffffff' } },
    }],
  }
}

test('v3 stays the current contract revision and compliance fields are additive', () => {
  assert.equal(CONTENT_EXTENSION_VERSION, 3, 'no v4 for the compliance additions')
  assert.equal(CONTENT_PACK_SCHEMA_VERSION, 3)
  assert.equal(CONTENT_EXTENSION_POINTS.version, CONTENT_EXTENSION_VERSION)
  assert.equal(CONTENT_EXTENSION_COMPATIBILITY.policy, 'additive-within-major')
  assert.equal(isContentExtensionCompatible(3), true)
  assert.equal(isContentExtensionCompatible(4), false)
  assert.equal(CONTENT_EXTENSION_POINTS.compliance.additive, true)
  assert.equal(CONTENT_EXTENSION_POINTS.compliance.strictOption, 'requireCompliance')
  // The minimal required declaration template is unchanged so famling v2
  // parity and pre-0.10.9 v3 declarations keep working.
  assert.deepEqual({ ...USAGE_DECLARATION_TEMPLATE }, { researchOnly: true, prohibitedUses: [...PROHIBITED_USES] })
  for (const field of ['license', 'aiProvenance', 'compatibility']) {
    assert.ok(CONTENT_EXTENSION_POINTS.pack.optionalFields.includes(field), 'optional pack field: ' + field)
  }
  for (const field of ['license', 'aiProvenance']) {
    assert.ok(CONTENT_EXTENSION_POINTS.entry.optionalFields.includes(field), 'optional entry field: ' + field)
  }
  for (const field of ['statement', 'statementRef', 'statementSha256']) {
    assert.ok(CONTENT_EXTENSION_POINTS.compliance.usageDeclaration.optionalFields.includes(field), 'optional declaration field: ' + field)
  }
})

test('pre-0.10.9 v3 packs keep validating; missing compliance is warning-only by default', () => {
  const result = validateContentPack(legacyV3Pack())
  assert.equal(result.ok, true, 'old pack stays valid (backward compatible)')
  assert.deepEqual(result.errors, [])
  const warnings = result.warnings.join(' ')
  for (const term of ['pack.license', 'pack.aiProvenance', 'pack.compatibility', 'pack.usageDeclaration.statement']) {
    assert.ok(warnings.includes(term), 'warning mentions the missing field: ' + term)
  }
  const strict = validateContentPack(legacyV3Pack(), { requireCompliance: true })
  assert.equal(strict.ok, false, 'strict mode fails closed for the old pack')
  assert.ok(strict.errors.some((error) => error.includes('pack.license')), 'strict mode requires a licence')
  assert.ok(strict.errors.some((error) => error.includes('pack.aiProvenance')), 'strict mode requires AI provenance')
  assert.ok(strict.errors.some((error) => error.includes('pack.compatibility')), 'strict mode requires compatibility')
  assert.ok(strict.errors.some((error) => error.includes('pack.usageDeclaration.statement')), 'strict mode requires the canonical statement')
  const example = clone()
  const full = validateContentPack(example, { requireCompliance: true })
  assert.equal(full.ok, true, 'the shipped example satisfies strict compliance')
  assert.deepEqual(full.warnings, [], 'the shipped example produces no compliance warnings')
})

test('the canonical usage statement is optional but fail-closed when mutated', () => {
  const sha = createHash('sha256').update(CONTENT_USAGE_STATEMENT, 'utf8').digest('hex')
  assert.equal(sha, CONTENT_USAGE_STATEMENT_SHA256, 'frozen SHA-256 matches the statement')
  assert.equal(CONTENT_USAGE_STATEMENT_REF, 'docs/legal/USE-RESTRICTIONS-2026-11-19.md')
  assert.equal(validateContentPack(clone()).ok, true)
  const cases = []
  let pack = clone(); pack.usageDeclaration.statement = 'short'; cases.push(['mutated statement', pack, 'statement'])
  pack = clone(); pack.usageDeclaration.statementRef = 'docs/other.md'; cases.push(['mutated ref', pack, 'statementRef'])
  pack = clone(); pack.usageDeclaration.statementSha256 = '0'.repeat(64); cases.push(['mutated sha', pack, 'statementSha256'])
  pack = clone(); roleEntry(pack).usageDeclaration.statement = 'short'; cases.push(['mutated per-role statement', pack, 'entries[0].usageDeclaration.statement'])
  for (const [name, value, marker] of cases) {
    const result = validateContentPack(value)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.some((error) => error.includes(marker)), name + ': error points at ' + marker)
  }
  const statementOnly = clone()
  delete statementOnly.usageDeclaration.statementRef
  assert.equal(validateContentPack(statementOnly).ok, true, 'loose mode accepts a partial canonical restatement')
  assert.equal(validateContentPack(statementOnly, { requireCompliance: true }).ok, false, 'strict mode requires statement + statementRef')
})

test('licence metadata is validated fail-closed when present', () => {
  const withLicense = (license) => {
    const pack = clone()
    pack.license = license
    return pack
  }
  assert.equal(validateContentPack(withLicense({ spdx: 'CC-BY-4.0', attribution: 'Example authors' })).ok, true, 'plain licence is valid')
  assert.equal(validateContentPack(withLicense({ ...CONTENT_LICENSE_TEMPLATE, url: 'https://example.com/licence', file: 'LICENSES/CC-BY-4.0.txt' })).ok, true, 'https url and relative file are metadata-only valid')
  const cases = []
  cases.push(['non-object', withLicense('CC-BY-4.0'), 'pack.license'])
  cases.push(['bad spdx', withLicense({ spdx: 'CC BY 4.0!', attribution: 'x' }), 'spdx'])
  cases.push(['empty attribution', withLicense({ spdx: 'CC-BY-4.0', attribution: '' }), 'attribution'])
  cases.push(['long attribution', withLicense({ spdx: 'CC-BY-4.0', attribution: 'a'.repeat(CONTENT_LIMITS.maxLicenseAttributionChars + 1) }), 'attribution'])
  cases.push(['http url', withLicense({ spdx: 'CC-BY-4.0', attribution: 'x', url: 'http://example.com/licence' }), 'url'])
  cases.push(['credential url', withLicense({ spdx: 'CC-BY-4.0', attribution: 'x', url: 'https://user:pass@example.com/licence' }), 'url'])
  cases.push(['traversal file', withLicense({ spdx: 'CC-BY-4.0', attribution: 'x', file: '../LICENSE.txt' }), 'file'])
  cases.push(['absolute file', withLicense({ spdx: 'CC-BY-4.0', attribution: 'x', file: '/LICENSE.txt' }), 'file'])
  cases.push(['unknown field', withLicense({ spdx: 'CC-BY-4.0', attribution: 'x', extra: true }), 'unknown field'])
  for (const [name, value, marker] of cases) {
    const result = validateContentPack(value)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.some((error) => error.includes(marker)), name + ': error points at ' + marker)
  }
  const entryBad = clone()
  roleEntry(entryBad).license = { spdx: 'bad spdx', attribution: 'x' }
  assert.equal(validateContentPack(entryBad).ok, false, 'entry-level licence is validated too')
  const entryGood = clone()
  roleEntry(entryGood).license = { spdx: 'MIT', attribution: 'Example authors' }
  assert.equal(validateContentPack(entryGood).ok, true, 'entry-level licence restatement is accepted')
})

test('isSafeLicenseFile keeps licence files to bounded relative paths', () => {
  assert.equal(isSafeLicenseFile('LICENSES/CC-BY-4.0.txt'), true)
  assert.equal(isSafeLicenseFile('NOTICE.md'), true)
  for (const value of ['../LICENSE.txt', '/LICENSE.txt', 'C:/LICENSE.txt', 'LICENSE', 'a'.repeat(200) + '.txt', 'licen$e.txt', 'folder/'.repeat(7) + 'LICENSE.txt']) {
    assert.equal(isSafeLicenseFile(value), false, 'unsafe licence file rejected: ' + value)
  }
})

test('AI provenance is validated fail-closed when present', () => {
  const withProvenance = (aiProvenance) => {
    const pack = clone()
    pack.aiProvenance = aiProvenance
    return pack
  }
  assert.equal(validateContentPack(withProvenance({ generated: false, disclosure: 'Hand-made artwork.' })).ok, true, 'honest non-AI provenance is valid')
  assert.equal(validateContentPack(withProvenance({ generated: true, disclosure: 'Generated with a diffusion model.', tools: ['deepseek-image', 'stable-diffusion'] })).ok, true, 'AI-generated provenance with tools is valid')
  const cases = []
  cases.push(['non-object', withProvenance('none'), 'pack.aiProvenance'])
  cases.push(['non-boolean generated', withProvenance({ generated: 'yes', disclosure: 'x' }), 'generated'])
  cases.push(['missing disclosure', withProvenance({ generated: false }), 'disclosure'])
  cases.push(['empty disclosure', withProvenance({ generated: false, disclosure: '' }), 'disclosure'])
  cases.push(['generated without real disclosure', withProvenance({ generated: true, disclosure: 'abc' }), 'real disclosure'])
  cases.push(['tools not array', withProvenance({ generated: false, disclosure: 'x', tools: 'hand' }), 'tools'])
  cases.push(['empty tools', withProvenance({ generated: false, disclosure: 'x', tools: [] }), 'tools'])
  cases.push(['too many tools', withProvenance({ generated: false, disclosure: 'x', tools: Array.from({ length: CONTENT_LIMITS.maxAiTools + 1 }, (_, index) => 'tool-' + index) }), 'tools'])
  cases.push(['bad tool id', withProvenance({ generated: false, disclosure: 'x', tools: ['Bad Tool'] }), 'tools'])
  cases.push(['duplicate tool id', withProvenance({ generated: false, disclosure: 'x', tools: ['a-tool', 'a-tool'] }), 'duplicate'])
  cases.push(['unknown field', withProvenance({ generated: false, disclosure: 'x', model: 'm' }), 'unknown field'])
  for (const [name, value, marker] of cases) {
    const result = validateContentPack(value)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.some((error) => error.includes(marker)), name + ': error points at ' + marker)
  }
  const entryBad = clone()
  roleEntry(entryBad).aiProvenance = { generated: false, disclosure: '' }
  assert.equal(validateContentPack(entryBad).ok, false, 'entry-level AI provenance is validated too')
  const entryGood = clone()
  roleEntry(entryGood).aiProvenance = { generated: false, disclosure: 'Hand-made role bundle.' }
  assert.equal(validateContentPack(entryGood).ok, true, 'entry-level AI provenance restatement is accepted')
})

test('pack compatibility ranges are checked against a concrete plugin version', () => {
  assert.equal(validateContentPack(clone(), { pluginVersion: PLUGIN_VERSION }).ok, true, 'current plugin version is inside the example range')
  assert.equal(validateContentPack(clone(), { pluginVersion: '0.9.9' }).ok, false, 'a host below minPluginVersion is rejected')
  const tooNew = clone()
  tooNew.compatibility = { minPluginVersion: '0.0.1', maxPluginVersion: '0.0.2' }
  assert.equal(validateContentPack(tooNew, { pluginVersion: PLUGIN_VERSION }).ok, false, 'a host above maxPluginVersion is rejected')
  assert.equal(validateContentPack(tooNew).ok, true, 'without a concrete host version only the structure is checked')
  const inverted = clone()
  inverted.compatibility = { minPluginVersion: '0.11.0', maxPluginVersion: '0.10.0' }
  assert.equal(validateContentPack(inverted).ok, false, 'inverted ranges are rejected')
  const badVersion = clone()
  badVersion.compatibility = { minPluginVersion: 'latest' }
  assert.equal(validateContentPack(badVersion).ok, false, 'non x.y.z versions are rejected')
  const badOption = validateContentPack(clone(), { pluginVersion: 'latest' })
  assert.equal(badOption.ok, false, 'an invalid pluginVersion option is reported')
  assert.ok(badOption.errors.some((error) => error.includes('options.pluginVersion')), 'option error is explicit')
  assert.equal(badOption.errors.some((error) => error.includes('excludes the current plugin')), false, 'an invalid host version does not fabricate range failures')
  const roleTooNew = clone()
  roleEntry(roleTooNew).compatibility = { minPluginVersion: '99.0.0' }
  const roleResult = validateContentPack(roleTooNew, { pluginVersion: PLUGIN_VERSION })
  assert.equal(roleResult.ok, false, 'role-entry compatibility is gated too')
  assert.ok(roleResult.errors.some((error) => error.includes('entries[0].compatibility')), 'role-entry error points at the entry')
})

test('isPackCompatibleWithPlugin is a pure fail-closed helper', () => {
  assert.equal(isPackCompatibleWithPlugin({ minPluginVersion: '0.10.0' }, PLUGIN_VERSION), true)
  assert.equal(isPackCompatibleWithPlugin({ minPluginVersion: '0.10.0', maxPluginVersion: '0.10.9' }, '0.10.9'), true, 'max is inclusive')
  assert.equal(isPackCompatibleWithPlugin({ minPluginVersion: '0.10.9' }, '0.10.9'), true, 'min is inclusive')
  assert.equal(isPackCompatibleWithPlugin({ minPluginVersion: '0.10.10' }, '0.10.9'), false)
  assert.equal(isPackCompatibleWithPlugin({ minPluginVersion: '0.10.8', maxPluginVersion: '0.10.8' }, '0.10.9'), false)
  for (const compatibility of [null, 'x', [], {}, { minPluginVersion: 'latest' }, { minPluginVersion: '0.10.0', maxPluginVersion: 'latest' }]) {
    assert.equal(isPackCompatibleWithPlugin(compatibility, PLUGIN_VERSION), false, 'malformed compatibility fails closed: ' + JSON.stringify(compatibility))
  }
  for (const version of [undefined, null, 3, 'latest', '0.10']) {
    assert.equal(isPackCompatibleWithPlugin({ minPluginVersion: '0.10.0' }, version), false, 'malformed host version fails closed: ' + String(version))
  }
})

test('strict compliance mode documents and enforces every required field', () => {
  const strict = { requireCompliance: true }
  assert.equal(validateContentPack(clone(), strict).ok, true, 'full example passes strict mode')
  const cases = []
  let pack = clone(); delete pack.license; cases.push(['missing licence', pack, 'pack.license'])
  pack = clone(); delete pack.aiProvenance; cases.push(['missing AI provenance', pack, 'pack.aiProvenance'])
  pack = clone(); delete pack.compatibility; cases.push(['missing compatibility', pack, 'pack.compatibility'])
  pack = clone(); delete pack.usageDeclaration.statement; cases.push(['missing statement', pack, 'pack.usageDeclaration.statement'])
  pack = clone(); delete pack.usageDeclaration.statementRef; cases.push(['missing statement ref', pack, 'pack.usageDeclaration.statementRef'])
  for (const [name, value, marker] of cases) {
    const result = validateContentPack(value, strict)
    assert.equal(result.ok, false, name + ' must be rejected in strict mode')
    assert.ok(result.errors.some((error) => error.includes(marker)), name + ': error points at ' + marker)
  }
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.compliance.strictRequires], [
    'pack.license', 'pack.aiProvenance', 'pack.compatibility',
    'pack.usageDeclaration.statement', 'pack.usageDeclaration.statementRef',
  ])
  assert.equal(typeof CONTENT_EXTENSION_POINTS.validation.options.requireCompliance, 'string')
  assert.equal(typeof CONTENT_EXTENSION_POINTS.validation.options.pluginVersion, 'string')
  assert.equal(typeof CONTENT_EXTENSION_POINTS.validation.returns.warnings, 'string')
  assert.ok(CONTENT_EXTENSION_POINTS.compliance.license.spdxPattern)
  assert.ok(CONTENT_EXTENSION_POINTS.compliance.aiProvenance.disclosureMaxChars > 0)
  assert.deepEqual({ ...CONTENT_EXTENSION_POINTS.compliance.anchors.license }, { ...CONTENT_LICENSE_TEMPLATE })
  assert.deepEqual({ ...CONTENT_EXTENSION_POINTS.compliance.anchors.aiProvenance }, { ...CONTENT_AI_PROVENANCE_TEMPLATE })
})

test('the validator stays pure, reports warnings separately and never throws', () => {
  for (const value of [null, undefined, [], 'pack', 42, true]) {
    const result = validateContentPack(value)
    assert.equal(result.ok, false)
    assert.ok(Array.isArray(result.errors) && Array.isArray(result.warnings))
  }
  const cyclic = clone()
  cyclic.self = cyclic
  const cyclicResult = validateContentPack(cyclic)
  assert.equal(cyclicResult.ok, false, 'cyclic packs are rejected instead of throwing')
  assert.ok(cyclicResult.errors.length > 0)
  const withFunction = clone()
  withFunction.license.attribution = () => 'x'
  assert.equal(validateContentPack(withFunction).ok, false, 'non-JSON values are rejected')
  const legacy = validateContentPack(legacyV3Pack())
  assert.ok(legacy.warnings.length > 0 && legacy.warnings.length <= CONTENT_LIMITS.maxErrors, 'warnings are bounded')
  assert.equal(validateContentPack(legacyV3Pack()).ok, legacy.ok, 'validation is deterministic')
  const proto = clone()
  proto.license = JSON.parse('{"spdx":"CC-BY-4.0","attribution":"x","__proto__":"polluted"}')
  assert.equal(validateContentPack(proto).ok, false, 'prototype keys stay rejected in compliance metadata')
})
