#!/usr/bin/env node
/**
 * Package file manifest for C1 joint evidence (desktop commit + plugin bytes).
 *
 * The plugin directory is NOT a git checkout, so the desktop release commit can
 * only bind plugin bytes through a manifest that travels with the evidence.
 * This script freezes the published plugin surface into
 * `PLUGIN-MANIFEST.json`:
 *
 *   - the exact npm tarball inventory: package.json `files` allowlist expansion
 *     plus npm's always-included files, using the same expansion as
 *     `scripts/check-package.mjs` (single implementation, no second parser);
 *   - sha256 + byte size of every packed file and an aggregate digest over the
 *     sorted file table;
 *   - the vendored animation spec lock (`scripts/spec/anim-spec.json`) including
 *     its own self-digest, so a plugin-only clean checkout can be traced back to
 *     the animation data it was built from;
 *   - the content-extension contract versions and the module sha256.
 *
 * The manifest contains package-relative POSIX paths only: no absolute paths,
 * host names, user names or other machine data, so it can be published inside a
 * release evidence bundle. It is not packed into the npm tarball (`scripts/` and
 * the manifest are outside the `files` allowlist); it is an evidence artifact.
 *
 * Usage:
 *   node scripts/plugin-manifest.mjs                    # write PLUGIN-MANIFEST.json
 *   node scripts/plugin-manifest.mjs --check            # fail if the committed manifest drifted
 *   node scripts/plugin-manifest.mjs --verify           # verify the manifest against this checkout
 *   node scripts/plugin-manifest.mjs --out <file>       # write another path (default: package root)
 *   node scripts/plugin-manifest.mjs --manifest <file>  # read path for --check/--verify
 *   node scripts/plugin-manifest.mjs --now <iso>        # freeze generatedAt (SOURCE_DATE_EPOCH also works)
 *   node scripts/plugin-manifest.mjs --json             # machine-readable result
 *
 * Exit codes: 0 = ok, 1 = gate failure (fail-closed), 2 = usage error.
 *
 * Drift rule: whenever a packed file, the anim spec or the content-extension
 * contract changes, regenerate the manifest (`node scripts/plugin-manifest.mjs`)
 * and commit it with the change. `test/plugin-manifest.test.js` runs --check, so
 * a stale manifest is a red test, not a silent gap.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { expectedPacked, loadPackage } from './check-package.mjs'
import {
  SPEC_RELATIVE_PATH,
  SPEC_SCHEMA,
  SPEC_VERSION,
  animationSpecSha256,
  readAnimationSpec,
  specPathFor,
  stableStringify,
} from './anim-spec.mjs'

/** Absolute plugin package root (the checkout this script lives in). */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Manifest file name at the package root (evidence artifact, never packed). */
export const MANIFEST_FILE = 'PLUGIN-MANIFEST.json'
/** Manifest document kind; consumers must reject anything else. */
export const MANIFEST_KIND = 'dsh-famling/plugin-manifest'
/** Manifest schema version (integer); a breaking shape change bumps this. */
export const MANIFEST_SCHEMA_VERSION = 1
/** Content-extension module whose contract versions are recorded. */
export const CONTENT_EXTENSION_MODULE = 'content-extension.mjs'
/** Producer string recorded in the manifest so a mirror can trace how it was built. */
export const MANIFEST_GENERATOR = 'scripts/plugin-manifest.mjs'

/** Fields that legitimately change between two generations of the same bytes. */
const VOLATILE_FIELDS = Object.freeze(['generatedAt', 'reproducible', 'sourceDateEpoch'])
/** Lowercase SHA-256 hex digest. */
const SHA256_RE = /^[0-9a-f]{64}$/

/**
 * Hash a file's bytes.
 * @param {string} file Absolute file path.
 * @returns {string} Lowercase SHA-256 hex digest.
 */
export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * Hash UTF-8 text (used for the aggregate packed-file digest).
 * @param {string} text Text to hash.
 * @returns {string} Lowercase SHA-256 hex digest.
 */
export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Normalize a relative path to POSIX separators.
 * @param {string} value Path fragment.
 * @returns {string} POSIX-style path.
 */
function toPosix(value) {
  return value.split(sep).join('/')
}

/**
 * Whether a path is a safe package-relative POSIX path (no absolute paths, no
 * drive letters, no backslashes, no `..` traversal).
 * @param {string} value Candidate path from a manifest.
 * @returns {boolean} True when the path can only resolve inside a package root.
 */
