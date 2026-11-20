/**
 * C1 joint-evidence bridge: PLUGIN-MANIFEST.json must stay a truthful, machine-
 * checkable snapshot of the published package.
 *
 * The plugin directory is not a git checkout, so the joint evidence script on the
 * desktop side can only bind plugin bytes through this manifest. These tests pin
 * the contract:
 *   - the packed file table equals the real pack allowlist expansion;
 *   - every recorded sha256/byte size matches the working tree;
 *   - the vendored anim spec lock and content-extension contract versions are
 *     recorded and verified;
 *   - the committed manifest is current (the drift gate), and tampering with a
 *     packed file, the manifest itself or the package version fails closed;
 *   - the manifest never contains absolute paths or user/home directories.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { animationSpecSha256, readAnimationSpec } from '../scripts/anim-spec.mjs'
import { expectedPacked, loadPackage } from '../scripts/check-package.mjs'
import {
  MANIFEST_FILE,
  MANIFEST_GENERATOR,
  MANIFEST_KIND,
  MANIFEST_SCHEMA_VERSION,
  buildManifest,
  compareManifests,
  generatedAtNow,
  manifestInvariantProblems,
  readManifestFile,
  renderManifest,
  safeRelativePath,
  sha256File,
  sha256Text,
  validateManifest,
  writeManifest,
} from '../scripts/plugin-manifest.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Copy the package to a temp dir (no node_modules/.git/manifest), then clean up. */
async function withTempCopy(run) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-famling-manifest-'))
  try {
    cpSync(ROOT, root, {
      recursive: true,
      filter: (source) => {
        const rel = relative(ROOT, source)
        if (rel === '') return true
        if (rel === MANIFEST_FILE) return false
        const segments = rel.split(/[\\/]/)
        if (segments.includes('node_modules') || segments.includes('.git')) return false
        return !rel.endsWith('.tgz')
      },
    })
    return await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Deterministically mutate a temp checkout while keeping the anim spec rebuildable. */
function replaceAnimSpecField(root, field, value) {
  const file = join(root, 'scripts', 'spec', 'anim-spec.json')
  const spec = JSON.parse(readFileSync(file, 'utf8'))
  spec[field] = value
  spec.specSha256 = animationSpecSha256(spec)
  writeFileSync(file, JSON.stringify(spec, null, 2) + '\n')
}

function checksumRows(manifest) {
  return manifest.packed.files.map((file) => file.sha256 + '  ' + file.path).join('\n') + '\n'
}

test('buildManifest records the real pack allowlist, hashes and contract locks', async () => {
  const manifest = await buildManifest({ root: ROOT, now: '2026-11-21T00:00:00Z' })
  assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION)
  assert.equal(manifest.kind, MANIFEST_KIND)
  assert.equal(manifest.generatedBy, MANIFEST_GENERATOR)
  assert.equal(manifest.generatedAt, '2026-11-21T00:00:00.000Z')
  assert.equal(manifest.reproducible, true)
  assert.equal(manifest.sourceDateEpoch, Math.floor(Date.parse('2026-11-21T00:00:00Z') / 1000))

  const pkg = loadPackage(ROOT)
  assert.equal(manifest.package.name, pkg.name)
  assert.equal(manifest.package.version, pkg.version)
  assert.equal(manifest.package.license, pkg.license)

  const expected = expectedPacked(pkg, ROOT)
  assert.deepEqual(expected.problems, [])
  assert.equal(manifest.packed.count, expected.paths.length)
  assert.deepEqual(manifest.packed.files.map((file) => file.path), [...expected.paths].sort())
  let bytes = 0
  for (const file of manifest.packed.files) {
    const absolute = join(ROOT, file.path)
    assert.equal(file.sha256, sha256File(absolute), 'sha256 mismatch for ' + file.path)
    assert.equal(file.bytes, readFileSync(absolute).length, 'byte size mismatch for ' + file.path)
    bytes += file.bytes
  }
  assert.equal(manifest.packed.totalBytes, bytes)
  assert.equal(manifest.packed.digest, sha256Text(checksumRows(manifest)))
  assert.deepEqual(manifestInvariantProblems(manifest), [])

  const spec = readAnimationSpec(ROOT).spec
  assert.equal(manifest.animSpec.path, 'scripts/spec/anim-spec.json')
  assert.equal(manifest.animSpec.sha256, sha256File(join(ROOT, 'scripts', 'spec', 'anim-spec.json')))
  assert.equal(manifest.animSpec.selfSha256, spec.specSha256)
  assert.equal(manifest.animSpec.sourceSha256, spec.sourceSha256)
  assert.equal(manifest.animSpec.version, spec.specVersion)

  const contentExtension = await import('../content-extension.mjs')
  assert.equal(manifest.contentExtension.version, contentExtension.CONTENT_EXTENSION_VERSION)
  assert.equal(manifest.contentExtension.packSchemaVersion, contentExtension.CONTENT_PACK_SCHEMA_VERSION)
  assert.equal(manifest.contentExtension.sha256, sha256File(join(ROOT, 'content-extension.mjs')))
})

