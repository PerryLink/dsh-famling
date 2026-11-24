#!/usr/bin/env node
/**
 * Offline, zero-dependency DSH compatibility self-check for the dsh-famling package.
 *
 * The DSH host decides whether a bundle may load from its package.json manifest:
 * engines.dsh, dsh.bundle.patch, dsh.client.*, exports, main, icon, and the
 * exported locale metadata the Plugin Manager reads without activating the plugin.
 * This script packs those checks (plus client-artifact, hygiene, resource and
 * packaging invariants) into one command that needs no network and no running host.
 *
 * Usage:
 *   node scripts/verify-dsh.mjs                       # verify this package
 *   node scripts/verify-dsh.mjs --dsh-version X.Y.Z   # also check engines + matrix
 *   node scripts/verify-dsh.mjs --json                # machine-readable report
 *   node scripts/verify-dsh.mjs --root DIR            # verify another package copy
 *
 * Exit codes: 0 = all checks pass, 1 = at least one check fails, 2 = usage error.
 * JSON shape: { ok, target, dshVersion, checks: [{ id, ok, detail }] }
 *
 * The engines comparator is a minimal SemVer implementation: comparator sets
 * separated by ||, operators >= > <= < =, plus ^ and ~, with prerelease ordering
 * and the node-semver rule that a prerelease target version must match a
 * comparator carrying a prerelease on the same major.minor.patch tuple. When
 * engines.dsh is present the DSH docs state it alone decides (peer dependencies
 * are then ignored) and prerelease versions take part in matching.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Canonical package name; the patch insert rows must use it. */
export const PACKAGE_NAME = 'dsh-famling'

/** Lazy animation chunks that must register the package module id. */
export const CHARACTER_CHUNKS = Object.freeze([
  'client.anims.human.js',
  'client.anims.cat.js',
  'client.anims.dog.js',
])

/** Icon extensions DSH accepts for a package-root plugin icon. */
export const ICON_EXTENSIONS = Object.freeze(['svg', 'png', 'jpg', 'jpeg', 'webp'])

/** DSH icon size limit (256 KiB). */
export const ICON_MAX_BYTES = 256 * 1024

/** DSH pluginManager.detailMaxBytes default (1 MiB). */
export const DETAIL_MAX_BYTES = 1024 * 1024

/** Allowed values of dsh.compatibility.dshReleases entries. */
export const COMPAT_VALUES = Object.freeze(['compatible', 'incompatible', 'unknown'])

/** Home-relative paths documented by the plugin itself (Advisers/DSH/cache data). */
export const HOME_REFERENCE_ALLOWLIST = Object.freeze(['.advisers', '.dsh', '.cache'])

/** Files npm always includes, even when the files allowlist does not name them. */
export const ALWAYS_PACKED = Object.freeze(['package.json', 'README.md', 'LICENSE'])

/** Runtime files the published package must contain and the allowlist must cover. */
export const REQUIRED_PACKED = Object.freeze([
  'index.js',
  'client.js',
  'client.content.js',
  'client.behavior.js',
  'client.status.js',
  'client.anims.human.js',
  'client.anims.cat.js',
  'client.anims.dog.js',
  'content-extension.mjs',
  'cordis.patch.yml',
  'icon.png',
  'README.md',
  'LICENSE',
  'LICENSE-ART',
  'NOTICE',
  'locale/zh.json',
  'locale/en.json',
  'docs/DETAIL.md',
  'docs/PLUGIN-PAGE.md',
])