export function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('\\')) return false
  if (value.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(value)) return false
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  return true
}

/**
 * Resolve generation metadata, mirroring scripts/release-evidence.mjs:
 * explicit --now wins, then SOURCE_DATE_EPOCH, then the wall clock.
 * @param {string|null} explicit ISO timestamp from --now.
 * @returns {{ iso: string, reproducible: boolean, sourceDateEpoch: number|null }} Timestamp facts.
 */
export function generatedAtNow(explicit) {
  if (explicit) {
    const date = new Date(explicit)
    if (Number.isNaN(date.getTime())) throw new Error('invalid --now timestamp: ' + explicit)
    return { iso: date.toISOString(), reproducible: true, sourceDateEpoch: Math.floor(date.getTime() / 1000) }
  }
  const raw = process.env.SOURCE_DATE_EPOCH
  if (raw !== undefined && raw !== '') {
    const epoch = Number(raw)
    if (!Number.isFinite(epoch) || epoch <= 0) throw new Error('invalid SOURCE_DATE_EPOCH: ' + raw)
    return { iso: new Date(epoch * 1000).toISOString(), reproducible: true, sourceDateEpoch: epoch }
  }
  return { iso: new Date().toISOString(), reproducible: false, sourceDateEpoch: null }
}

/**
 * Collect the packed file table: allowlist expansion + npm always-included files.
 * @param {any} pkg Parsed package.json.
 * @param {string} root Absolute package root.
 * @returns {{ files: { path: string, bytes: number, sha256: string }[], totalBytes: number, digest: string }} File table.
 */
function collectPackedFiles(pkg, root) {
  const expected = expectedPacked(pkg, root)
  if (expected.problems.length > 0) {
    throw new Error('package allowlist is not packable: ' + expected.problems.join('; '))
  }
  const files = expected.paths.map((relative) => {
    const fastRelative = toPosix(relative)
    if (!safeRelativePath(fastRelative)) throw new Error('packed path is not package-relative: ' + JSON.stringify(relative))
    const absolute = join(root, fastRelative)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error('packed file is missing: ' + fastRelative)
    return { path: fastRelative, bytes: statSync(absolute).size, sha256: sha256File(absolute) }
  })
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const digest = sha256Text(files.map((file) => file.sha256 + '  ' + file.path).join('\n') + '\n')
  return { files, totalBytes, digest }
}

/**
 * Read the vendored animation spec and freeze its lock into manifest fields.
 * @param {string} root Absolute package root.
 * @returns {{ path: string, bytes: number, sha256: string, schema: string, version: number, selfSha256: string, sourceSha256: string|null, characters: Record<string, number> }} Animation spec facts.
 */
export function collectAnimSpec(root) {
  const path = specPathFor(root)
  const loaded = readAnimationSpec(root)
  const spec = loaded.spec
  const characters = {}
  for (const kind of Object.keys(spec.characters ?? {}).sort()) {
    characters[kind] = Number.isInteger(spec.characters[kind]?.frames) ? spec.characters[kind].frames : 0
  }
  return {
    path: SPEC_RELATIVE_PATH,
    bytes: statSync(path).size,
    sha256: sha256File(path),
    schema: spec.schema,
    version: spec.specVersion,
    selfSha256: spec.specSha256,
    sourceSha256: typeof spec.sourceSha256 === 'string' ? spec.sourceSha256 : null,
    characters,
  }
}

/**
 * Read the content-extension contract versions from the live module.
 * @param {string} root Absolute package root.
 * @returns {Promise<{ module: string, version: number, packSchemaVersion: number, sha256: string }>} Contract facts.
 */
export async function collectContentExtension(root) {
  const path = join(root, CONTENT_EXTENSION_MODULE)
  if (!existsSync(path)) throw new Error('content-extension module is missing: ' + CONTENT_EXTENSION_MODULE)
  let module
  try {
    module = await import(pathToFileURL(path).href)
  } catch (error) {
    throw new Error('content-extension module could not be imported: ' + error.message)
  }
  if (!Number.isInteger(module.CONTENT_EXTENSION_VERSION)) throw new Error('content-extension module does not export an integer CONTENT_EXTENSION_VERSION')
  if (!Number.isInteger(module.CONTENT_PACK_SCHEMA_VERSION)) throw new Error('content-extension module does not export an integer CONTENT_PACK_SCHEMA_VERSION')
  return {
    module: CONTENT_EXTENSION_MODULE,
    version: module.CONTENT_EXTENSION_VERSION,
    packSchemaVersion: module.CONTENT_PACK_SCHEMA_VERSION,
    sha256: sha256File(path),
  }
}

