/**
 * MB-094 residual: package release hygiene is a gate, not a convention.
 *
 * `scripts/check-package.mjs` is the single implementation (prepack +
 * `npm run verify:package` + this test all call into it); these tests pin the
 * rules so a future edit cannot quietly drop `repository`, ship `test/` in the
 * tarball, or drop a runtime chunk from `files`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  CANONICAL,
  allowlistReport,
  expectedPacked,
  loadPackage,
  metadataProblems,
  packEntryProblems,
  staticReport,
} from '../scripts/check-package.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = loadPackage(ROOT)
const clone = () => JSON.parse(JSON.stringify(pkg))

function fakePackEntry(paths, overrides = {}) {
  return {
    name: pkg.name,
    version: pkg.version,
    filename: `${pkg.name}-${pkg.version}.tgz`,
    entryCount: paths.length,
    size: 1024,
    unpackedSize: 4096,
    files: paths.map((path) => ({ path, size: 1, mode: 420 })),
    ...overrides,
  }
}

test('metadata declares repository/homepage/bugs for the Plugin repo and they agree', () => {
  assert.deepEqual(pkg.repository, { type: 'git', url: CANONICAL.repository })
  assert.equal(pkg.homepage, CANONICAL.homepage)
  assert.deepEqual(pkg.bugs, { url: CANONICAL.bugs })
  assert.equal(pkg.private, false, 'the plugin is a real npm package')
  assert.deepEqual(metadataProblems(pkg), [], 'canonical package.json passes the metadata gate')
})

test('metadata drift is rejected: repository / homepage / bugs / private / license', () => {
  const cases = [
    ['repository removed', (copy) => { delete copy.repository }, /repository is missing/],
    ['repository points elsewhere', (copy) => { copy.repository.url = 'git+https://github.com/PerryLink/famling.git' }, /repository.url is/],
    ['repository uses ssh', (copy) => { copy.repository.url = 'git+ssh://git@github.com/PerryLink/dsh-famling.git' }, /git\+https/],
    ['homepage without repo', (copy) => { copy.homepage = 'https://example.com/' }, /homepage is/],
    ['bugs without repo', (copy) => { copy.bugs.url = 'https://example.com/issues' }, /bugs.url is/],
    ['private package', (copy) => { copy.private = true }, /private must be false/],
    ['wrong license', (copy) => { copy.license = 'MIT' }, /license is/],
  ]
  for (const [name, mutate, expected] of cases) {
    const copy = clone()
    mutate(copy)
    const problems = metadataProblems(copy)
    assert.ok(problems.some((problem) => expected.test(problem)), name + ': ' + JSON.stringify(problems))
  }
})

test('prepack and the release gates are wired to the checker', () => {
  assert.equal(pkg.scripts.prepack, 'node scripts/check-package.mjs --prepack')
  assert.equal(pkg.scripts['check:package'], 'node scripts/check-package.mjs')
  assert.equal(pkg.scripts['verify:package'], 'node scripts/check-package.mjs --pack')
  assert.match(pkg.scripts['release:check'], /npm test && npm run check && npm run verify && npm run verify:package/)
  const broken = clone()
  delete broken.scripts.prepack
  assert.ok(metadataProblems(broken).some((problem) => /prepack must run/.test(problem)))
})

test('files allowlist is duplicate-free, exists and never ships test/ or scripts/', () => {
  const report = allowlistReport(pkg, ROOT)
  assert.deepEqual(report.problems, [])
  const duplicates = report.entries.filter((entry, index) => report.entries.indexOf(entry) !== index)
  assert.deepEqual(duplicates, [], 'the historical duplicated "docs" entry is gone')
  for (const file of report.files) {
    assert.equal(/^test\//.test(file), false, 'test files are not packed: ' + file)
    assert.equal(/^scripts\//.test(file), false, 'scripts are not packed: ' + file)
    assert.equal(/\.tgz$/.test(file), false, 'no tarballs in the allowlist: ' + file)
  }
})

test('the packed set covers runtime entries, legal/docs files and every export', () => {
  const expected = expectedPacked(pkg, ROOT)
  assert.deepEqual(expected.problems, [])
  for (const required of ['index.js', 'client.js', 'client.content.js', 'client.anims.human.js', 'client.anims.cat.js', 'client.anims.dog.js', 'content-extension.mjs', 'cordis.patch.yml', 'icon.png', 'README.md', 'LICENSE', 'LICENSE-ART', 'NOTICE', 'docs/DETAIL.md', 'docs/LEGAL-NOTICE-2026-11-18.md', 'docs/RELEASE-HYGIENE.md', 'locale/en.json', 'locale/zh.json', 'package.json']) {
    assert.ok(expected.paths.includes(required), 'packed: ' + required)
  }
})

test('negative: duplicate, missing, forbidden and runtime-dropping allowlist edits are rejected', () => {
  const duplicate = clone()
  duplicate.files.push('docs')
  assert.ok(allowlistReport(duplicate, ROOT).problems.some((problem) => /duplicated/.test(problem)), 'duplicate entry')

  const missing = clone()
  missing.files.push('does-not-exist.js')
  assert.ok(allowlistReport(missing, ROOT).problems.some((problem) => /does not exist/.test(problem)), 'missing entry')

  const leaked = clone()
  leaked.files.push('test')
  assert.ok(allowlistReport(leaked, ROOT).problems.some((problem) => /must not publish/.test(problem)), 'forbidden entry')

  const dropped = clone()
  dropped.files = dropped.files.filter((entry) => entry !== 'content-extension.mjs')
  const droppedProblems = expectedPacked(dropped, ROOT).problems
  assert.ok(droppedProblems.some((problem) => /required runtime file is not packed/.test(problem)), 'required runtime file')
  assert.ok(droppedProblems.some((problem) => /exports .* is not packed/.test(problem)), 'export coverage')
})

test('pack entry validation accepts the declared inventory', () => {
  const expected = expectedPacked(pkg, ROOT)
  assert.deepEqual(packEntryProblems(pkg, fakePackEntry(expected.paths), expected.paths), [])
})

test('pack entry validation rejects missing, undeclared and misnamed artifacts', () => {
  const expected = expectedPacked(pkg, ROOT)
  const base = expected.paths

  const missing = fakePackEntry(base.filter((path) => path !== 'client.anims.cat.js'))
  assert.ok(packEntryProblems(pkg, missing, base).some((problem) => /tarball is missing "client.anims.cat.js"/.test(problem)), 'missing file')

  const extra = fakePackEntry([...base, 'scripts/check-package.mjs'])
  assert.ok(packEntryProblems(pkg, extra, base).some((problem) => /undeclared file "scripts\/check-package\.mjs"/.test(problem)), 'undeclared file')

  const staleName = fakePackEntry(base, { filename: 'dsh-famling-9.9.9.tgz' })
  assert.ok(packEntryProblems(pkg, staleName, base).some((problem) => /pack filename/.test(problem)), 'filename carries the version')

  const wrongVersion = fakePackEntry(base, { version: '9.9.9' })
  assert.ok(packEntryProblems(pkg, wrongVersion, base).some((problem) => /pack version/.test(problem)), 'version mismatch')

  const empty = fakePackEntry([], { entryCount: 0, size: 0, unpackedSize: 0 })
  assert.ok(packEntryProblems(pkg, empty, []).some((problem) => /returned no files/.test(problem)), 'empty pack')
})

test('staticReport on the working tree has no problems and reports the inventory', () => {
  const report = staticReport(ROOT)
  assert.deepEqual(report.problems, [])
  assert.equal(report.info.name, pkg.name)
  assert.equal(report.info.version, pkg.version)
  assert.ok(report.info.allowlistEntries >= 15)
  assert.ok(report.info.expectedFiles >= 18)
})

test('release hygiene is documented next to the package', () => {
  const doc = readFileSync(join(ROOT, 'docs/RELEASE-HYGIENE.md'), 'utf8')
  for (const needle of ['npm run check:package', 'npm run verify:package', 'npm pack --dry-run', 'prepack', CANONICAL.repository, CANONICAL.bugs]) {
    assert.ok(doc.includes(needle), 'docs/RELEASE-HYGIENE.md documents ' + needle)
  }
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.ok(readme.includes('docs/RELEASE-HYGIENE.md'), 'README links the release-hygiene doc')
})
