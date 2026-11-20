/**
 * Shared content-extension v3 compliance fixtures (E3 / MB-032) - plugin side.
 *
 * The canonical fixture set lives in the sibling famling repo
 * (`tests/fixtures/content-compliance/`); this package vendors a byte-identical
 * copy under `test/fixtures/content-compliance/` (test/ is never packed) so a
 * clean plugin-only checkout keeps running the full corpus. Both ends run the
 * same `cases.json` expectations through their own side of the contract:
 *
 *   - plugin: `validateContentPack` from `../content-extension.mjs`;
 *   - famling: `tests/content-compliance-fixtures.test.ts` (imports the plugin
 *     validator when the sibling checkout is present).
 *
 * Regenerate the local manifest after a fixture edit with
 * `node tests/update-compliance-fixture-manifest.mjs --sync <fixture-dir>` from
 * the famling repo, or recompute it here with the same file list. The manifest
 * and the famling-vs-plugin byte comparison are the drift gate.
 *
 * When the famling checkout is absent (clean plugin checkout / CI) the
 * cross-repo byte comparison skips; set `FAMLING_REPO_DIR` for another layout.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONTENT_AI_PROVENANCE_TEMPLATE,
  CONTENT_EXTENSION_COMPATIBILITY,
  CONTENT_EXTENSION_POINTS,
  CONTENT_EXTENSION_VERSION,
  CONTENT_LICENSE_TEMPLATE,
  CONTENT_PACK_SCHEMA_VERSION,
  CONTENT_USAGE_STATEMENT,
  CONTENT_USAGE_STATEMENT_REF,
  CONTENT_USAGE_STATEMENT_SHA256,
  PROHIBITED_USES,
  validateContentPack,
} from '../content-extension.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'test', 'fixtures', 'content-compliance')
/** Sibling famling checkout; override for CI or a different layout. */
const FAMLING_REPO_ROOT = process.env.FAMLING_REPO_DIR ?? join(ROOT, '..', '..', 'desktop-games')
const FAMLING_FIXTURES = join(FAMLING_REPO_ROOT, 'tests', 'fixtures', 'content-compliance')
const famlingAvailable = existsSync(join(FAMLING_REPO_ROOT, 'public', 'content', 'library.json'))
const famlingSkip = famlingAvailable ? false : 'famling checkout not present (clean plugin checkout / CI)'

const EXPECTED_FIXTURE_ID = 'dsh-famling.content-compliance/1'
const EXPECTED_CONTRACT = {
  extensionVersion: 3,
  packSchemaVersion: 3,
  policy: 'additive-within-major',
  supportedPackSchemaVersions: [3],
  strictRequires: [
    'pack.license',
    'pack.aiProvenance',
    'pack.compatibility',
    'pack.usageDeclaration.statement',
    'pack.usageDeclaration.statementRef',
  ],
}
const MIN_PACK_FIELDS = ['schemaVersion', 'id', 'name', 'version', 'source', 'usageDeclaration', 'entries']

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function sha256File(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }

/** Canonical fixture file list (manifest does not hash itself or this test). */
function fixtureFiles(dir) {
  const packs = readdirSync(join(dir, 'packs'))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => 'packs/' + name)
  return ['canonical-declaration.json', 'cases.json', ...packs]
}

function fixtureDigest(dir) {
  const files = {}
  for (const rel of fixtureFiles(dir)) files[rel] = sha256File(join(dir, rel))
  return files
}

function runCase(entry) {
  const pack = readJson(join(FIXTURES, entry.pack))
  const result = validateContentPack(pack, entry.options)
  const label = entry.id + ' (' + entry.pack + ')'
  assert.equal(result.ok, entry.expect.ok, label + ': ok (errors: ' + result.errors.join(' | ') + ')')
  assert.equal(result.errors.length, entry.expect.errorCount, label + ': error count (errors: ' + result.errors.join(' | ') + ')')
  assert.equal(result.warnings.length, entry.expect.warningCount, label + ': warning count (warnings: ' + result.warnings.join(' | ') + ')')
  for (const marker of entry.expect.errorIncludes) {
    assert.ok(result.errors.some((error) => error.includes(marker)), label + ': error includes "' + marker + '" (errors: ' + result.errors.join(' | ') + ')')
  }
  for (const marker of entry.expect.warningIncludes) {
    assert.ok(result.warnings.some((warning) => warning.includes(marker)), label + ': warning includes "' + marker + '" (warnings: ' + result.warnings.join(' | ') + ')')
  }
}

const canonical = readJson(join(FIXTURES, 'canonical-declaration.json'))
const casesFile = readJson(join(FIXTURES, 'cases.json'))
const manifest = readJson(join(FIXTURES, 'manifest.json'))