/**
 * Build a fresh manifest for a package root (no writes).
 * @param {{ root?: string, now?: string|null }} [options] Package root + optional frozen timestamp.
 * @returns {Promise<any>} Manifest object.
 */
export async function buildManifest(options = {}) {
  const root = options.root ? resolve(options.root) : PLUGIN_ROOT
  const generated = generatedAtNow(options.now ?? null)
  const pkg = loadPackage(root)
  const packed = collectPackedFiles(pkg, root)
  const animSpec = collectAnimSpec(root)
  const contentExtension = await collectContentExtension(root)
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: MANIFEST_KIND,
    generatedBy: MANIFEST_GENERATOR,
    generatedAt: generated.iso,
    reproducible: generated.reproducible,
    sourceDateEpoch: generated.sourceDateEpoch,
    package: {
      name: String(pkg.name ?? ''),
      version: String(pkg.version ?? ''),
      license: String(pkg.license ?? ''),
    },
    packed: {
      count: packed.files.length,
      totalBytes: packed.totalBytes,
      digest: packed.digest,
      files: packed.files,
    },
    animSpec,
    contentExtension,
    notes: [
      'Unsigned evidence artifact: this manifest proves file identity only, never publisher authenticity.',
      'Paths are package-relative POSIX paths; no absolute paths, host names or user data are recorded.',
      'Packed list = package.json files allowlist expansion plus npm always-included files (scripts/check-package.mjs is the single expansion implementation).',
      'Verify with: node scripts/plugin-manifest.mjs --verify',
    ],
  }
}

/**
 * Render a manifest as deterministic file text.
 * @param {any} manifest Manifest object.
 * @returns {string} JSON text with a trailing newline.
 */
export function renderManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n'
}

/**
 * Remove volatile generation fields before two manifests are compared.
 * @param {any} manifest Manifest object.
 * @returns {any} Copy without volatile fields.
 */
function stripVolatile(manifest) {
  const copy = {}
  for (const key of Object.keys(manifest)) if (!VOLATILE_FIELDS.includes(key)) copy[key] = manifest[key]
  return copy
}

/**
 * Invariants a manifest must satisfy on its own (before it is compared to the
 * working tree): schema identity, safe paths, digest shapes and positive sizes.
 * @param {any} manifest Parsed manifest.
 * @returns {string[]} Problems (empty when valid).
 */