/** Private-path patterns rejected in packed text files (labels are user-facing). */
export const PRIVATE_PATH_RULES = Object.freeze([
  Object.freeze({ id: 'windows-drive', label: 'Windows drive path', pattern: /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/ }),
  Object.freeze({ id: 'wsl-mount', label: 'WSL mount path', pattern: /\/mnt\// }),
  Object.freeze({ id: 'unix-home', label: 'Unix home directory path', pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+\// }),
  Object.freeze({ id: 'file-url', label: 'file URL', pattern: /file:\/\/\// }),
  Object.freeze({ id: 'home-shorthand', label: 'home-relative path', pattern: /~\/([A-Za-z0-9._-]+)/ }),
])

const USAGE = 'node scripts/verify-dsh.mjs [--root DIR] [--dsh-version X.Y.Z] [--json]'
const DEFAULT_ROOT = resolve(join(fileURLToPath(import.meta.url), '..', '..'))
const SECRET_TOKEN_RE = /\bsk-[A-Za-z0-9_-]{20,}/g
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
const PLUGIN_VERSION_RE = /const PLUGIN_VERSION = '([^']+)'/
const MODULE_ID_RE = /id:\s*['"]dsh-famling['"]/
const GENERATED_MARKER_RE = /^\s*\/\/ <dsh-famling:([a-z-]+):(begin|end)>\s*$/

/** Parse a strict SemVer string into its numeric parts, or null. */
function parseSemver(version) {
  if (typeof version !== 'string') return null
  const match = SEMVER_RE.exec(version)
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Compare one prerelease identifier per the SemVer ordering rules. */
function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    const leftNumber = Number(left)
    const rightNumber = Number(right)
    if (leftNumber === rightNumber) return 0
    return leftNumber < rightNumber ? -1 : 1
  }
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Compare two SemVer versions (strings or parsed objects) as -1, 0 or 1. */
export function compareSemver(left, right) {
  const first = typeof left === 'string' ? parseSemver(left) : left
  const second = typeof right === 'string' ? parseSemver(right) : right
  if (first === null || second === null) throw new Error('compareSemver expects valid semver versions')
  for (const key of ['major', 'minor', 'patch']) {
    if (first[key] !== second[key]) return first[key] < second[key] ? -1 : 1
  }
  const firstPre = first.prerelease
  const secondPre = second.prerelease
  if (firstPre.length === 0 && secondPre.length === 0) return 0
  if (firstPre.length === 0) return 1
  if (secondPre.length === 0) return -1
  const length = Math.max(firstPre.length, secondPre.length)
  for (let index = 0; index < length; index += 1) {
    if (firstPre[index] === undefined) return -1
    if (secondPre[index] === undefined) return 1
    const result = compareIdentifiers(firstPre[index], secondPre[index])
    if (result !== 0) return result
  }
  return 0
}

/** Upper bound of ^X.Y.Z (caret keeps the left-most non-zero component). */
function caretUpperBound(version) {
  if (version.major > 0) return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
  if (version.minor > 0) return { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] }
  return { major: 0, minor: 0, patch: version.patch + 1, prerelease: [] }
}

/** Upper bound of ~X.Y.Z (tilde allows patch-level changes). */
function tildeUpperBound(version) {
  return { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [] }
}

/** Parse one whitespace-separated comparator set; throws on unsupported syntax. */
function parseComparatorSet(text) {
  const comparators = []
  for (const token of text.trim().split(/\s+/)) {
    if (token.length === 0) continue
    if (token.startsWith('^') || token.startsWith('~')) {
      const version = parseSemver(token.slice(1))
      if (version === null) throw new Error('unsupported comparator ' + JSON.stringify(token))
      comparators.push({ operator: '>=', version: version })
      comparators.push({ operator: '<', version: token.startsWith('^') ? caretUpperBound(version) : tildeUpperBound(version) })
      continue
    }
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(token)
    const version = match === null ? null : parseSemver(match[2])
    if (version === null) throw new Error('unsupported comparator ' + JSON.stringify(token))
    comparators.push({ operator: match[1] === undefined ? '=' : match[1], version: version })
  }
  if (comparators.length === 0) throw new Error('empty engine range')
  return comparators
}

/** One comparator test, ignoring the prerelease-inclusion rule. */
function comparatorAccepts(target, comparator) {
  const ordering = compareSemver(target, comparator.version)
  if (comparator.operator === '>=') return ordering >= 0
  if (comparator.operator === '>') return ordering > 0
  if (comparator.operator === '<=') return ordering <= 0
  if (comparator.operator === '<') return ordering < 0
  return ordering === 0
}

/** One comparator set test, including the node-semver prerelease rule. */
function comparatorSetAccepts(target, comparators) {
  for (const comparator of comparators) if (!comparatorAccepts(target, comparator)) return false
  if (target.prerelease.length === 0) return true
  const tuple = target.major + '.' + target.minor + '.' + target.patch
  for (const comparator of comparators) {
    const candidate = comparator.version
    if (candidate.prerelease.length > 0 && candidate.major + '.' + candidate.minor + '.' + candidate.patch === tuple) return true
  }
  return false
}

/**
 * Minimal SemVer range test for engines.dsh. Supports comparator sets with
 * >= > <= < =, caret/tilde ranges and || alternatives. Throws when the range
 * syntax is not supported, so a future manifest edit cannot silently pass an
 * unparsed requirement.
 */
export function satisfiesEngine(version, range) {
  const target = typeof version === 'string' ? parseSemver(version) : version
  if (target === null) throw new Error('satisfiesEngine expects a valid semver version')
  if (typeof range !== 'string' || range.trim().length === 0) return false
  for (const alternative of range.split('||')) {
    if (comparatorSetAccepts(target, parseComparatorSet(alternative))) return true
  }
  return false
}

/** Build one check record. */
function checkRecord(id, ok, detail) {
  return { id: id, ok: ok === true, detail: String(detail) }
}

/** Read a package-relative UTF-8 file, or null when unreadable. */
function readText(root, file) {
  try { return readFileSync(join(root, file), 'utf8') } catch (error) { return null }
}

/** Read and parse a package-relative JSON file, reporting why it failed. */
function readJson(root, file) {
  const text = readText(root, file)
  if (text === null) return { value: null, problem: file + ' is missing or unreadable' }
  try { return { value: JSON.parse(text), problem: null } } catch (error) { return { value: null, problem: file + ' is not valid JSON: ' + error.message } }
}

/**
 * True for a safe package-relative POSIX path: no absolute path, no drive
 * letter, no dot-dot segment. One leading ./ is tolerated because the DSH
 * manifest writes dsh.bundle.patch as ./cordis.patch.yml.
 */
function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.indexOf('\\') !== -1) return false
  if (/^[A-Za-z]:/.test(value)) return false
  if (value.startsWith('/')) return false
  let rest = value
  while (rest.startsWith('./')) rest = rest.slice(2)
  if (rest.length === 0) return false
  for (const segment of rest.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false
  }
  return true
}

/** Recursively list package-relative POSIX file paths under one directory. */
function listFiles(root, directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.DS_Store') continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...listFiles(root, absolute))
    else if (entry.isFile()) found.push(absolute.slice(root.length + 1).split(sep).join('/'))
  }
  return found.sort()
}

/** Convert a files-allowlist glob into an anchored RegExp. */
function globToRegExp(pattern) {
  let source = '^'
  for (const character of pattern) {
    if (character === '*') source += '[^/]*'
    else if (character === '?') source += '[^/]'
    else if (/[.+^$()|[\]{}\\]/.test(character)) source += '\\' + character
    else source += character
  }
  return new RegExp(source + '$')
}

/** Expand one files-allowlist entry to package-relative file paths. */
function expandFilesEntry(root, entry) {
  const problems = []
  const files = []
  const absolute = join(root, entry)
  if (!/[*?]/.test(entry)) {
    if (!existsSync(absolute)) return { files: files, problems: ['files entry ' + JSON.stringify(entry) + ' does not exist'] }
    const stats = statSync(absolute)
    if (stats.isDirectory()) return { files: listFiles(root, absolute), problems: problems }
    if (!stats.isFile()) return { files: files, problems: ['files entry ' + JSON.stringify(entry) + ' is neither a file nor a directory'] }
    return { files: [entry], problems: problems }
  }
  const segments = entry.split('/')
  const staticSegments = []
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (/[*?]/.test(segments[index])) break
    staticSegments.push(segments[index])
  }
  const base = join(root, ...staticSegments)
  if (!existsSync(base)) return { files: files, problems: ['files entry ' + JSON.stringify(entry) + ' has no matching base directory'] }
  const pattern = globToRegExp(entry)
  for (const file of listFiles(root, base)) if (pattern.test(file)) files.push(file)
  if (files.length === 0) problems.push('files entry ' + JSON.stringify(entry) + ' matches no file')
  return { files: files, problems: problems }
}
/** Check the package metadata DSH reads from package.json. */
export function validatePackageMeta(root, pkg) {
  const checks = []
  checks.push(checkRecord('package-name', pkg.name === PACKAGE_NAME, 'name is ' + JSON.stringify(pkg.name) + ', expected ' + JSON.stringify(PACKAGE_NAME)))
  checks.push(checkRecord('package-version', typeof pkg.version === 'string' && SEMVER_RE.test(pkg.version), 'version is ' + JSON.stringify(pkg.version) + ' (semver required)'))
  checks.push(checkRecord('package-license', typeof pkg.license === 'string' && pkg.license.trim().length > 0, 'license is ' + JSON.stringify(pkg.license)))
  const metadataProblems = []
  if (pkg.repository === null || typeof pkg.repository !== 'object' || typeof pkg.repository.url !== 'string' || pkg.repository.url.trim().length === 0) metadataProblems.push('repository.url')
  if (typeof pkg.homepage !== 'string' || pkg.homepage.trim().length === 0) metadataProblems.push('homepage')
  if (pkg.bugs === null || typeof pkg.bugs !== 'object' || typeof pkg.bugs.url !== 'string' || pkg.bugs.url.trim().length === 0) metadataProblems.push('bugs.url')
  checks.push(checkRecord('package-metadata', metadataProblems.length === 0, metadataProblems.length === 0 ? 'repository/homepage/bugs declared' : 'missing or empty: ' + metadataProblems.join(', ')))
  const mainPath = pkg.main
  const mainOk = typeof mainPath === 'string' && isSafeRelativePath(mainPath) && existsSync(join(root, mainPath)) && statSync(join(root, mainPath)).isFile()
  checks.push(checkRecord('package-main', mainOk, mainOk ? 'main -> ' + mainPath : 'main does not resolve to a package file: ' + JSON.stringify(mainPath)))
  checks.push(checkIcon(root, pkg))
  const exportsEntry = pkg.exports !== null && typeof pkg.exports === 'object' ? pkg.exports['./package.json'] : undefined
  checks.push(checkRecord('package-exports', exportsEntry === './package.json', 'exports["./package.json"] is ' + JSON.stringify(exportsEntry) + ', expected "./package.json" (DSH reads icon/metadata through it)'))
  return checks
}

