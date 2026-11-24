#!/usr/bin/env node
/**
 * Offline 'breaks after install' invariants for the dsh-famling tarball
 * (WP-B release gating, layer 2.5).
 *
 * A tarball is the product: the working tree can be green while an install is
 * broken (an exports target that is not packed, a generated chunk with the
 * wrong module id, a manifest that disagrees with package.json, a shipped
 * developer path). This gate checks those invariants without network access,
 * without installing anything and without writing to the tree:
 *
 *   1. real packed set from `npm pack --dry-run --json --ignore-scripts`,
 *      aligned with scripts/check-package.mjs expectedPacked (npm extras are
 *      tolerated only for npm's always-included file names);
 *   2. every exports target resolves to a packed file (wildcards need >=1 match);
 *   3. required runtime files are packed, forbidden paths are not;
 *   4. packed bytes stay under the 2 MiB budget (actual values printed);
 *   5. cordis.patch.yml insert id/name equals the package name;
 *   6. client.js + the three anim chunks register under the package name and
 *      generated begin/end marker pairs are balanced;
 *   7. package.json == client.js/client.content.js PLUGIN_VERSION ==
 *      PLUGIN-MANIFEST.package.version, plus the real
 *      `plugin-manifest.mjs --check` drift gate when that script exists;
 *   8. locale/zh.json + en.json parse and expose the same top-level keys;
 *      the icon exists and stays under 256 KiB;
 *   9. packed text files carry no private absolute path or API token.
 *
 * `npm pack` may be slow or unavailable (WSL, sandboxed CI). The gate bounds it
 * with a 20s timeout and falls back to the files allowlist expansion, but it
 * never pretends the tarball was verified: --json reports
 * `packing.tarballVerified: false` plus the fallback reason, and the human
 * output prints a WARN line.
 *
 * Usage:
 *   node scripts/prepublish-check.mjs                  # human output
 *   node scripts/prepublish-check.mjs --json           # machine-readable
 *   node scripts/prepublish-check.mjs --no-npm         # force the fallback path
 *   node scripts/prepublish-check.mjs --strict-private-paths  # /mnt path = failure
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expectedPacked, loadPackage } from './check-package.mjs'

/** Absolute plugin package root (the parent of scripts/). */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Stable schema version of the --json payload. */
export const SCHEMA_VERSION = 1
/** Hard budget for the packed (uncompressed) tarball contents: 2 MiB. */
export const TARBALL_BUDGET_BYTES = 2 * 1024 * 1024
/** Icon budget enforced by DSH plugin manifests: 256 KiB. */
export const ICON_MAX_BYTES = 256 * 1024
/** `npm pack` wall-clock cap before falling back to the allowlist expansion. */
export const PACK_TIMEOUT_MS = 20_000
/** `plugin-manifest.mjs --check` rebuild cap. */
export const MANIFEST_TIMEOUT_MS = 20_000
/** Icon file extensions DSH accepts. */
export const ICON_EXTENSIONS = Object.freeze(['svg', 'png', 'jpg', 'jpeg', 'webp'])

/** Runtime files a consumer needs; exporting something absent here breaks install. */
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
  'docs/DETAIL.md',
  'docs/LEGAL-NOTICE-2026-11-18.md',
  'locale/en.json',
  'locale/zh.json',
  'package.json',
])

/** Never ship these, even if someone widens `files` by accident. */
export const FORBIDDEN_PACKED = Object.freeze([
  /^test\//,
  /^scripts\//,
  /^\.github\//,
  /^node_modules\//,
  /^\.git\//,
  /\.tgz$/,
  /^package-lock\.json$/,
  /^\.npmrc$/,
  /^\.gitignore$/,
])

/** `npm pack` always includes these basenames even when `files` does not list them. */
export const ALLOWED_NPM_EXTRA = Object.freeze([
  'package.json',
  'README.md',
  'LICENSE',
  'LICENCE',
  'LICENSE.md',
  'LICENCE.md',
  'NOTICE',
  'CHANGELOG.md',
  'CHANGELOG',
  'HISTORY.md',
  'HISTORY',
])