export function manifestInvariantProblems(manifest) {
  const problems = []
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest is not a JSON object']
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) problems.push('manifest schemaVersion must be ' + MANIFEST_SCHEMA_VERSION)
  if (manifest.kind !== MANIFEST_KIND) problems.push('manifest kind must be ' + JSON.stringify(MANIFEST_KIND))
  if (manifest.generatedBy !== MANIFEST_GENERATOR) problems.push('manifest generatedBy must be ' + JSON.stringify(MANIFEST_GENERATOR))
  if (typeof manifest.package?.name !== 'string' || manifest.package.name.length === 0) problems.push('manifest package.name is missing')
  if (typeof manifest.package?.version !== 'string' || manifest.package.version.length === 0) problems.push('manifest package.version is missing')
  if (typeof manifest.package?.license !== 'string' || manifest.package.license.length === 0) problems.push('manifest package.license is missing')
  const generated = typeof manifest.generatedAt === 'string' ? new Date(manifest.generatedAt) : null
  if (generated === null || Number.isNaN(generated.getTime())) problems.push('manifest generatedAt is not a valid timestamp')
  const packed = manifest.packed
  if (packed === null || typeof packed !== 'object' || Array.isArray(packed)) {
    problems.push('manifest packed section is missing')
  } else {
    const files = Array.isArray(packed.files) ? packed.files : null
    if (files === null || files.length === 0) {
      problems.push('manifest packed.files is missing or empty')
    } else {
      const seen = new Set()
      let bytes = 0
      let previous = null
      for (const file of files) {
        if (file === null || typeof file !== 'object' || Array.isArray(file)) {
          problems.push('manifest packed.files contains a non-object entry')
          continue
        }
        const path = String(file.path)
        if (!safeRelativePath(path)) problems.push('manifest packed path is not package-relative: ' + JSON.stringify(path))
        else if (seen.has(path)) problems.push('manifest packed path is duplicated: ' + path)
        else {
          seen.add(path)
          if (previous !== null && path <= previous) problems.push('manifest packed files are not sorted by path')
          previous = path
        }
        if (!Number.isInteger(file.bytes) || file.bytes < 0) problems.push('manifest packed bytes is invalid for ' + JSON.stringify(path))
        else bytes += file.bytes
        if (typeof file.sha256 !== 'string' || !SHA256_RE.test(file.sha256)) problems.push('manifest packed sha256 is invalid for ' + JSON.stringify(path))
      }
      if (packed.count !== files.length) problems.push('manifest packed.count does not match the file table')
      if (packed.totalBytes !== bytes) problems.push('manifest packed.totalBytes does not match the file table')
      if (typeof packed.digest !== 'string' || !SHA256_RE.test(packed.digest)) problems.push('manifest packed.digest is not a sha256')
      else if (packed.totalBytes === bytes) {
        const recomputed = sha256Text(files.map((file) => file.sha256 + '  ' + file.path).join('\n') + '\n')
        if (packed.digest !== recomputed) problems.push('manifest packed.digest does not match the file table')
      }
    }
  }
  const animSpec = manifest.animSpec
  if (animSpec === null || typeof animSpec !== 'object' || Array.isArray(animSpec)) {
    problems.push('manifest animSpec section is missing')
  } else {
    if (animSpec.path !== SPEC_RELATIVE_PATH) problems.push('manifest animSpec.path must be ' + JSON.stringify(SPEC_RELATIVE_PATH))
    if (animSpec.schema !== SPEC_SCHEMA) problems.push('manifest animSpec.schema must be ' + JSON.stringify(SPEC_SCHEMA))
    if (animSpec.version !== SPEC_VERSION) problems.push('manifest animSpec.version must be ' + SPEC_VERSION)
    for (const field of ['sha256', 'selfSha256']) if (typeof animSpec[field] !== 'string' || !SHA256_RE.test(animSpec[field])) problems.push('manifest animSpec.' + field + ' is not a sha256')
    if (!Number.isInteger(animSpec.bytes) || animSpec.bytes <= 0) problems.push('manifest animSpec.bytes is invalid')
  }
  const contentExtension = manifest.contentExtension
  if (contentExtension === null || typeof contentExtension !== 'object' || Array.isArray(contentExtension)) {
    problems.push('manifest contentExtension section is missing')
  } else {
    if (contentExtension.module !== CONTENT_EXTENSION_MODULE) problems.push('manifest contentExtension.module must be ' + JSON.stringify(CONTENT_EXTENSION_MODULE))
    if (!Number.isInteger(contentExtension.version) || contentExtension.version < 1) problems.push('manifest contentExtension.version is invalid')
    if (!Number.isInteger(contentExtension.packSchemaVersion) || contentExtension.packSchemaVersion < 1) problems.push('manifest contentExtension.packSchemaVersion is invalid')
    if (typeof contentExtension.sha256 !== 'string' || !SHA256_RE.test(contentExtension.sha256)) problems.push('manifest contentExtension.sha256 is not a sha256')
  }
  for (const problem of absolutePathProblems(manifest)) problems.push(problem)
  return problems
}

/**
 * Scan every string in a manifest for absolute paths or home-directory leaks,
 * so a manifest that is about to be published can never carry machine data.
 * @param {any} value JSON-compatible value.
 * @returns {string[]} Problems (empty when clean).
 */
function absolutePathProblems(value) {
  const problems = []
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const visit = (node, where) => {
    if (typeof node === 'string') {
      if (node.includes(home) && home.length > 1) problems.push('manifest leaks a home directory path at ' + where)
      else if (/^[A-Za-z]:[\\/]/.test(node) || node.startsWith('/')) problems.push('manifest contains an absolute path at ' + where + ': ' + JSON.stringify(node))
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, where + '[' + index + ']'))
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) visit(item, where + '.' + key)
    }
  }
  visit(value, '$')
  return problems
}

/**
 * Compare a recorded manifest with a freshly built one, ignoring the volatile
 * generation fields. Produces readable per-file drift problems.
 * @param {any} actual Manifest read from disk.
 * @param {any} expected Freshly built manifest.
 * @returns {string[]} Problems (empty when identical).
 */