/** Check the package-root icon: package-relative path, allowed format and size. */
function checkIcon(root, pkg) {
  const icon = pkg.icon
  if (typeof icon !== 'string' || icon.length === 0) return checkRecord('package-icon', false, 'package.json icon is missing')
  if (!isSafeRelativePath(icon)) return checkRecord('package-icon', false, 'icon is not a package-relative POSIX path: ' + JSON.stringify(icon))
  const extension = icon.split('.').pop().toLowerCase()
  if (ICON_EXTENSIONS.indexOf(extension) === -1) return checkRecord('package-icon', false, 'icon extension .' + extension + ' is not one of ' + ICON_EXTENSIONS.join('/'))
  const absolute = join(root, icon)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return checkRecord('package-icon', false, 'icon file is missing: ' + icon)
  const bytes = statSync(absolute).size
  return checkRecord('package-icon', bytes <= ICON_MAX_BYTES, icon + ' is ' + bytes + ' bytes (limit ' + ICON_MAX_BYTES + ')')
}

/** Check the dsh.bundle / dsh.client host manifest fields. */
export function validateDshManifest(root, pkg) {
  const checks = []
  const dsh = pkg.dsh !== null && typeof pkg.dsh === 'object' && !Array.isArray(pkg.dsh) ? pkg.dsh : null
  checks.push(checkRecord('dsh-manifest', dsh !== null, dsh === null ? 'package.json dsh manifest is missing or not an object' : 'dsh manifest declared'))
  if (dsh === null) return checks
  const patch = dsh.bundle !== null && typeof dsh.bundle === 'object' ? dsh.bundle.patch : undefined
  const patchOk = typeof patch === 'string' && isSafeRelativePath(patch) && existsSync(join(root, patch))
  checks.push(checkRecord('dsh-bundle-patch', patchOk, patchOk ? 'dsh.bundle.patch -> ' + patch : 'dsh.bundle.patch is missing or does not resolve to a file: ' + JSON.stringify(patch)))
  const client = dsh.client !== null && typeof dsh.client === 'object' ? dsh.client : null
  checks.push(checkRecord('dsh-client-platform', client !== null && client.platform === 'web', 'dsh.client.platform is ' + JSON.stringify(client === null ? undefined : client.platform) + ', expected "web"'))
  checks.push(checkRecord('dsh-client-immediately', client !== null && client.immediately === false, 'dsh.client.immediately is ' + JSON.stringify(client === null ? undefined : client.immediately) + ', expected false'))
  const inject = client === null ? undefined : client.inject
  const injectProblems = []
  if (!Array.isArray(inject)) injectProblems.push('inject is not an array')
  else {
    if (inject.length === 0) injectProblems.push('inject is empty')
    for (const item of inject) if (typeof item !== 'string' || !item.startsWith('@deepseek-ai/')) injectProblems.push('inject entry ' + JSON.stringify(item) + ' is not a @deepseek-ai/ package')
  }
  checks.push(checkRecord('dsh-client-inject', injectProblems.length === 0, injectProblems.length === 0 ? inject.length + ' host injection(s) declared' : injectProblems.join('; ')))
  return checks
}