/** Packed text files are scanned for developer-only absolute paths / tokens. */
export const TEXT_FILE_PATTERN = /\.(?:js|mjs|cjs|json|ya?ml|md|txt)$/
/** Private absolute path / secret patterns that must never be packed. */
export const PRIVATE_PATH_PATTERNS = Object.freeze([
  { id: 'windows-drive-path', pattern: /\b[A-Za-z]:\\[A-Za-z0-9_.-]+\\/ },
  { id: 'windows-user-profile', pattern: /[A-Za-z]:\\Users\\/i },
  { id: 'file-url', pattern: /file:\/\/\// },
  { id: 'api-token', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
])

/**
 * WSL-style private path. Reported as a warning by default because the
 * shipped docs may quote a WSL smoke-test command; use --strict-private-paths
 * once those docs are sanitized.
 */
export const WSL_PATH_PATTERN = /\/mnt\/[A-Za-z]+\//

/** Client files whose DSH module id must equal the package name. */
export const CLIENT_MODULE_FILES = Object.freeze([
  'client.js',
  'client.content.js',
  'client.anims.human.js',
  'client.anims.cat.js',
  'client.anims.dog.js',
])

const MODULE_ID_RE = /window\.__ModuleLoader__\.load\(\s*\{\s*(?:\r?\n\s*)?id:\s*['\"]([^'\"]+)['\"]/
const BLOCK_MARKER_RE = /\/\/ <dsh-famling:([A-Za-z0-9._-]+):(begin|end)>/g
const PLUGIN_VERSION_RE = /const PLUGIN_VERSION = '([^']+)'/g
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function toPosix(value) {
  return String(value).split('\\').join('/')
}

function safeStatSize(path) {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

function safeRead(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/**
 * Human byte formatter (exact bytes are still printed in failure messages).
 * @param {number} bytes Byte count.
 * @returns {string} e.g. '821.8 KiB'.
 */
export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return String(value) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB'
  return (value / (1024 * 1024)).toFixed(2) + ' MiB'
}

function tailOfOutput(text, maxLines = 8) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').trim().split('\n')
  return lines.slice(-maxLines).join('\n')
}

function parsePackJson(stdout) {
  const text = String(stdout ?? '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('no JSON array in npm pack output')
  return JSON.parse(text.slice(start, end + 1))
}

/**
 * Read the real packed file set via `npm pack --dry-run --json --ignore-scripts`.
 * Falls back to the files-allowlist expansion (never claiming the tarball was
 * verified) when npm is missing, fails, times out or prints unparseable JSON.
 * @param {{ root: string, pkg: any, expansion: { paths: string[], problems: string[] }, npm?: boolean, timeoutMs?: number }} options Packing options.
 * @returns {{ source: 'npm'|'fallback', reason: string|null, files: { path: string, bytes: number }[], tarballBytes: number|null, unpackedBytes: number|null, entryCount: number|null, filename: string|null }} Packing report.
 */
export function collectPackedFiles(options) {
  const root = resolve(options.root)
  const timeoutMs = options.timeoutMs ?? PACK_TIMEOUT_MS
  const fallback = (reason) => ({
    source: 'fallback',
    reason,
    files: options.expansion.paths
      .map((file) => ({ path: toPosix(file), bytes: safeStatSize(join(root, file)) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    tarballBytes: null,
    unpackedBytes: null,
    entryCount: null,
    filename: null,
  })
  if (options.npm === false) return fallback('npm packing disabled (--no-npm)')
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      npm_config_loglevel: 'warn',
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
      npm_config_audit: 'false',
    },
  })
  if (result.error) {
    const code = result.error.code === 'ETIMEDOUT' ? 'timed out after ' + timeoutMs + 'ms' : result.error.message
    return fallback('could not run npm pack: ' + code)
  }
  if (result.status !== 0) {
    const stderr = tailOfOutput(result.stderr)
    return fallback('npm pack --dry-run failed (exit ' + String(result.status) + ')' + (stderr === '' ? '' : ': ' + stderr))
  }
  let parsed
  try {
    parsed = parsePackJson(result.stdout)
  } catch (error) {
    return fallback('could not parse npm pack --dry-run JSON: ' + error.message)
  }
  const entry = Array.isArray(parsed) ? parsed[0] : null
  if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.files)) {
    return fallback('npm pack --dry-run JSON has no files array')
  }
  const files = entry.files
    .filter((file) => file !== null && typeof file === 'object' && typeof file.path === 'string')
    .map((file) => ({ path: toPosix(file.path), bytes: Number.isFinite(file.size) ? file.size : safeStatSize(join(root, toPosix(file.path))) }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return {
    source: 'npm',
    reason: null,
    files,
    tarballBytes: Number.isFinite(entry.size) ? entry.size : null,
    unpackedBytes: Number.isFinite(entry.unpackedSize) ? entry.unpackedSize : null,
    entryCount: Number.isFinite(entry.entryCount) ? entry.entryCount : null,
    filename: typeof entry.filename === 'string' ? entry.filename : null,
  }
}

function checkInventory(expansion, packing) {
  const problems = [...expansion.problems]
  const packedPaths = packing.files.map((file) => file.path)
  const packedSet = new Set(packedPaths)
  if (packing.source === 'npm') {
    const expectedSet = new Set(expansion.paths)
    for (const file of expansion.paths) {
      if (!packedSet.has(file)) problems.push('npm tarball is missing declared file ' + JSON.stringify(file))
    }
    for (const file of packedPaths) {
      if (!expectedSet.has(file) && !ALLOWED_NPM_EXTRA.includes(file)) problems.push('npm tarball contains undeclared file ' + JSON.stringify(file))
    }
  }
  return {
    id: 'pack-inventory',
    ok: problems.length === 0,
    detail: packing.source === 'npm'
      ? 'npm pack --dry-run: ' + packedPaths.length + ' files, aligned with the files allowlist'
      : 'fallback: files allowlist expansion, tarball NOT verified',
    problems,
    warnings: [],
  }
}

function wildcardRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp('^' + escaped + '$')
}

/**
 * Every exports target must be packed (wildcard targets need at least one match).
 * @param {any} pkg Parsed package.json.
 * @param {string[]} packedPaths Packed package-relative paths.
 * @returns {{ id: string, ok: boolean, detail: string, problems: string[], warnings: string[] }} Check result.
 */
export function checkExportsTargets(pkg, packedPaths) {
  const problems = []
  const expectedFiles = new Set(packedPaths)
  const exportsField = pkg.exports !== null && typeof pkg.exports === 'object' ? pkg.exports : {}
  const entries = Object.entries(exportsField)
  for (const [subpath, target] of entries) {
    if (typeof target !== 'string') {
      problems.push('exports ' + JSON.stringify(subpath) + ' is not a plain path')
      continue
    }
    const normalized = target.replace(/^\.\//, '')
    if (normalized.includes('*')) {
      const regex = wildcardRegExp(normalized)
      const matches = packedPaths.filter((file) => regex.test(file))
      if (matches.length === 0) problems.push('exports ' + JSON.stringify(subpath) + ' pattern ' + JSON.stringify(target) + ' matches no packed file')
      continue
    }
    if (!expectedFiles.has(normalized)) problems.push('exports ' + JSON.stringify(subpath) + ' target ' + JSON.stringify(target) + ' is not in the tarball')
  }
  return {
    id: 'exports-in-pack',
    ok: problems.length === 0,
    detail: entries.length + ' export target(s) covered by the packed files',
    problems,
    warnings: [],
  }
}

/** Required runtime files must be packed. */
export function checkRequiredPacked(packedPaths) {
  const packedSet = new Set(packedPaths)
  const problems = REQUIRED_PACKED.filter((file) => !packedSet.has(file)).map((file) => 'required runtime file is not packed: ' + file)
  return {
    id: 'required-runtime',
    ok: problems.length === 0,
    detail: REQUIRED_PACKED.length + ' required runtime files present',
    problems,
    warnings: [],
  }
}

/** Forbidden paths (tests, scripts, CI metadata, local install state) must not be packed. */
export function checkForbiddenPacked(packedPaths) {
  const problems = []
  for (const file of packedPaths) {
    for (const pattern of FORBIDDEN_PACKED) {
      if (pattern.test(file)) {
        problems.push('forbidden path is packed: ' + JSON.stringify(file))
        break
      }
    }
  }
  return {
    id: 'forbidden-files',
    ok: problems.length === 0,
    detail: 'no test/scripts/.github/lock/install-state files packed',
    problems,
    warnings: [],
  }
}

/** Enforce the packed-bytes budget (uncompressed contents of the tarball). */
export function checkSizeBudget(packing) {
  const problems = []
  const total = packing.files.reduce((sum, file) => sum + (Number.isFinite(file.bytes) ? file.bytes : 0), 0)
  if (!(total > 0)) problems.push('packed byte total is not positive')
  if (total > TARBALL_BUDGET_BYTES) {
    problems.push('packed bytes ' + total + ' (' + formatBytes(total) + ') exceed the 2 MiB budget (' + TARBALL_BUDGET_BYTES + ' bytes)')
  }
  const tarball = typeof packing.tarballBytes === 'number' ? formatBytes(packing.tarballBytes) + ' tarball' : 'tarball size unknown (fallback)'
  return {
    id: 'size-budget',
    ok: problems.length === 0,
    detail: formatBytes(total) + ' packed / ' + tarball + ' / limit ' + formatBytes(TARBALL_BUDGET_BYTES),
    problems,
    warnings: [],
  }
}

/**
 * cordis.patch.yml insert id/name must equal the package name (minimal YAML read).
 * @param {string} root Package root.
 * @param {string} name Expected package name.
 * @returns {{ id: string, ok: boolean, detail: string, problems: string[], warnings: string[] }} Check result.
 */
export function checkCordisPatch(root, name) {
  const problems = []
  const text = safeRead(join(root, 'cordis.patch.yml'))
  if (text === null) {
    return { id: 'cordis-patch', ok: false, detail: 'cordis.patch.yml missing', problems: ['cordis.patch.yml is missing or unreadable'], warnings: [] }
  }
  const insertIndex = text.search(/^[ \t]*(?:-[ \t]*)?insert:[ \t]*$/m)
  if (insertIndex < 0) {
    problems.push('cordis.patch.yml has no insert: block')
  } else {
    const block = text.slice(insertIndex)
    const id = block.match(/^[ \t]*(?:-[ \t]*)?id:[ \t]*['\"]?([^'\"\s#]+)['\"]?[ \t]*$/m)
    const insertName = block.match(/^[ \t]*(?:-[ \t]*)?name:[ \t]*['\"]?([^'\"\s#]+)['\"]?[ \t]*$/m)
    if (id === null) problems.push('cordis.patch.yml insert block has no id')
    else if (id[1] !== name) problems.push('cordis.patch.yml insert id is ' + JSON.stringify(id[1]) + ', expected ' + JSON.stringify(name))
    if (insertName === null) problems.push('cordis.patch.yml insert block has no name')
    else if (insertName[1] !== name) problems.push('cordis.patch.yml insert name is ' + JSON.stringify(insertName[1]) + ', expected ' + JSON.stringify(name))
  }
  return {
    id: 'cordis-patch',
    ok: problems.length === 0,
    detail: 'insert id/name == ' + name,
    problems,
    warnings: [],
  }
}

/**
 * Client entry + anim chunks must register under the package name, and the
 * generated marker pairs in client.js/client.content.js must be balanced.
 * @param {string} root Package root.
 * @param {string} name Expected DSH module id / package name.
 * @returns {{ id: string, ok: boolean, detail: string, problems: string[], warnings: string[] }} Check result.
 */
export function checkClientModuleIds(root, name) {
  const problems = []
  for (const file of CLIENT_MODULE_FILES) {
    const text = safeRead(join(root, file))
    if (text === null) {
      problems.push(file + ' is missing')
      continue
    }
    const match = text.match(MODULE_ID_RE)
    if (match === null) problems.push(file + ': window.__ModuleLoader__.load({ id: ... }) registration not found')
    else if (match[1] !== name) problems.push(file + ': module id is ' + JSON.stringify(match[1]) + ', expected ' + JSON.stringify(name))
    if (file !== 'client.js' && file !== 'client.content.js') continue
    const blocks = new Map()
    for (const marker of text.matchAll(new RegExp(BLOCK_MARKER_RE.source, 'g'))) {
      const counts = blocks.get(marker[1]) ?? { begin: 0, end: 0 }
      counts[marker[2]] += 1
      blocks.set(marker[1], counts)
    }
    if (blocks.size === 0) {
      if (file === 'client.js') problems.push('client.js has no generated <dsh-famling:...:begin/end> blocks')
      continue
    }
    for (const [block, counts] of blocks) {
      if (counts.begin !== counts.end || counts.begin === 0) {
        problems.push(file + ': generated block ' + block + ' has ' + counts.begin + ' begin / ' + counts.end + ' end marker(s)')
      }
    }
  }
  return {
    id: 'client-module-ids',
    ok: problems.length === 0,
    detail: CLIENT_MODULE_FILES.length + ' client files register as ' + name + ', generated blocks balanced',
    problems,
    warnings: [],
  }
}

function clientVersionOf(root, file) {
  const text = safeRead(join(root, file))
  if (text === null) return { present: false, version: null, count: 0 }
  const matches = [...text.matchAll(new RegExp(PLUGIN_VERSION_RE.source, 'g'))].map((match) => match[1])
  return { present: true, version: matches[0] ?? null, count: matches.length }
}

/**
 * Version truth: package.json == client PLUGIN_VERSION == PLUGIN-MANIFEST.package.version,
 * plus the authoritative `plugin-manifest.mjs --check` drift gate when present.
 * @param {string} root Package root.
 * @param {any} pkg Parsed package.json.
 * @returns {{ id: string, ok: boolean, detail: string, problems: string[], warnings: string[] }} Check result.
 */
export function checkVersionTruth(root, pkg) {
  const problems = []
  const warnings = []
  const version = typeof pkg.version === 'string' ? pkg.version : null
  if (version === null || !SEMVER_RE.test(version)) problems.push('package.json version is not semver: ' + JSON.stringify(pkg.version))
  for (const file of ['client.js', 'client.content.js']) {
    const found = clientVersionOf(root, file)
    if (!found.present) { problems.push(file + ' is missing'); continue }
    if (found.count === 0) problems.push(file + ': const PLUGIN_VERSION not found')
    else if (found.count > 1) problems.push(file + ': ' + found.count + ' PLUGIN_VERSION constants (expected exactly 1)')
    else if (found.version !== version) problems.push(file + ': PLUGIN_VERSION ' + JSON.stringify(found.version) + ' != package.json ' + JSON.stringify(version))
  }
  const manifestPath = join(root, 'PLUGIN-MANIFEST.json')
  if (!existsSync(manifestPath)) {
    problems.push('PLUGIN-MANIFEST.json is missing; run: node scripts/plugin-manifest.mjs')
  } else {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const manifestVersion = manifest?.package?.version ?? null
      if (manifestVersion !== version) problems.push('PLUGIN-MANIFEST.package.version ' + JSON.stringify(manifestVersion) + ' != package.json ' + JSON.stringify(version))
    } catch (error) {
      problems.push('PLUGIN-MANIFEST.json is not valid JSON: ' + error.message)
    }
  }
  const script = join(root, 'scripts', 'plugin-manifest.mjs')
  if (!existsSync(script)) {
    warnings.push('scripts/plugin-manifest.mjs is absent; skipped the manifest rebuild/drift check')
  } else {
    const result = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8', timeout: MANIFEST_TIMEOUT_MS })
    const output = [result.stdout, result.stderr].filter((value) => typeof value === 'string' && value !== '').join('\n')
    if (result.error) problems.push('could not run plugin-manifest.mjs --check: ' + result.error.message)
    else if (result.status !== 0) problems.push('plugin-manifest.mjs --check failed: ' + tailOfOutput(output))
  }
  return {
    id: 'version-truth',
    ok: problems.length === 0,
    detail: 'package ' + String(version) + ', client files and PLUGIN-MANIFEST agree',
    problems,
    warnings,
  }
}

/**
 * locale/zh.json + en.json must parse, expose identical top-level keys and
 * agree with the package version in meta.version.
 * @param {string} root Package root.
 * @param {any} pkg Parsed package.json.
 * @returns {{ id: string, ok: boolean, detail: string, problems: string[], warnings: string[] }} Check result.
 */
export function checkLocaleFiles(root, pkg) {
  const problems = []
  const parsed = new Map()
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const text = safeRead(join(root, file))
    if (text === null) { problems.push(file + ' is missing'); continue }
    try {
      parsed.set(file, JSON.parse(text))
    } catch (error) {
      problems.push(file + ' is not valid JSON: ' + error.message)
    }
  }
  const zh = parsed.get('locale/zh.json')
  const en = parsed.get('locale/en.json')
  if (zh !== undefined && en !== undefined) {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    const missing = zhKeys.filter((key) => !enKeys.includes(key))
    const extra = enKeys.filter((key) => !zhKeys.includes(key))
    if (missing.length > 0) problems.push('locale/en.json is missing top-level keys: ' + missing.join(', '))
    if (extra.length > 0) problems.push('locale/en.json has extra top-level keys: ' + extra.join(', '))
  }
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const data = parsed.get(file)
    if (data === undefined) continue
    const meta = data.meta
    if (meta === null || typeof meta !== 'object') problems.push(file + ' has no meta object')
    else if (meta.version !== pkg.version) problems.push(file + ': meta.version ' + JSON.stringify(meta.version) + ' != package.json ' + JSON.stringify(pkg.version))
  }
  return {
    id: 'locale-files',
    ok: problems.length === 0,
    detail: 'zh/en locale JSON parse and expose identical top-level keys',
    problems,
    warnings: [],
  }
}

/**
 * The icon must exist, be a supported image type and stay under 256 KiB.
 * @param {string} root Package root.
 * @param {any} pkg Parsed package.json.
 * @returns {{ id: string, ok: boolean, detail: string, problems: string[], warnings: string[] }} Check result.
 */
export function checkIcon(root, pkg) {
  const problems = []
  const relative = typeof pkg.icon === 'string' && pkg.icon !== '' ? pkg.icon : 'icon.png'
  const path = join(root, relative)
  let detail = relative + ' missing'
  if (!existsSync(path)) {
    problems.push('icon ' + relative + ' is missing')
  } else {
    const stat = statSync(path)
    if (!stat.isFile()) problems.push('icon ' + relative + ' is not a regular file')
    const extension = extname(relative).slice(1).toLowerCase()
    if (!ICON_EXTENSIONS.includes(extension)) problems.push('icon extension .' + extension + ' is not one of ' + ICON_EXTENSIONS.join('/'))
    if (stat.size <= 0) problems.push('icon is empty')
    if (stat.size > ICON_MAX_BYTES) problems.push('icon is ' + stat.size + ' bytes (' + formatBytes(stat.size) + '), limit is 256 KiB (' + ICON_MAX_BYTES + ' bytes)')
    detail = relative + ' ' + formatBytes(stat.size) + ' (limit ' + formatBytes(ICON_MAX_BYTES) + ')'
  }
  return { id: 'icon', ok: problems.length === 0, detail, problems, warnings: [] }
}

/**
 * Scan packed text files for developer-only absolute paths and secret tokens.
 * WSL `/mnt/...` paths are warnings unless strict mode is requested.
 * @param {string} root Package root.
 * @param {string[]} packedPaths Packed package-relative paths.
 * @param {boolean} [strict] Promote WSL-path warnings to problems.
 * @returns {{ id: string, ok: boolean, detail: string, problems: string[], warnings: string[] }} Check result.
 */
export function checkPrivatePaths(root, packedPaths, strict = false) {
  const problems = []
  const warnings = []
  for (const file of packedPaths) {
    if (!TEXT_FILE_PATTERN.test(file)) continue
    const text = safeRead(join(root, file))
    if (text === null) continue
    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const location = file + ':' + (index + 1)
      let matched = false
      for (const { id, pattern } of PRIVATE_PATH_PATTERNS) {
        if (pattern.test(line)) {
          problems.push(location + ': ' + id)
          matched = true
          break
        }
      }
      if (matched) continue
      if (WSL_PATH_PATTERN.test(line)) {
        const entry = location + ': wsl-private-path'
        if (strict) problems.push(entry)
        else warnings.push(entry)
      }
    }
  }
  const cap = 50
  const cappedProblems = problems.slice(0, cap)
  if (problems.length > cap) cappedProblems.push('... ' + (problems.length - cap) + ' more private-path problem(s)')
  const cappedWarnings = warnings.slice(0, cap)
  if (warnings.length > cap) cappedWarnings.push('... ' + (warnings.length - cap) + ' more private-path warning(s)')
  return {
    id: 'private-paths',
    ok: cappedProblems.length === 0,
    detail: strict ? 'packed text files carry no private absolute path/token' : 'packed text files carry no private absolute path/token (WSL /mnt paths are warnings)',
    problems: cappedProblems,
    warnings: cappedWarnings,
  }
}

/**
 * Run every prepublish invariant once (offline; no tree writes).
 * @param {{ root?: string, npm?: boolean, strictPrivatePaths?: boolean, packTimeoutMs?: number }} [options] Options.
 * @returns {object} Result payload ({ ok, checks, packing, warnings, problems, ... }).
 */
export function runPrePublishCheck(options = {}) {
  const root = resolve(options.root ?? PLUGIN_ROOT)
  const npmEnabled = options.npm !== false
  const strict = options.strictPrivatePaths === true
  const timeoutMs = options.packTimeoutMs ?? PACK_TIMEOUT_MS
  const startedAt = Date.now()
  const pkg = loadPackage(root)
  const expansion = expectedPacked(pkg, root)
  const packing = collectPackedFiles({ root, pkg, expansion, npm: npmEnabled, timeoutMs })
  const packedPaths = packing.files.map((file) => file.path)
  const checks = [
    checkInventory(expansion, packing),
    checkExportsTargets(pkg, packedPaths),
    checkRequiredPacked(packedPaths),
    checkForbiddenPacked(packedPaths),
    checkSizeBudget(packing),
    checkCordisPatch(root, pkg.name),
    checkClientModuleIds(root, pkg.name),
    checkVersionTruth(root, pkg),
    checkLocaleFiles(root, pkg),
    checkIcon(root, pkg),
    checkPrivatePaths(root, packedPaths, strict),
  ]
  const warnings = checks.flatMap((check) => check.warnings)
  if (packing.source !== 'npm') warnings.unshift('tarball NOT verified: ' + packing.reason + '; compared against the files allowlist expansion instead')
  const problems = checks.flatMap((check) => check.problems)
  const bytes = packing.files.reduce((sum, file) => sum + (Number.isFinite(file.bytes) ? file.bytes : 0), 0)
  return {
    tool: 'prepublish-check',
    schemaVersion: SCHEMA_VERSION,
    ok: checks.every((check) => check.ok),
    root,
    durationMs: Date.now() - startedAt,
    packing: {
      source: packing.source,
      tarballVerified: packing.source === 'npm',
      reason: packing.reason,
      fileCount: packing.files.length,
      packedBytes: bytes,
      tarballBytes: packing.tarballBytes,
      unpackedBytes: packing.unpackedBytes,
      entryCount: packing.entryCount,
      filename: packing.filename,
    },
    checks,
    warnings,
    problems,
  }
}

function printPacking(packing, stdout) {
  if (packing.source === 'npm') {
    stdout('[prepublish-check] packing: npm pack --dry-run --json --ignore-scripts (' + packing.fileCount + ' files, ' + formatBytes(packing.packedBytes) + ' packed, ' + formatBytes(packing.tarballBytes) + ' tarball)')
  } else {
    stdout('[prepublish-check] packing: ' + packing.fileCount + ' files from the files allowlist expansion, ' + formatBytes(packing.packedBytes) + ' packed (tarball NOT verified: ' + packing.reason + ')')
  }
}

/**
 * CLI entry point.
 * @param {string[]} argv Arguments after the script name.
 * @param {{ stdout?: (line: string) => void, stderr?: (line: string) => void }} [io] Output sinks.
 * @returns {number} 0 all checks pass / 1 a check failed / 2 usage error.
 */
export function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((line) => console.log(line))
  const stderr = io.stderr ?? ((line) => console.error(line))
  const options = { json: false, npm: true, strictPrivatePaths: false, root: PLUGIN_ROOT, packTimeoutMs: PACK_TIMEOUT_MS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      stdout('Usage: node scripts/prepublish-check.mjs [--json] [--no-npm] [--strict-private-paths] [--root DIR] [--pack-timeout-ms N]')
      stdout('  --json                  one machine-readable JSON object on stdout')
      stdout('  --no-npm                skip npm pack and use the files allowlist expansion (tarball NOT verified)')
      stdout('  --strict-private-paths  treat WSL /mnt paths in packed text files as failures')
      stdout("  --root DIR              package root to check (default: this script's package)")
      stdout('  --pack-timeout-ms N     npm pack timeout (default: 20000)')
      return 0
    } else if (arg === '--json') options.json = true
    else if (arg === '--no-npm') options.npm = false
    else if (arg === '--strict-private-paths') options.strictPrivatePaths = true
    else if (arg === '--root' || arg === '--pack-timeout-ms') {
      const value = argv[index + 1]
      index += 1
      if (value === undefined || value === '') { stderr('[prepublish-check] ' + arg + ' requires a value'); return 2 }
      if (arg === '--root') options.root = resolve(value)
      else {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed <= 0) { stderr('[prepublish-check] --pack-timeout-ms requires a positive number'); return 2 }
        options.packTimeoutMs = Math.round(parsed)
      }
    } else {
      stderr('[prepublish-check] unknown argument: ' + arg)
      return 2
    }
  }
  if (!existsSync(options.root)) {
    stderr('[prepublish-check] root does not exist: ' + options.root)
    return 2
  }
  let result
  try {
    result = runPrePublishCheck({
      root: options.root,
      npm: options.npm,
      strictPrivatePaths: options.strictPrivatePaths,
      packTimeoutMs: options.packTimeoutMs,
    })
  } catch (error) {
    stderr('[prepublish-check] error: ' + (error instanceof Error ? error.message : String(error)))
    return 2
  }
  if (options.json) {
    stdout(JSON.stringify(result))
    return result.ok ? 0 : 1
  }
  printPacking(result.packing, stdout)
  for (const check of result.checks) {
    if (check.ok) {
      stdout('[prepublish-check] PASS ' + check.id + ' - ' + check.detail)
    } else {
      stderr('[prepublish-check] FAIL ' + check.id + ' - ' + check.detail)
      for (const problem of check.problems) stderr('  - ' + problem)
    }
  }
  for (const warning of result.warnings) stdout('[prepublish-check] WARN ' + warning)
  if (result.ok) {
    stdout('[prepublish-check] OK (' + result.checks.length + ' checks, ' + result.durationMs + 'ms' + (result.packing.tarballVerified ? '' : '; tarball NOT verified') + ')')
    return 0
  }
  const failed = result.checks.filter((check) => !check.ok).length
  stderr('[prepublish-check] FAILED (' + failed + ' check(s), ' + result.problems.length + ' problem(s), ' + result.durationMs + 'ms)')
  return 1
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(runCli(process.argv.slice(2)))
