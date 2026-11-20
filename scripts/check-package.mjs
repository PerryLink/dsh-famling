/**
 * MB-094 residual: release hygiene for the published npm package.
 *
 * This plugin is distributed as a tarball, not from the working tree, so the
 * package metadata and the `files` allowlist ARE part of the product. Two gates
 * live here:
 *
 *   node scripts/check-package.mjs            # static: metadata + files + exports
 *   node scripts/check-package.mjs --prepack  # same, quiet stdout (npm lifecycle)
 *   node scripts/check-package.mjs --pack     # static + `npm pack --dry-run --json`
 *                                             # inventory equality check
 *
 * `--prepack` exists because npm writes lifecycle stdout straight into the
 * stdout of `npm pack --dry-run --json`; the prepack gate must not corrupt that
 * JSON, so it reports on stderr. `--pack` runs the real npm packer (dry run, no
 * tarball on disk) and verifies the packed file set equals the declared
 * allowlist expansion plus npm's always-included files.
 *
 * The gate is deliberately static/fast and network-free: it can run in prepack,
 * CI and any offline checkout. Public URL reachability is NOT verified here.
 *
 * MB-004 adds the reproducible-install LOCK: package-lock.json must exist, be a
 * lockfileVersion 3 tree that matches package.json (name/version/license, every
 * declared dependency present), and must never resolve through a private local
 * path (file:/link: into a sibling checkout). The plugin is currently
 * dependency-free, so the expected lock is a root-only tree; the check is
 * written generically so a future dev dependency still has to be locked.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Canonical values. Keep in sync with docs/RELEASE-HYGIENE.md. */
export const CANONICAL = Object.freeze({
  name: 'dsh-famling',
  license: 'PolyForm-Noncommercial-1.0.0',
  repository: 'git+https://github.com/PerryLink/dsh-famling.git',
  homepage: 'https://github.com/PerryLink/dsh-famling#readme',
  bugs: 'https://github.com/PerryLink/dsh-famling/issues',
})

/** Files npm always includes regardless of `files` (README/LICENSE are explicit here too). */
const ALWAYS_PACKED = ['package.json', 'README.md', 'LICENSE']