/** Strip surrounding YAML quotes from one scalar value. */
function unquoteYaml(value) {
  return String(value).trim().replace(/^['"]/, '').replace(/['"]$/, '').trim()
}

/**
 * Parse the small cordis.patch.yml subset this package uses and return the
 * insert rows. A full YAML parser is deliberately out of scope; an unexpected
 * shape is reported as a problem instead of guessed.
 */
function parsePatchInsert(text) {
  const lines = String(text).split('\n')
  const entries = []
  let inInsert = false
  let insertIndent = -1
  for (const line of lines) {
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (!inInsert) {
      if (/^\s*-\s*insert\s*:\s*$/.test(line)) { inInsert = true; insertIndent = indent }
      continue
    }
    if (indent <= insertIndent) break
    const idMatch = /^\s*-\s*id\s*:\s*(.+)$/.exec(line)
    if (idMatch !== null) { entries.push({ id: unquoteYaml(idMatch[1]), name: null }); continue }
    const nameMatch = /^\s*name\s*:\s*(.+)$/.exec(line)
    if (nameMatch !== null && entries.length > 0 && entries[entries.length - 1].name === null) entries[entries.length - 1].name = unquoteYaml(nameMatch[1])
  }
  if (!inInsert) return { entries: entries, error: 'no "- insert:" list found' }
  if (entries.length === 0) return { entries: entries, error: 'insert list has no row with an id' }
  return { entries: entries, error: null }
}

/** Check that dsh.bundle.patch parses and its first insert row is this package. */
export function validatePatch(root, pkg) {
  const patch = pkg.dsh !== null && typeof pkg.dsh === 'object' && pkg.dsh.bundle !== null && typeof pkg.dsh.bundle === 'object' ? pkg.dsh.bundle.patch : undefined
  if (typeof patch !== 'string' || !isSafeRelativePath(patch)) return [checkRecord('patch-insert', false, 'dsh.bundle.patch is missing or not a package-relative path: ' + JSON.stringify(patch))]
  const text = readText(root, patch)
  if (text === null) return [checkRecord('patch-file', false, patch + ' is missing or unreadable'), checkRecord('patch-insert', false, 'cannot inspect insert rows without the patch file')]
  const parsed = parsePatchInsert(text)
  const checks = [checkRecord('patch-file', parsed.error === null, parsed.error === null ? patch + ' parses (' + parsed.entries.length + ' insert row(s))' : patch + ': ' + parsed.error)]
  const first = parsed.entries[0]
  const firstOk = first !== undefined && first.id === pkg.name && first.name === pkg.name
  checks.push(checkRecord('patch-insert', firstOk, firstOk ? 'insert[0] id/name == ' + JSON.stringify(pkg.name) : 'insert[0] is ' + JSON.stringify(first) + ', expected id/name ' + JSON.stringify(pkg.name)))
  return checks
}

/** Check the dsh.compatibility.dshReleases matrix and the engines range. */
export function validateCompatMatrix(root, pkg, dshVersion) {
  const checks = []
  const dsh = pkg.dsh !== null && typeof pkg.dsh === 'object' ? pkg.dsh : {}
  const compatibility = dsh.compatibility !== null && typeof dsh.compatibility === 'object' ? dsh.compatibility : {}
  const matrix = compatibility.dshReleases
  const plain = matrix !== null && typeof matrix === 'object' && !Array.isArray(matrix)
  const keys = plain ? Object.keys(matrix) : []
  const problems = []
  if (!plain) problems.push('dsh.compatibility.dshReleases is missing or not a plain object')
  else {
    if (keys.length < 1 || keys.length > 3) problems.push('dshReleases must list 1..3 latest releases, got ' + keys.length)
    for (const key of keys) {
      if (!SEMVER_RE.test(key)) problems.push(JSON.stringify(key) + ' is not semver')
      if (COMPAT_VALUES.indexOf(matrix[key]) === -1) problems.push(JSON.stringify(key) + ' has value ' + JSON.stringify(matrix[key]) + ' (allowed: ' + COMPAT_VALUES.join('/') + ')')
    }
    const range = pkg.engines !== null && typeof pkg.engines === 'object' ? pkg.engines.dsh : undefined
    if (typeof range === 'string') {
      for (const key of keys) {
        if (matrix[key] !== 'compatible') continue
        try {
          if (!satisfiesEngine(key, range)) problems.push(JSON.stringify(key) + ' is marked compatible but is outside engines.dsh')
        } catch (error) { problems.push('engines.dsh cannot be parsed: ' + error.message) }
      }
    }
  }
  checks.push(checkRecord('compat-matrix', problems.length === 0, problems.length === 0 ? keys.length + ' release(s) declared: ' + keys.join(', ') : problems.join('; ')))
  const range = pkg.engines !== null && typeof pkg.engines === 'object' ? pkg.engines.dsh : undefined
  let rangeOk = true
  let rangeProblems = ''
  let rangeDetail = ''
  if (typeof range !== 'string' || range.trim().length === 0) { rangeOk = false; rangeProblems = 'engines.dsh is missing or empty' }
  else {
    rangeDetail = 'engines.dsh = ' + JSON.stringify(range)
    try { satisfiesEngine('0.2.1', range) } catch (error) { rangeOk = false; rangeProblems = 'engines.dsh is not a supported semver range: ' + error.message }
  }
  if (rangeOk && dshVersion !== null && dshVersion !== undefined) {
    const matched = satisfiesEngine(dshVersion, range)
    rangeOk = matched
    rangeDetail = 'engines.dsh ' + (matched ? 'accepts' : 'rejects') + ' ' + dshVersion + ' (' + range + ')'
  }
  checks.push(checkRecord('engine-range', rangeOk, rangeOk ? rangeDetail : (rangeProblems === '' ? rangeDetail : rangeProblems + '; ' + rangeDetail)))
  if (dshVersion !== null && dshVersion !== undefined) {
    if (plain && Object.prototype.hasOwnProperty.call(matrix, dshVersion)) {
      checks.push(checkRecord('compat-version', matrix[dshVersion] === 'compatible', dshVersion + ' is ' + JSON.stringify(matrix[dshVersion]) + ' in dshReleases (expected "compatible")'))
    } else {
      checks.push(checkRecord('compat-version', true, dshVersion + ' is not listed in dshReleases; engines range decides'))
    }
  }
  return checks
}

/** Inspect generated begin/end marker pairs in one client source text. */
function inspectGeneratedBlocks(source, file, problems, requirePair) {
  const counts = {}
  for (const line of source.split('\n')) {
    const match = GENERATED_MARKER_RE.exec(line)
    if (match === null) continue
    const key = match[1]
    if (counts[key] === undefined) counts[key] = { begin: 0, end: 0, beginLine: -1, endLine: -1 }
    counts[key][match[2]] += 1
    counts[key][match[2] + 'Line'] = line
  }
  const keys = Object.keys(counts)
  if (requirePair && keys.length === 0) problems.push(file + ': no generated marker pairs found')
  for (const key of keys) {
    const entry = counts[key]
    if (entry.begin !== 1) problems.push(file + ': expected exactly one "' + key + ':begin" marker, found ' + entry.begin)
    if (entry.end !== 1) problems.push(file + ': expected exactly one "' + key + ':end" marker, found ' + entry.end)
    if (entry.begin === 1 && entry.end === 1 && entry.beginLine !== -1 && entry.endLine !== -1) {
      if (source.indexOf(entry.endLine) < source.indexOf(entry.beginLine)) problems.push(file + ': "' + key + ':end" comes before "' + key + ':begin"')
    }
  }
}

/** True when a source text carries exactly the expected PLUGIN_VERSION constant. */
function versionConstantMatches(source, version) {
  if (source === null) return false
  const match = PLUGIN_VERSION_RE.exec(source)
  return match !== null && match[1] === version
}

/** Check the client entry, lazy chunks, generated markers and version constant. */
export function validateClientBundle(root, pkg) {
  const checks = []
  const client = readText(root, 'client.js')
  checks.push(checkRecord('client-loader', client !== null && client.indexOf('window.__ModuleLoader__.load') !== -1, client === null ? 'client.js is missing' : 'client.js registers through window.__ModuleLoader__.load'))
  checks.push(checkRecord('client-module-id', client !== null && MODULE_ID_RE.test(client), client === null ? 'client.js is missing' : 'client.js module id is ' + JSON.stringify(PACKAGE_NAME)))
  const content = readText(root, 'client.content.js')
  checks.push(checkRecord('client-version', versionConstantMatches(client, pkg.version), 'client.js PLUGIN_VERSION matches package.json version'))
  checks.push(checkRecord('client-content-version', versionConstantMatches(content, pkg.version), 'client.content.js PLUGIN_VERSION matches package.json version'))
  const chunkProblems = []
  for (const file of CHARACTER_CHUNKS) {
    const text = readText(root, file)
    if (text === null) { chunkProblems.push(file + ' is missing'); continue }
    if (text.indexOf('window.__ModuleLoader__.load') === -1) chunkProblems.push(file + ' does not register through window.__ModuleLoader__.load')
    if (!MODULE_ID_RE.test(text)) chunkProblems.push(file + ' does not register module id ' + JSON.stringify(PACKAGE_NAME))
  }
  checks.push(checkRecord('client-chunks', chunkProblems.length === 0, chunkProblems.length === 0 ? CHARACTER_CHUNKS.length + ' animation chunks register the package id' : chunkProblems.join('; ')))
  const markerProblems = []
  inspectGeneratedBlocks(client === null ? '' : client, 'client.js', markerProblems, true)
  if (content === null) markerProblems.push('client.content.js is missing')
  else inspectGeneratedBlocks(content, 'client.content.js', markerProblems, false)
  checks.push(checkRecord('client-generated-blocks', markerProblems.length === 0, markerProblems.length === 0 ? 'generated begin/end markers are paired' : markerProblems.join('; ')))
  return checks
}

/** Check required files, locale metadata and the plugin-page detail document. */
export function validateResources(root, pkg) {
  const required = ['cordis.patch.yml', 'icon.png', 'locale/zh.json', 'locale/en.json', 'docs/DETAIL.md', 'README.md', 'LICENSE', 'LICENSE-ART', 'NOTICE']
  const missing = []
  for (const file of required) if (!existsSync(join(root, file)) || !statSync(join(root, file)).isFile()) missing.push(file)
  const checks = [checkRecord('resources', missing.length === 0, missing.length === 0 ? required.length + ' required resource/doc files present' : 'missing: ' + missing.join(', '))]
  const localeFiles = ['locale/zh.json', 'locale/en.json']
  const metas = {}
  const metaProblems = []
  for (const file of localeFiles) {
    const parsed = readJson(root, file)
    if (parsed.problem !== null) { metaProblems.push(parsed.problem); continue }
    const meta = parsed.value !== null && typeof parsed.value === 'object' ? parsed.value.meta : undefined
    metas[file] = meta
    if (meta === null || typeof meta !== 'object') { metaProblems.push(file + ' has no meta object'); continue }
    if (meta.version !== pkg.version) metaProblems.push(file + ' meta.version is ' + JSON.stringify(meta.version) + ', expected ' + JSON.stringify(pkg.version))
    if (typeof meta.title !== 'string' || meta.title.trim().length === 0) metaProblems.push(file + ' meta.title is empty')
    if (typeof meta.description !== 'string' || meta.description.trim().length === 0) metaProblems.push(file + ' meta.description is empty')
  }
  checks.push(checkRecord('locale-meta', metaProblems.length === 0, metaProblems.length === 0 ? 'zh/en meta.version/title/description are present and consistent' : metaProblems.join('; ')))
  const detailProblems = []
  const details = []
  for (const file of localeFiles) {
    const meta = metas[file]
    if (meta === null || typeof meta !== 'object') continue
    const detail = meta.detail
    if (typeof detail !== 'string' || detail.trim().length === 0) { detailProblems.push(file + ' meta.detail is empty'); continue }
    if (!isSafeRelativePath(detail)) { detailProblems.push(file + ' meta.detail is not a package-relative POSIX path: ' + JSON.stringify(detail)); continue }
    const absolute = join(root, detail)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) { detailProblems.push(file + ' meta.detail points at a missing file: ' + detail); continue }
    const bytes = statSync(absolute).size
    if (bytes > DETAIL_MAX_BYTES) detailProblems.push(file + ' meta.detail ' + detail + ' is ' + bytes + ' bytes (limit ' + DETAIL_MAX_BYTES + ')')
    details.push(detail)
  }
  if (details.length > 0 && new Set(details).size > 1) detailProblems.push('zh/en meta.detail disagree: ' + details.join(' vs '))
  checks.push(checkRecord('locale-detail', detailProblems.length === 0, detailProblems.length === 0 ? 'meta.detail resolves to a document within ' + DETAIL_MAX_BYTES + ' bytes (' + (details[0] === undefined ? '' : details[0]) + ')' : detailProblems.join('; ')))
  return checks
}

/** Collect the packed text files the hygiene scan reads. */
function collectHygieneFiles(root) {
  const files = new Set(['index.js', 'content-extension.mjs', 'cordis.patch.yml', 'README.md'])
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('client.') && entry.endsWith('.js')) files.add(entry)
  }
  for (const directory of ['docs', 'locale']) {
    const absolute = join(root, directory)
    if (!existsSync(absolute)) continue
    for (const entry of readdirSync(absolute)) {
      if (directory === 'docs' && entry.endsWith('.md')) files.add('docs/' + entry)
      if (directory === 'locale' && entry.endsWith('.json')) files.add('locale/' + entry)
    }
  }
  const collected = []
  for (const file of files) if (existsSync(join(root, file)) && statSync(join(root, file)).isFile()) collected.push(file)
  return collected.sort()
}