export function compareManifests(actual, expected) {
  const problems = []
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return ['manifest is not a JSON object']
  const left = stripVolatile(actual)
  const right = stripVolatile(expected)
  const leftPacked = left.packed ?? {}
  const rightPacked = right.packed ?? {}
  const leftFiles = Array.isArray(leftPacked.files) ? leftPacked.files : []
  const rightFiles = Array.isArray(rightPacked.files) ? rightPacked.files : []
  left.packed = { ...leftPacked, files: undefined }
  right.packed = { ...rightPacked, files: undefined }
  if (stableStringify(left) !== stableStringify(right)) {
    for (const section of ['package', 'animSpec', 'contentExtension']) {
      if (stableStringify(left[section]) !== stableStringify(right[section])) problems.push(section + ' differs from the current checkout')
    }
    if (left.schemaVersion !== right.schemaVersion) problems.push('schemaVersion differs from the current checkout')
    if (left.kind !== right.kind) problems.push('kind differs from the current checkout')
    if (left.generatedBy !== right.generatedBy) problems.push('generatedBy differs from the current checkout')
    if (stableStringify(left.notes) !== stableStringify(right.notes)) problems.push('notes differ from the current checkout')
    if (problems.length === 0) problems.push('manifest differs from the current checkout')
  }
  const byPath = new Map()
  for (const file of rightFiles) byPath.set(String(file.path), file)
  const recorded = new Map()
  for (const file of leftFiles) recorded.set(String(file.path), file)
  for (const path of [...byPath.keys()].sort()) {
    const expectedFile = byPath.get(path)
    const actualFile = recorded.get(path)
    if (actualFile === undefined) { problems.push('packed file is missing from the manifest: ' + path); continue }
    if (actualFile.sha256 !== expectedFile.sha256) problems.push('packed sha256 drifted: ' + path)
    if (actualFile.bytes !== expectedFile.bytes) problems.push('packed size drifted: ' + path)
  }
  for (const path of [...recorded.keys()].sort()) {
    if (!byPath.has(path)) problems.push('manifest lists a file that is no longer packed: ' + path)
  }
  return problems
}

/**
 * Read + parse a manifest file.
 * @param {string} file Absolute manifest path.
 * @returns {{ manifest: any, text: string } | null} Parsed manifest, or null when absent.
 */
export function readManifestFile(file) {
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const manifest = JSON.parse(text)
  return { manifest, text }
}

/**
 * Validate the manifest at `manifestPath` against the package at `root`.
 *
 * Both --check (drift gate on the committed manifest) and --verify (evidence
 * consumer gate) use this implementation; they fail closed on any missing file,
 * hash drift, version drift, unsafe path or non-reproducible inventory.
 * @param {{ root?: string, manifestPath?: string }} [options] Package root + manifest path.
 * @returns {Promise<{ ok: boolean, problems: string[], summary: any }>} Result.
 */
export async function validateManifest(options = {}) {
  const root = options.root ? resolve(options.root) : PLUGIN_ROOT
  const manifestPath = options.manifestPath ? resolve(options.manifestPath) : join(root, MANIFEST_FILE)
  const problems = []
  let recorded
  try {
    recorded = readManifestFile(manifestPath)
  } catch (error) {
    return { ok: false, problems: ['manifest is not valid JSON: ' + error.message], summary: null }
  }
  if (recorded === null) {
    return { ok: false, problems: [MANIFEST_FILE + ' is missing; run: node scripts/plugin-manifest.mjs'], summary: null }
  }
  problems.push(...manifestInvariantProblems(recorded.manifest))
  let live
  try {
    live = await buildManifest({ root })
  } catch (error) {
    problems.push('manifest cannot be rebuilt from this checkout: ' + error.message)
    return { ok: false, problems, summary: null }
  }
  const summary = {
    manifestPath,
    name: recorded.manifest.package?.name ?? null,
    version: recorded.manifest.package?.version ?? null,
    packedFiles: Array.isArray(recorded.manifest.packed?.files) ? recorded.manifest.packed.files.length : 0,
    totalBytes: recorded.manifest.packed?.totalBytes ?? 0,
    packedDigest: recorded.manifest.packed?.digest ?? null,
    animSpecSha256: recorded.manifest.animSpec?.sha256 ?? null,
    contentExtensionVersion: recorded.manifest.contentExtension?.version ?? null,
    generatedAt: recorded.manifest.generatedAt ?? null,
  }
  if (recorded.manifest.package?.name !== live.package.name) problems.push('manifest package.name does not match package.json')
  if (recorded.manifest.package?.version !== live.package.version) problems.push('manifest package.version does not match package.json (version drift)')
  problems.push(...compareManifests(recorded.manifest, live))
  return { ok: problems.length === 0, problems, summary }
}