test('manifest text never contains absolute paths or the developer home directory', async () => {
  const manifest = await buildManifest({ root: ROOT, now: '2026-11-21T00:00:00Z' })
  const text = renderManifest(manifest)
  assert.equal(text.includes(ROOT), false, 'manifest leaked the package root')
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (home.length > 1) assert.equal(text.includes(home), false, 'manifest leaked the home directory')
  const walk = (value) => {
    if (typeof value === 'string') {
      assert.equal(/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/'), false, 'absolute path in manifest: ' + value)
      return
    }
    if (Array.isArray(value)) return value.forEach(walk)
    if (value !== null && typeof value === 'object') return Object.values(value).forEach(walk)
  }
  walk(manifest)
})

test('generatedAt is reproducible and ignored by manifest comparison', async () => {
  assert.deepEqual(generatedAtNow('2026-11-21T01:02:03Z'), {
    iso: '2026-11-21T01:02:03.000Z',
    reproducible: true,
    sourceDateEpoch: Math.floor(Date.parse('2026-11-21T01:02:03Z') / 1000),
  })
  assert.throws(() => generatedAtNow('not-a-date'), /invalid --now timestamp/)
  const first = await buildManifest({ root: ROOT, now: '2026-11-21T00:00:00Z' })
  const second = await buildManifest({ root: ROOT, now: '2026-11-22T00:00:00Z' })
  assert.notEqual(first.generatedAt, second.generatedAt)
  assert.deepEqual(compareManifests(first, second), [])
})

test('the committed PLUGIN-MANIFEST.json is current (drift gate)', async () => {
  const result = await validateManifest({ root: ROOT })
  assert.deepEqual(result.problems, [], 'PLUGIN-MANIFEST.json is stale; regenerate it with: node scripts/plugin-manifest.mjs')
  assert.equal(result.summary.name, 'dsh-famling')
})

test('the CLI check/verify modes pass on the committed manifest', () => {
  for (const mode of ['--check', '--verify']) {
    const result = spawnSync(process.execPath, ['scripts/plugin-manifest.mjs', mode], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(result.status, 0, mode + ' failed: ' + result.stderr)
    assert.match(result.stdout, /plugin-manifest: (check|verify) ok/)
  }
})

test('a changed packed file fails closed and names the drift', async () => {
  await withTempCopy(async (root) => {
    await writeManifest({ root })
    writeFileSync(join(root, 'client.js'), readFileSync(join(root, 'client.js'), 'utf8') + '// tampered\n')
    const result = await validateManifest({ root })
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((problem) => problem.includes('packed sha256 drifted: client.js')), result.problems.join('\n'))
  })
})

test('a package version bump without a new manifest fails closed', async () => {
  await withTempCopy(async (root) => {
    await writeManifest({ root })
    const pkgFile = join(root, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    pkg.version = '9.9.9'
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
    const result = await validateManifest({ root })
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((problem) => problem.includes('version drift')), result.problems.join('\n'))
  })
})

test('an anim spec change without a new manifest fails closed', async () => {
  await withTempCopy(async (root) => {
    await writeManifest({ root })
    replaceAnimSpecField(root, 'sharedContract', 'tampered shared contract')
    const result = await validateManifest({ root })
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((problem) => problem.includes('animSpec differs from the current checkout')), result.problems.join('\n'))
  })
})

test('a missing manifest is a hard failure, not a skip', async () => {
  await withTempCopy(async (root) => {
    const result = await validateManifest({ root })
    assert.equal(result.ok, false)
    assert.equal(result.summary, null)
    assert.ok(result.problems.some((problem) => problem.includes(MANIFEST_FILE + ' is missing')))
  })
})

test('tampered manifests are rejected by the standalone invariants', async () => {
  const base = await buildManifest({ root: ROOT, now: '2026-11-21T00:00:00Z' })
  const clone = () => JSON.parse(JSON.stringify(base))

  const wrongKind = clone(); wrongKind.kind = 'something-else'
  assert.ok(manifestInvariantProblems(wrongKind).some((problem) => problem.includes('kind')))

  const absolute = clone(); absolute.packed.files[0].path = '/etc/passwd'
  assert.ok(manifestInvariantProblems(absolute).some((problem) => problem.includes('not package-relative')))

  const duplicate = clone(); duplicate.packed.files.push({ ...duplicate.packed.files[0] })
  assert.ok(manifestInvariantProblems(duplicate).some((problem) => problem.includes('duplicated')))

  const badDigest = clone(); badDigest.packed.digest = 'f'.repeat(64)
  assert.ok(manifestInvariantProblems(badDigest).some((problem) => problem.includes('packed.digest')))

  const badAnimSpec = clone(); badAnimSpec.animSpec.selfSha256 = 'not-a-hash'
  assert.ok(manifestInvariantProblems(badAnimSpec).some((problem) => problem.includes('animSpec.selfSha256')))

  const badContract = clone(); badContract.contentExtension.version = 0
  assert.ok(manifestInvariantProblems(badContract).some((problem) => problem.includes('contentExtension.version')))
})

test('packed entries that left the allowlist are drift, not silently accepted', async () => {
  await withTempCopy(async (root) => {
    await writeManifest({ root })
    const file = join(root, MANIFEST_FILE)
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    manifest.packed.files.push({ path: 'scripts/plugin-manifest.mjs', bytes: 1, sha256: '0'.repeat(64) })
    manifest.packed.count += 1
    manifest.packed.totalBytes += 1
    writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
    const result = await validateManifest({ root })
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((problem) => problem.includes('no longer packed')), result.problems.join('\n'))
  })
})

test('safeRelativePath only accepts package-relative POSIX paths', () => {
  for (const good of ['index.js', 'locale/en.json', 'docs/DETAIL.md', 'client.anims.cat.js']) assert.equal(safeRelativePath(good), true, good)
  for (const bad of ['', '/etc/passwd', 'C:\\Windows', '..\\x', '../x', 'a/../b', 'a//b', 'a\\b', 'C:relative']) assert.equal(safeRelativePath(bad), false, bad)
})

test('writes only the requested output file', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'dsh-famling-manifest-out-'))
  try {
    const out = join(outDir, 'custom-name.json')
    await writeManifest({ root: ROOT, out })
    assert.equal(existsSync(out), true)
    const parsed = readManifestFile(out)
    assert.equal(parsed.manifest.kind, MANIFEST_KIND)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