/** 1-based line number for a character index. */
function lineAt(text, index) {
  return text.slice(0, index).split('\n').length
}

/** Find private paths and secret-like tokens in one text (labels never echo values). */
function scanHygiene(text) {
  const findings = []
  for (const rule of PRIVATE_PATH_RULES) {
    const pattern = new RegExp(rule.pattern.source, 'g')
    let match
    while ((match = pattern.exec(text)) !== null) {
      if (rule.id === 'home-shorthand' && HOME_REFERENCE_ALLOWLIST.indexOf(match[1]) !== -1) continue
      findings.push({ rule: rule, index: match.index })
    }
  }
  let token
  while ((token = SECRET_TOKEN_RE.exec(text)) !== null) findings.push({ rule: { id: 'secret-token', label: 'secret-like token' }, index: token.index })
  return findings.sort(function (left, right) { return left.index - right.index })
}

/** Fail when a packed text file leaks a private host path or secret-like token. */
export function validateHygiene(root) {
  const files = collectHygieneFiles(root)
  const violations = []
  for (const file of files) {
    const text = readText(root, file)
    if (text === null) continue
    for (const finding of scanHygiene(text)) violations.push(file + ':' + lineAt(text, finding.index) + ' ' + finding.rule.label)
  }
  const detail = violations.length === 0 ? 'no private absolute paths or secret-like tokens in ' + files.length + ' packed text files' : violations.length + ' violation(s): ' + violations.slice(0, 8).join(' | ') + (violations.length > 8 ? ' | ...' : '')
  return [checkRecord('hygiene', violations.length === 0, detail)]
}