/**
 * Write a fresh manifest.
 * @param {{ root?: string, out?: string|null, now?: string|null }} [options] Package root, output path, frozen timestamp.
 * @returns {Promise<{ manifest: any, file: string }>} Written manifest + path.
 */
export async function writeManifest(options = {}) {
  const root = options.root ? resolve(options.root) : PLUGIN_ROOT
  const file = options.out ? resolve(options.out) : join(root, MANIFEST_FILE)
  const manifest = await buildManifest({ root, now: options.now ?? null })
  writeFileSync(file, renderManifest(manifest))
  return { manifest, file }
}

/**
 * CLI entry point.
 * @param {string[]} argv Arguments (without node/script).
 * @param {{ stdout?: (line: string) => void, stderr?: (line: string) => void }} [io] Output sinks.
 * @returns {number} Exit code.
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((line) => console.log(line))
  const stderr = io.stderr ?? ((line) => console.error(line))
  const options = { mode: 'write', out: null, manifest: null, now: null, json: false, help: false }
  try {
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]
      const value = () => {
        const next = argv[index + 1]
        index += 1
        if (next === undefined) throw new Error('missing value after ' + arg)
        return next
      }
      if (arg === '--help' || arg === '-h') options.help = true
      else if (arg === '--write') options.mode = 'write'
      else if (arg === '--check') options.mode = 'check'
      else if (arg === '--verify') options.mode = 'verify'
      else if (arg === '--json') options.json = true
      else if (arg === '--out') options.out = value()
      else if (arg === '--manifest') options.manifest = value()
      else if (arg === '--now') options.now = value()
      else if (arg !== '') throw new Error('unknown argument: ' + arg)
    }
    if (options.help) {
      stdout('Usage: node scripts/plugin-manifest.mjs [--write|--check|--verify] [--out <file>] [--manifest <file>] [--now <iso>] [--json]')
      stdout('  --write     write PLUGIN-MANIFEST.json (default)')
      stdout('  --check     fail if the committed manifest no longer matches this checkout')
      stdout('  --verify    verify a manifest (default committed one) against this checkout')
      stdout('  --out       output path for --write (default: package root)')
      stdout('  --manifest  manifest path for --check/--verify (default: package root)')
      return 0
    }
    if (options.mode === 'write') {
      const result = await writeManifest({ out: options.out, now: options.now })
      const summary = {
        ok: true,
        mode: 'write',
        file: result.file,
        version: result.manifest.package.version,
        packedFiles: result.manifest.packed.count,
        totalBytes: result.manifest.packed.totalBytes,
        packedDigest: result.manifest.packed.digest,
        animSpecSha256: result.manifest.animSpec.sha256,
        contentExtensionVersion: result.manifest.contentExtension.version,
        generatedAt: result.manifest.generatedAt,
      }
      if (options.json) stdout(JSON.stringify(summary))
      else stdout('plugin-manifest: wrote ' + MANIFEST_FILE + ' (' + summary.version + ', ' + summary.packedFiles + ' packed files, ' + summary.totalBytes + ' bytes, anim-spec ' + String(summary.animSpecSha256).slice(0, 16) + '..., content-extension v' + summary.contentExtensionVersion + ')')
      return 0
    }
    const result = await validateManifest({ manifestPath: options.manifest ?? options.out ?? null })
    if (options.json) stdout(JSON.stringify({ mode: options.mode, ...result }))
    else if (result.ok) stdout('plugin-manifest: ' + options.mode + ' ok (' + result.summary.version + ', ' + result.summary.packedFiles + ' packed files, digest ' + String(result.summary.packedDigest).slice(0, 16) + '...)')
    else {
      stderr('plugin-manifest: ' + options.mode.toUpperCase() + ' FAILED (' + result.problems.length + ' problem(s))')
      for (const problem of result.problems) stderr('  - ' + problem)
    }
    return result.ok ? 0 : 1
  } catch (error) {
    stderr('plugin-manifest: error: ' + error.message)
    return 2
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(await runCli(process.argv.slice(2)))