test('fixture canonical declaration equals the plugin compliance anchors', () => {
  assert.equal(canonical.fixture, EXPECTED_FIXTURE_ID)
  assert.deepEqual(canonical.contract, EXPECTED_CONTRACT)
  assert.equal(canonical.contract.extensionVersion, CONTENT_EXTENSION_VERSION)
  assert.equal(canonical.contract.packSchemaVersion, CONTENT_PACK_SCHEMA_VERSION)
  assert.equal(canonical.contract.policy, CONTENT_EXTENSION_COMPATIBILITY.policy)
  assert.deepEqual([...canonical.contract.supportedPackSchemaVersions], [...CONTENT_EXTENSION_COMPATIBILITY.supportedPackSchemaVersions])
  assert.deepEqual([...canonical.contract.strictRequires], [...CONTENT_EXTENSION_POINTS.compliance.strictRequires])
  assert.equal(CONTENT_EXTENSION_POINTS.compliance.additive, true)
  assert.equal(CONTENT_EXTENSION_POINTS.compliance.strictOption, 'requireCompliance')
  const declaration = canonical.usageDeclaration
  assert.equal(declaration.researchOnly, true)
  assert.equal(declaration.statement, CONTENT_USAGE_STATEMENT)
  assert.equal(declaration.statementRef, CONTENT_USAGE_STATEMENT_REF)
  assert.equal(declaration.statementSha256, CONTENT_USAGE_STATEMENT_SHA256)
  assert.equal(createHash('sha256').update(CONTENT_USAGE_STATEMENT, 'utf8').digest('hex'), CONTENT_USAGE_STATEMENT_SHA256, 'fixture SHA-256 matches the plugin statement')
  assert.deepEqual([...declaration.prohibitedUses], [...PROHIBITED_USES])
  assert.deepEqual({ ...canonical.license }, { ...CONTENT_LICENSE_TEMPLATE })
  assert.deepEqual({ ...canonical.aiProvenance }, { ...CONTENT_AI_PROVENANCE_TEMPLATE })
  assert.deepEqual({ ...CONTENT_EXTENSION_POINTS.compliance.anchors.license }, { ...canonical.license })
  assert.deepEqual({ ...CONTENT_EXTENSION_POINTS.compliance.anchors.aiProvenance }, { ...canonical.aiProvenance })
})

test('fixture manifest pins every vendored file and covers every case', () => {
  assert.equal(manifest.fixture, EXPECTED_FIXTURE_ID)
  assert.equal(manifest.algorithm, 'sha256')
  assert.deepEqual(Object.keys(manifest.files).sort(), fixtureFiles(FIXTURES).sort(), 'manifest lists exactly the vendored fixture files')
  for (const [rel, expected] of Object.entries(manifest.files)) {
    assert.equal(sha256File(join(FIXTURES, rel)), expected, rel + ': manifest SHA-256')
  }
  assert.equal(casesFile.fixture, EXPECTED_FIXTURE_ID)
  assert.equal(casesFile.contractVersion, CONTENT_EXTENSION_VERSION)
  assert.equal(casesFile.packSchemaVersion, CONTENT_PACK_SCHEMA_VERSION)
  assert.ok(casesFile.cases.length >= 16, 'the shared corpus covers valid/legacy/strict/negative cases')
  assert.equal(new Set(casesFile.cases.map((entry) => entry.id)).size, casesFile.cases.length, 'case ids are unique')
  const casePacks = [...new Set(casesFile.cases.map((entry) => entry.pack))].sort()
  const packFiles = fixtureFiles(FIXTURES).filter((rel) => rel.startsWith('packs/'))
  assert.deepEqual(casePacks, packFiles, 'every fixture pack has at least one case and every case points at a fixture pack')
  for (const packFile of packFiles) {
    const pack = readJson(join(FIXTURES, packFile))
    for (const field of MIN_PACK_FIELDS) assert.ok(field in pack, packFile + ': carries ' + field)
    assert.ok(readFileSync(join(FIXTURES, packFile)).length < 65536, packFile + ': stays under the v3 pack JSON cap')
    assert.equal(pack.usageDeclaration.researchOnly, true, packFile + ': declares researchOnly=true')
    if (!packFile.includes('/invalid-')) {
      assert.deepEqual([...pack.usageDeclaration.prohibitedUses].sort(), [...PROHIBITED_USES].sort(), packFile + ': lists all six prohibited uses')
    }
  }
})

test('the shared fixtures pass validateContentPack with the frozen expectations', () => {
  for (const entry of casesFile.cases) runCase(entry)
})

test('the famling checkout keeps byte-identical shared compliance fixtures', { skip: famlingSkip }, () => {
  assert.equal(existsSync(FAMLING_FIXTURES), true, 'famling test fixtures exist: ' + FAMLING_FIXTURES)
  assert.deepEqual(fixtureDigest(FAMLING_FIXTURES), fixtureDigest(FIXTURES), 'famling and plugin fixture copies must stay byte-identical')
})