/** Check the files allowlist expansion and the required-runtime coverage. */
export function validateFilesAllowlist(root, pkg) {
  const checks = []
  const entries = Array.isArray(pkg.files) ? pkg.files : []
  const problems = []
  const covered = new Set(ALWAYS_PACKED)
  if (entries.length === 0) problems.push('package.json files allowlist is missing or empty')
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.length === 0) { problems.push('files contains a non-string entry'); continue }
    const expanded = expandFilesEntry(root, entry)
    problems.push(...expanded.problems)
    for (const file of expanded.files) covered.add(file)
  }
  checks.push(checkRecord('files-allowlist', problems.length === 0, problems.length === 0 ? entries.length + ' allowlist entries expand to ' + covered.size + ' packed files' : problems.join('; ')))
  const coverageProblems = []
  for (const file of REQUIRED_PACKED) {
    if (!existsSync(join(root, file))) coverageProblems.push('required runtime file is missing on disk: ' + file)
    if (!covered.has(file)) coverageProblems.push('required runtime file is not covered by the files allowlist: ' + file)
  }
  const packageEntries = []
  if (typeof pkg.main === 'string') packageEntries.push(pkg.main)
  if (typeof pkg.icon === 'string') packageEntries.push(pkg.icon)
  const exportsMap = pkg.exports !== null && typeof pkg.exports === 'object' ? pkg.exports : {}
  for (const subpath of Object.keys(exportsMap)) {
    const target = exportsMap[subpath]
    if (typeof target !== 'string') { coverageProblems.push('exports ' + subpath + ' is not a plain path'); continue }
    if (target.indexOf('*') !== -1) {
      const pattern = globToRegExp(target.replace(/^[.]\//, ''))
      let matched = 0
      for (const file of covered) if (pattern.test(file)) matched += 1
      if (matched === 0) coverageProblems.push('exports ' + subpath + ' pattern ' + JSON.stringify(target) + ' covers no packed file')
      continue
    }
    packageEntries.push(target.replace(/^[.]\//, ''))
  }
  for (const entry of packageEntries) if (!covered.has(entry)) coverageProblems.push('package entry ' + JSON.stringify(entry) + ' is not covered by the files allowlist')
  checks.push(checkRecord('files-required', coverageProblems.length === 0, coverageProblems.length === 0 ? REQUIRED_PACKED.length + ' required runtime files and every package entry are covered' : coverageProblems.join('; ')))
  return checks
}

/** Run every check against one package root and return the JSON report object. */
export function runChecks(options = {}) {
  const root = resolve(options.root === undefined ? DEFAULT_ROOT : options.root)
  const dshVersion = options.dshVersion === undefined ? null : options.dshVersion
  const checks = []
  let pkg = null
  const parsed = readJson(root, 'package.json')
  if (parsed.problem !== null) checks.push(checkRecord('package-json', false, parsed.problem))
  else pkg = parsed.value
  if (pkg !== null && typeof pkg === 'object' && !Array.isArray(pkg)) {
    checks.push(...validatePackageMeta(root, pkg))
    checks.push(...validateDshManifest(root, pkg))
    checks.push(...validatePatch(root, pkg))
    checks.push(...validateCompatMatrix(root, pkg, dshVersion))
    checks.push(...validateClientBundle(root, pkg))
    checks.push(...validateResources(root, pkg))
    checks.push(...validateHygiene(root))
    checks.push(...validateFilesAllowlist(root, pkg))
  } else if (parsed.problem === null) {
    checks.push(checkRecord('package-json', false, 'package.json must contain a JSON object'))
  }
  return {
    ok: checks.length > 0 && checks.every(function (check) { return check.ok }),
    target: root,
    dshVersion: dshVersion,
    checks: checks,
  }
}

/** Parse CLI arguments; throws a usage-error message. */
function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, dshVersion: null, json: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') { options.help = true; continue }
    if (argument === '--json') { options.json = true; continue }
    if (argument === '--root' || argument.startsWith('--root=')) {
      index += 1
      const value = argument === '--root' ? argv[index] : argument.slice('--root='.length)
      if (value === undefined || value.length === 0) throw new Error('--root requires a directory')
      options.root = resolve(value)
      continue
    }
    if (argument === '--dsh-version' || argument.startsWith('--dsh-version=')) {
      index += 1
      const value = argument === '--dsh-version' ? argv[index] : argument.slice('--dsh-version='.length)
      if (value === undefined || value.length === 0) throw new Error('--dsh-version requires a version')
      options.dshVersion = value
      continue
    }
    throw new Error('unknown argument: ' + argument)
  }
  if (options.help) return options
  if (!existsSync(options.root) || !statSync(options.root).isDirectory()) throw new Error('root is not a directory: ' + options.root)
  if (options.dshVersion !== null && parseSemver(options.dshVersion) === null) throw new Error('invalid --dsh-version ' + JSON.stringify(options.dshVersion) + ' (expects X.Y.Z[-prerelease])')
  return options
}

/** CLI entry point; returns the process exit code (0/1/2). */
export function main(argv = process.argv.slice(2)) {
  let options
  try { options = parseArgs(argv) } catch (error) {
    console.error('[verify-dsh] ' + error.message)
    console.error('[verify-dsh] usage: ' + USAGE)
    return 2
  }
  if (options.help) { console.log('usage: ' + USAGE); return 0 }
  const report = runChecks(options)
  if (options.json) {
    console.log(JSON.stringify({ ok: report.ok, target: report.target, dshVersion: report.dshVersion, checks: report.checks }))
    return report.ok ? 0 : 1
  }
  console.log('[verify-dsh] target: ' + report.target)
  if (report.dshVersion !== null) console.log('[verify-dsh] dsh version: ' + report.dshVersion)
  for (const check of report.checks) console.log('[verify-dsh] ' + (check.ok ? 'ok  ' : 'FAIL') + ' ' + check.id + ': ' + check.detail)
  const failed = report.checks.filter(function (check) { return !check.ok }).length
  console.log('[verify-dsh] ' + (report.ok ? 'ok (' + report.checks.length + ' checks)' : 'FAILED (' + failed + ' of ' + report.checks.length + ' checks)'))
  return report.ok ? 0 : 1
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exitCode = main()