/** Runtime artifacts a consumer needs; exporting something that is not packed is a broken install. */
const REQUIRED_PACKED = Object.freeze([
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
const FORBIDDEN_PACKED = Object.freeze([
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

const FORBIDDEN_ENTRIES = Object.freeze(['test', 'scripts', '.github', 'package-lock.json', '.npmrc', '.gitignore', 'node_modules'])

function toPosix(file) { return file.split(sep).join('/') }

export function loadPackage(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

/** Lockfile name checked at the package root (npm lockfileVersion 3). */
export const LOCKFILE_NAME = 'package-lock.json'

/** Dependency sections that must be represented in the lock. */
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

/**
 * Read the committed package-lock.json, or null when absent.
 * @param {string} root Package root.
 * @returns {any|null} Parsed lockfile or null.
 */
export function loadLockfile(root) {
  const path = join(root, LOCKFILE_NAME)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Validate the committed package-lock.json: the clean-checkout LOCK (MB-004).
 *
 * The lock is what makes `npm ci` reproducible in a plugin-only checkout. It
 * must describe this exact package, carry every declared dependency, and never
 * point at a private local checkout. A missing or stale lock is a hard failure,
 * not a warning: without it a clean checkout either needs the private repo or
 * installs a different tree.
 * @param {string} root Package root.
 * @returns {string[]} Problems (empty when the lock is valid).
 */
export function lockProblems(root) {
  const problems = []
  const pkg = loadPackage(root)
  const lockPath = join(root, LOCKFILE_NAME)
  if (!existsSync(lockPath)) {
    return [LOCKFILE_NAME + ' is missing: a clean checkout must be reproducible (run `npm install --package-lock-only --ignore-scripts`)']
  }
  let lock
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch (error) {
    return [LOCKFILE_NAME + ' is not valid JSON: ' + error.message]
  }
  if (lock === null || typeof lock !== 'object' || Array.isArray(lock)) return [LOCKFILE_NAME + ' must be a JSON object']
  if (lock.lockfileVersion !== 3) problems.push('lockfileVersion is ' + JSON.stringify(lock.lockfileVersion) + ', expected 3 (npm >=7 lock)')
  if (lock.name !== pkg.name) problems.push('lock name is ' + JSON.stringify(lock.name) + ', expected ' + JSON.stringify(pkg.name))
  if (lock.version !== pkg.version) problems.push('lock version is ' + JSON.stringify(lock.version) + ', expected ' + JSON.stringify(pkg.version) + ' (run `npm install --package-lock-only`)')
  const packages = lock.packages
  if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
    problems.push('lock is missing the packages map')
    return problems
  }
  const rootEntry = packages['']
  if (rootEntry === null || typeof rootEntry !== 'object') {
    problems.push('lock is missing the "" root package entry')
  } else {
    if (rootEntry.name !== pkg.name) problems.push('lock root name is ' + JSON.stringify(rootEntry.name) + ', expected ' + JSON.stringify(pkg.name))
    if (rootEntry.version !== pkg.version) problems.push('lock root version is ' + JSON.stringify(rootEntry.version) + ', expected ' + JSON.stringify(pkg.version))
    if (rootEntry.license !== pkg.license) problems.push('lock root license is ' + JSON.stringify(rootEntry.license) + ', expected ' + JSON.stringify(pkg.license))
    for (const section of DEPENDENCY_SECTIONS) {
      const declared = Object.keys(pkg[section] ?? {}).sort()
      const locked = Object.keys(rootEntry[section] ?? {}).sort()
      if (declared.join(',') !== locked.join(',')) {
        problems.push('lock root ' + section + ' [' + locked.join(',') + '] != package.json [' + declared.join(',') + ']')
      }
    }
  }
  const packageKeys = Object.keys(packages).filter((key) => key !== '')
  const declaredNames = new Set()
  for (const section of DEPENDENCY_SECTIONS) for (const name of Object.keys(pkg[section] ?? {})) declaredNames.add(name)
  for (const key of packageKeys) {
    const name = key.startsWith('node_modules/') ? key.slice('node_modules/'.length).split('/node_modules/').pop() : key
    const entry = packages[key] ?? {}
    // A private/local resolution would make the clean checkout depend on a
    // sibling repository that the public checkout does not have.
    const resolved = typeof entry.resolved === 'string' ? entry.resolved : ''
    if (/^(file|link):/.test(resolved) || /^\.\.?\//.test(resolved) || /^[A-Za-z]:[\\/]/.test(resolved)) {
      problems.push('lock entry ' + JSON.stringify(key) + ' resolves through a private/local path: ' + resolved)
    }
    if (!name) problems.push('lock entry ' + JSON.stringify(key) + ' has no package name')
    else {
      const isDeclared = declaredNames.has(name)
      const isTransitive = packageKeys.some((candidate) => candidate !== key && Object.prototype.hasOwnProperty.call(packages[candidate]?.dependencies ?? {}, name))
      if (!isDeclared && !isTransitive) problems.push('lock pins ' + JSON.stringify(name) + ' but it is not a declared or transitive dependency')
    }
  }
  for (const name of declaredNames) {
    const matches = packageKeys.filter((key) => key === 'node_modules/' + name || key.endsWith('/node_modules/' + name))
    if (matches.length === 0) problems.push('declared dependency ' + JSON.stringify(name) + ' is not represented in ' + LOCKFILE_NAME)
  }
  return problems
}

function normalizeRepoUrl(url) {
  return String(url)
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
}

/** Pure metadata checks on a parsed package.json (no filesystem access). */
export function metadataProblems(pkg) {
  const problems = []
  if (pkg.name !== CANONICAL.name) problems.push(`name is ${JSON.stringify(pkg.name)}, expected ${JSON.stringify(CANONICAL.name)}`)
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) problems.push('version is not semver')
  if (pkg.private !== false) problems.push('private must be false: the plugin is published to npm')
  if (pkg.license !== CANONICAL.license) problems.push(`license is ${JSON.stringify(pkg.license)}, expected ${JSON.stringify(CANONICAL.license)}`)
  if (pkg.type !== 'module') problems.push('type must be "module"')

  const repository = pkg.repository
  if (repository === null || typeof repository !== 'object') {
    problems.push('repository is missing: add { type: "git", url: "git+https://github.com/PerryLink/dsh-famling.git" }')
  } else {
    if (repository.type !== 'git') problems.push('repository.type must be "git"')
    if (!String(repository.url ?? '').startsWith('git+https://')) problems.push('repository.url must use git+https:// (not ssh/git://)')
    if (normalizeRepoUrl(repository.url ?? '') !== normalizeRepoUrl(CANONICAL.repository)) {
      problems.push(`repository.url is ${JSON.stringify(repository.url)}, expected ${JSON.stringify(CANONICAL.repository)}`)
    }
  }
  if (pkg.homepage !== CANONICAL.homepage) problems.push(`homepage is ${JSON.stringify(pkg.homepage)}, expected ${JSON.stringify(CANONICAL.homepage)}`)
  if (pkg.bugs === null || typeof pkg.bugs !== 'object' || pkg.bugs.url !== CANONICAL.bugs) {
    problems.push(`bugs.url is ${JSON.stringify(pkg.bugs?.url)}, expected ${JSON.stringify(CANONICAL.bugs)}`)
  }

  // repository / homepage / bugs must describe the same project, even if one
  // constant is edited later; this is what keeps the trio from drifting apart.
  if (repository && typeof repository === 'object' && typeof repository.url === 'string') {
    const repo = normalizeRepoUrl(repository.url)
    if (typeof pkg.homepage === 'string' && pkg.homepage !== repo && !pkg.homepage.startsWith(repo + '#')) {
      problems.push('homepage does not point at repository (' + repo + ') or a fragment of it')
    }
    if (pkg.bugs && typeof pkg.bugs === 'object' && typeof pkg.bugs.url === 'string' && !pkg.bugs.url.startsWith(repo + '/')) {
      problems.push('bugs.url does not point into repository (' + repo + ')')
    }
  }

  const deps = pkg.dependencies ?? {}
  if (Object.keys(deps).length > 0) problems.push('runtime dependencies must stay empty: the plugin is self-contained (only node builtins + host services)')
  const scripts = pkg.scripts ?? {}
  if (typeof scripts.prepack !== 'string' || !scripts.prepack.includes('scripts/check-package.mjs')) {
    problems.push('prepack must run scripts/check-package.mjs (packaging metadata gate)')
  }
  if (typeof scripts['check:package'] !== 'string' || !scripts['check:package'].includes('scripts/check-package.mjs')) problems.push('check:package script is missing')
  if (typeof scripts['verify:package'] !== 'string' || !scripts['verify:package'].includes('scripts/check-package.mjs --pack')) problems.push('verify:package script is missing (--pack)')
  if (typeof scripts['release:check'] !== 'string') problems.push('release:check script is missing (full pre-publish gate)')

  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') problems.push('dsh.bundle.patch must point at ./cordis.patch.yml')
  if (pkg.dsh?.manifestVersion !== 1) problems.push('dsh.manifestVersion must stay 1')
  if (typeof pkg.engines?.dsh !== 'string' || pkg.engines.dsh.length === 0) problems.push('engines.dsh is missing')
  if (pkg.exports === undefined || typeof pkg.exports !== 'object') problems.push('exports is missing')
  return problems
}

function patternToRegExp(pattern) {
  let source = '^'
  for (const character of pattern) {
    if (character === '*') source += '[^/]*'
    else if (character === '?') source += '[^/]'
    else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(source + '$')
}

function listFiles(root, directory) {
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.DS_Store') continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) files.push(toPosix(absolute.slice(root.length + 1)))
    }
  }
  walk(directory)
  return files.sort()
}

/** Expand one `files` allowlist entry to concrete relative paths. */
export function expandFilesEntry(root, entry) {
  if (typeof entry !== 'string' || entry.length === 0) return { files: [], problems: ['files contains a non-string entry'] }
  const absolute = join(root, entry)
  if (!/[*?]/.test(entry)) {
    if (!existsSync(absolute)) return { files: [], problems: [`files entry ${JSON.stringify(entry)} does not exist`] }
    if (statSync(absolute).isDirectory()) return { files: listFiles(root, absolute), problems: [] }
    return { files: [toPosix(entry)], problems: [] }
  }
  const staticSegments = []
  for (const segment of entry.split('/').slice(0, -1)) {
    if (/[*?]/.test(segment)) break
    staticSegments.push(segment)
  }
  const base = join(root, ...staticSegments)
  if (!existsSync(base)) return { files: [], problems: [`files entry ${JSON.stringify(entry)} has no matching base directory`] }
  const pattern = patternToRegExp(entry)
  const files = listFiles(root, base).filter((file) => pattern.test(file))
  if (files.length === 0) return { files: [], problems: [`files entry ${JSON.stringify(entry)} matches no file`] }
  return { files, problems: [] }
}

/** Allowlist expansion: concrete files, plus duplicate/forbidden/nonexistent problems. */
export function allowlistReport(pkg, root) {
  const problems = []
  const entries = Array.isArray(pkg.files) ? pkg.files : []
  if (entries.length === 0) problems.push('files allowlist is missing or empty')
  const seen = new Set()
  for (const entry of entries) {
    if (typeof entry === 'string' && seen.has(entry)) problems.push(`files entry ${JSON.stringify(entry)} is duplicated`)
    if (typeof entry === 'string') seen.add(entry)
    if (FORBIDDEN_ENTRIES.includes(entry)) problems.push(`files must not publish ${JSON.stringify(entry)}`)
  }
  const files = []
  for (const entry of entries) {
    const expanded = expandFilesEntry(root, entry)
    problems.push(...expanded.problems)
    files.push(...expanded.files)
  }
  const unique = [...new Set(files)].sort()
  for (const file of unique) {
    if (FORBIDDEN_PACKED.some((pattern) => pattern.test(file))) problems.push(`allowlist expansion leaks ${JSON.stringify(file)}`)
  }
  return { entries, files: unique, problems }
}

/** Exact set of files the tarball must contain: allowlist expansion + npm always-included. */
export function expectedPacked(pkg, root) {
  const report = allowlistReport(pkg, root)
  const paths = [...new Set([...report.files, ...ALWAYS_PACKED])].sort()
  const problems = [...report.problems]
  for (const required of REQUIRED_PACKED) {
    if (!paths.includes(required)) problems.push(`required runtime file is not packed: ${required}`)
  }
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target !== 'string') { problems.push(`exports ${subpath} is not a plain path`); continue }
    if (target.includes('*')) {
      const pattern = patternToRegExp(target.replace(/^\.\//, ''))
      const matches = paths.filter((file) => pattern.test(file))
      if (matches.length === 0) problems.push(`exports ${subpath} pattern ${JSON.stringify(target)} is not packed`)
      continue
    }
    const file = target.replace(/^\.\//, '')
    if (!paths.includes(file)) problems.push(`exports ${subpath} target ${JSON.stringify(target)} is not packed`)
  }
  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch === 'string' && !paths.includes(patch.replace(/^\.\//, ''))) problems.push(`dsh.bundle.patch ${JSON.stringify(patch)} is not packed`)
  return { paths, problems }
}

/** Pure checks of a parsed `npm pack --dry-run --json` entry against the expected set. */
export function packEntryProblems(pkg, entry, expectedPaths) {
  const problems = []
  const expected = new Set(expectedPaths)
  if (entry.name !== pkg.name) problems.push(`pack name is ${JSON.stringify(entry.name)}, expected ${JSON.stringify(pkg.name)}`)
  if (entry.version !== pkg.version) problems.push(`pack version is ${JSON.stringify(entry.version)}, expected ${JSON.stringify(pkg.version)}`)
  const filename = `${pkg.name}-${pkg.version}.tgz`
  if (entry.filename !== filename) problems.push(`pack filename is ${JSON.stringify(entry.filename)}, expected ${JSON.stringify(filename)}`)
  const actual = (entry.files ?? []).map((file) => toPosix(file.path)).sort()
  if (actual.length === 0) problems.push('npm pack returned no files')
  if (typeof entry.entryCount === 'number' && entry.entryCount !== actual.length) problems.push(`entryCount ${entry.entryCount} != files.length ${actual.length}`)
  const actualSet = new Set(actual)
  for (const missing of expectedPaths.filter((file) => !actualSet.has(file))) problems.push(`tarball is missing ${JSON.stringify(missing)}`)
  for (const unexpected of actual.filter((file) => !expected.has(file))) problems.push(`tarball contains undeclared file ${JSON.stringify(unexpected)}`)
  if (!(typeof entry.size === 'number' && entry.size > 0)) problems.push('tarball size is not positive')
  if (!(typeof entry.unpackedSize === 'number' && entry.unpackedSize > 0)) problems.push('tarball unpackedSize is not positive')
  return problems
}

export function staticReport(root) {
  const pkg = loadPackage(root)
  const metadata = metadataProblems(pkg)
  const expected = expectedPacked(pkg, root)
  const lock = lockProblems(root)
  const lockfile = loadLockfile(root)
  return {
    pkg,
    problems: [...metadata, ...expected.problems, ...lock],
    info: {
      name: pkg.name,
      version: pkg.version,
      allowlistEntries: Array.isArray(pkg.files) ? pkg.files.length : 0,
      expectedFiles: expected.paths.length,
      exports: Object.keys(pkg.exports ?? {}).length,
      lockfileVersion: lockfile?.lockfileVersion ?? null,
      lockedPackages: lockfile?.packages ? Object.keys(lockfile.packages).length : 0,
    },
    expectedPaths: expected.paths,
  }
}

/** Run `npm pack --dry-run --json` and validate the result. Needs the npm CLI on PATH. */
export function packReport(root) {
  const staticPart = staticReport(root)
  if (staticPart.problems.length > 0) return { ...staticPart, pack: null }
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, npm_config_loglevel: 'warn' },
  })
  if (packed.error) return { ...staticPart, problems: [`could not run npm pack: ${packed.error.message}`], pack: null }
  if (packed.status !== 0) {
    const stderr = String(packed.stderr ?? '').trim().split('\n').slice(-12).join('\n')
    return { ...staticPart, problems: [`npm pack --dry-run failed (exit ${packed.status})${stderr ? ':\n' + stderr : ''}`], pack: null }
  }
  let parsed
  try { parsed = parsePackJson(packed.stdout) } catch (error) {
    return { ...staticPart, problems: [`could not parse npm pack --dry-run --json output: ${error.message}`], pack: null }
  }
  const entry = Array.isArray(parsed) ? parsed[0] : undefined
  if (entry === undefined) return { ...staticPart, problems: ['npm pack --dry-run --json returned an empty array'], pack: null }
  return { ...staticPart, problems: packEntryProblems(staticPart.pkg, entry, staticPart.expectedPaths), pack: entry }
}

function parsePackJson(stdout) {
  const text = String(stdout ?? '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('no JSON array in npm pack output')
  return JSON.parse(text.slice(start, end + 1))
}

function printProblems(problems, stream) {
  stream(`check-package: FAILED (${problems.length} problem(s))`)
  for (const problem of problems) stream(`  - ${problem}`)
}

export function runCli(argv, { stdout = console.log, stderr = console.error } = {}) {
  const root = resolve(fileURLToPath(import.meta.url), '..', '..')
  const prepack = argv.includes('--prepack')
  const pack = argv.includes('--pack')
  const report = pack ? packReport(root) : staticReport(root)
  if (report.problems.length > 0) {
    printProblems(report.problems, stderr)
    return 1
  }
  const { info } = report
  const summary = `metadata ok, ${info.allowlistEntries} allowlist entries -> ${info.expectedFiles} packed files, ${info.exports} exports covered, lockfileVersion ${info.lockfileVersion} (${info.lockedPackages} locked package(s))`
  if (pack && report.pack) {
    const kib = (bytes) => (bytes / 1024).toFixed(1) + ' KiB'
    stdout(`check-package: pack ok (${report.pack.entryCount} files, tarball ${kib(report.pack.size)}, unpacked ${kib(report.pack.unpackedSize)})`)
    stdout(`check-package: ${summary}`)
    return 0
  }
  const message = `check-package: ${prepack ? 'prepack ' : ''}ok (${summary})`
  if (prepack) stderr(message)
  else stdout(message)
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(runCli(process.argv.slice(2)))
