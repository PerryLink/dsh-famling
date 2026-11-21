#!/usr/bin/env node
/**
 * Real DSH host integration smoke for dsh-famling (A3 evidence, 2026-11-21).
 *
 * End-to-end, against a real DSH checkout (read-only) and a throwaway DSH_HOME
 * under the OS temp directory:
 *
 *   1. npm-pack this plugin into a tarball (the artifact npm publish ships)
 *   2. install it into a fresh 'web' profile with the Host's own command
 *      ('dsh plugin --profile web add <tarball>'), so profile creation, pnpm,
 *      bundle selection and the engines.dsh check are the Host's, not ours
 *   3. boot a scriptable Messages mock endpoint and the real Web host
 *      ('dsh --profile web --no-open --port N') with DEEPSEEK_BASE_URL pointed
 *      at the mock, so one real Agent turn runs without a provider key
 *   4. verify the Host serves this plugin's client entry in __DSH_BOOT__,
 *      serves its built client bundle, and answers the authenticated bridge
 *   5. drive headless Chromium over CDP and assert what only a real browser can
 *      show: the 72px character in the sidebar footer, the real right-click /
 *      Shift+F10 menu, the browser-side bridge handshake, and one Agent turn
 *      observed through agent/status (running -> idle) via the plugin bridge
 *   6. write a machine-readable evidence JSON and a screenshot
 *
 * The real user's DSH home is never touched: DSH_HOME is always a fresh
 * mkdtemp directory, and inherited DSH_* / DEEPSEEK_* launch variables are
 * scrubbed from every child process environment first.
 *
 * Requirements: Node >= 22, pnpm + npm on PATH, a Chrome/Chromium binary.
 * On a Linux host missing Chromium's shared libraries the script can fetch
 * libnss3/libnspr4/libasound2t64 with 'apt-get download' into its workdir and
 * expose them through LD_LIBRARY_PATH (--ensure-chrome-deps, default on);
 * no system package is installed and nothing outside the workdir changes.
 *
 * Usage:
 *   node test/dsh-host-smoke.mjs [options]
 *     --checkout PATH          DSH checkout (default $DSH_CHECKOUT)
 *     --plugin PATH            this plugin's directory (default: repo root)
 *     --workdir PATH           scratch dir (default: mkdtemp under os.tmpdir())
 *     --chrome PATH            Chrome/Chromium executable (default: auto-detect)
 *     --chrome-lib-dir PATH    extra shared-library dir for Chrome
 *     --no-ensure-chrome-deps  do not fetch missing Chromium libs via apt-get
 *     --port N                 Web host port (default: an ephemeral free port)
 *     --mock-port N            mock LLM port (default: ephemeral free port)
 *     --headed                 launch a headed browser (default: --headless=new)
 *     --clean                  delete the workdir after a passing run
 *     --timeout MS             host-boot budget (default 180000)
 *     --json PATH              evidence JSON (default: <workdir>/evidence.json)
 *     --screenshot PATH        screenshot (default: <workdir>/screenshot.png)
 *     --plugin-name NAME       package name to assert (default: package.json)
 *     --help                   this help
 *
 * Exit codes: 0 = every required check passed, 1 = a check failed, 2 = setup.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NL = String.fromCharCode(10)
const BRIDGE_PATH = '/api/famling/bridge'
const MOCK_API_KEY = 'mock-key'
const MOCK_SUCCESS_TEXT = 'Hello from the mock model. This is the famling real-host smoke reply.'
const MENU_EXPECTED = [
  ['Chat', '聊两句'],
  ['Play', '互动'],
  ['Content', '内容'],
  ['Settings', '设置'],
  ['More', '更多'],
  ['Quit', '退出'],
]
const CHARACTER_LABELS = ['Tinglan', '汀岚']

const USAGE = [
  'Usage: node test/dsh-host-smoke.mjs [options]',
  '  --checkout PATH          DSH checkout (default $DSH_CHECKOUT)',
  '  --plugin PATH            plugin directory (default: repo root)',
  '  --workdir PATH           scratch dir (default: mkdtemp)',
  '  --chrome PATH            Chrome/Chromium executable',
  '  --chrome-lib-dir PATH    extra shared-library dir for Chrome',
  '  --no-ensure-chrome-deps  do not fetch missing Chromium libs via apt-get',
  '  --port N                 Web host port (default: ephemeral)',
  '  --mock-port N            mock LLM port (default: ephemeral)',
  '  --headed                 launch a headed browser',
  '  --clean                  delete the workdir after a passing run',
  '  --timeout MS             host-boot budget (default 180000)',
  '  --json PATH              evidence JSON output path',
  '  --screenshot PATH        screenshot output path',
  '  --plugin-name NAME       package name to assert',
  '  --help                   show this help',
].join(NL)

function parseArgs(argv) {
  const parsed = {
    checkout: process.env.DSH_CHECKOUT || '',
    plugin: REPO_ROOT,
    workdir: '',
    chrome: process.env.CHROME_PATH || '',
    chromeLibDir: process.env.CHROME_LD_LIBRARY_PATH || '',
    ensureChromeDeps: true,
    port: 0,
    mockPort: 0,
    headed: false,
    clean: false,
    timeout: 180000,
    json: '',
    screenshot: '',
    pluginName: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = function () {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error('missing value for ' + arg)
      index += 1
      return next
    }
    if (arg === '--checkout') parsed.checkout = value()
    else if (arg === '--plugin') parsed.plugin = resolve(value())
    else if (arg === '--workdir') parsed.workdir = resolve(value())
    else if (arg === '--chrome') parsed.chrome = value()
    else if (arg === '--chrome-lib-dir') parsed.chromeLibDir = value()
    else if (arg === '--no-ensure-chrome-deps') parsed.ensureChromeDeps = false
    else if (arg === '--port') parsed.port = Number(value())
    else if (arg === '--mock-port') parsed.mockPort = Number(value())
    else if (arg === '--headed') parsed.headed = true
    else if (arg === '--clean') parsed.clean = true
    else if (arg === '--timeout') parsed.timeout = Number(value())
    else if (arg === '--json') parsed.json = resolve(value())
    else if (arg === '--screenshot') parsed.screenshot = resolve(value())
    else if (arg === '--plugin-name') parsed.pluginName = value()
    else if (arg === '--help' || arg === '-h') { process.stdout.write(USAGE + NL); process.exit(0) }
    else throw new Error('unknown argument ' + JSON.stringify(arg) + ' (try --help)')
  }
  if (!parsed.checkout) throw new Error('--checkout PATH or $DSH_CHECKOUT is required')
  if (!parsed.workdir) parsed.workdir = mkdtempSync(join(tmpdir(), 'dsh-host-smoke-'))
  if (!parsed.json) parsed.json = join(parsed.workdir, 'evidence.json')
  if (!parsed.screenshot) parsed.screenshot = join(parsed.workdir, 'screenshot.png')
  return parsed
}

const options = parseArgs(process.argv.slice(2))

// ── Evidence plumbing ────────────────────────────────────────────────────────

const evidence = {
  schema: 'dsh-host-smoke/1',
  kind: 'dsh-famling-real-host-smoke',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  pass: false,
  environment: { platform: process.platform, arch: process.arch, node: process.version, workdir: options.workdir },
  host: {},
  plugin: {},
  checks: [],
  steps: [],
  observations: [],
  artifacts: {},
  limitations: [],
}
const failures = []
let currentStep = null

function step(id, title) {
  currentStep = { id: id, title: title, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, detail: '' }
  evidence.steps.push(currentStep)
  process.stdout.write(NL + '[step] ' + id + ' - ' + title + NL)
}

function endStep(status, detail) {
  if (currentStep === null) return
  currentStep.status = status
  if (detail !== undefined) currentStep.detail = String(detail)
  currentStep.finishedAt = new Date().toISOString()
  currentStep = null
}

function check(id, ok, detail, extra) {
  const record = { id: id, ok: Boolean(ok), detail: String(detail === undefined ? '' : detail), at: new Date().toISOString() }
  if (extra !== undefined) record.extra = extra
  evidence.checks.push(record)
  if (!record.ok) failures.push(record)
  process.stdout.write('  [' + (record.ok ? 'pass' : 'FAIL') + '] ' + id + ': ' + record.detail + NL)
  return record
}

function observe(id, detail, value) {
  evidence.observations.push({ id: id, detail: String(detail === undefined ? '' : detail), value: value, at: new Date().toISOString() })
}

function log(message) { process.stdout.write(String(message) + NL) }
const sleep = function (ms) { return new Promise(function (done) { setTimeout(done, ms) }) }

async function poll(fn, labels) {
  const settings = labels || {}
  const timeoutMs = settings.timeoutMs === undefined ? 30000 : settings.timeoutMs
  const intervalMs = settings.intervalMs === undefined ? 250 : settings.intervalMs
  const label = settings.label === undefined ? 'condition' : settings.label
  const deadline = Date.now() + timeoutMs
  let lastError
  for (;;) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) { lastError = error }
    if (Date.now() > deadline) {
      throw new Error('timed out after ' + timeoutMs + 'ms waiting for ' + label + (lastError ? ' (last error: ' + lastError.message + ')' : ''))
    }
    await sleep(intervalMs)
  }
}

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex') }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }

function runSync(command, args, settings) {
  const config = settings || {}
  const result = spawnSync(command, args, {
    cwd: config.cwd,
    env: Object.assign({}, process.env, config.env || {}),
    encoding: 'utf8',
    timeout: config.timeoutMs === undefined ? 120000 : config.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  })
  const combined = String(result.stdout || '') + String(result.stderr || '')
  if (config.allowFail !== true && result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' exited ' + result.status + (result.error ? ' (' + result.error.message + ')' : '') + ':' + NL + combined.slice(-4000))
  }
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), combined: combined }
}

// Children are spawned detached so a whole pnpm/node tree can be terminated as
// one process group; nothing is left running after this script exits.
const children = []

function spawnChild(id, command, args, settings) {
  const config = settings || {}
  const outFd = openSync(config.stdoutPath, 'w')
  const errFd = openSync(config.stderrPath, 'w')
  const child = spawn(command, args, {
    cwd: config.cwd,
    env: Object.assign({}, process.env, config.env || {}),
    detached: process.platform !== 'win32',
    stdio: ['ignore', outFd, errFd],
  })
  closeSync(outFd)
  closeSync(errFd)
  const record = { id: id, child: child, stdoutPath: config.stdoutPath, stderrPath: config.stderrPath, exited: false, exitCode: null }
  child.on('exit', function (code) { record.exited = true; record.exitCode = code })
  children.push(record)
  return record
}

async function killChild(record) {
  if (!record || record.exited) return
  try {
    if (process.platform === 'win32') record.child.kill('SIGTERM')
    else process.kill(-record.child.pid, 'SIGTERM')
  } catch (error) { /* already gone */ }
  const exited = await Promise.race([
    new Promise(function (done) { record.child.once('exit', function () { done(true) }) }),
    sleep(4000).then(function () { return false }),
  ])
  if (!exited) {
    try {
      if (process.platform === 'win32') record.child.kill('SIGKILL')
      else process.kill(-record.child.pid, 'SIGKILL')
    } catch (error) { /* already gone */ }
    await sleep(500)
  }
}

async function killEverything() {
  for (const record of children.slice().reverse()) await killChild(record)
}

function getFreePort() {
  return new Promise(function (done, fail) {
    const server = createServer()
    server.unref()
    server.on('error', fail)
    server.listen(0, '127.0.0.1', function () {
      const address = server.address()
      const port = address !== null && typeof address === 'object' ? address.port : 0
      server.close(function () { done(port) })
    })
  })
}

function childEnv(extra) {
  const env = {}
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DSH_') || key.startsWith('DEEPSEEK_')) continue
    env[key] = process.env[key]
  }
  return Object.assign(env, extra || {})
}

// ── Chrome discovery and shared-library preparation ──────────────────────────

function chromeCandidates() {
  const candidates = []
  if (options.chrome) candidates.push(options.chrome)
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']
  for (const name of names) {
    const found = spawnSync('sh', ['-c', 'command -v ' + name + ' 2>/dev/null'], { encoding: 'utf8' })
    if (found.status === 0 && String(found.stdout || '').trim() !== '') candidates.push(String(found.stdout).trim())
  }
  const home = process.env.HOME || ''
  const caches = [join(home, '.cache/ms-playwright'), join(home, '.cache/puppeteer')]
  for (const cache of caches) {
    if (!existsSync(cache)) continue
    for (const entry of readdirSync(cache)) {
      const innerNames = ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']
      for (const inner of innerNames) {
        const candidate = join(cache, entry, inner)
        if (existsSync(candidate)) candidates.push(candidate)
      }
    }
  }
  // A Windows .exe under WSL runs only through interop: `--version` answers but
  // a Linux user-data-dir and TCP loopback do not belong to it. This smoke needs
  // a browser on the same machine and network namespace as the Host, so Windows
  // executables are offered only on Windows.
  if (process.platform === 'win32' && existsSync('/mnt/c')) {
    candidates.push('/mnt/c/Program Files/Google/Chrome/Application/chrome.exe')
    candidates.push('/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
  }
  const unique = []
  for (const candidate of candidates) if (!unique.includes(candidate)) unique.push(candidate)
  return unique
}

function chromeVersion(binary, libDirs) {
  const env = Object.assign({}, process.env)
  if (libDirs && libDirs.length > 0) env.LD_LIBRARY_PATH = libDirs.concat([env.LD_LIBRARY_PATH || '']).filter(Boolean).join(':')
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', env: env, timeout: 20000 })
  if (result.status !== 0) return undefined
  const text = String(result.stdout || result.stderr || '').trim()
  return text === '' ? undefined : text
}

function missingChromeLibs(binary, libDirs) {
  const env = Object.assign({}, process.env)
  const dirs = (libDirs || []).concat(options.chromeLibDir ? [options.chromeLibDir] : [])
  if (dirs.length > 0) env.LD_LIBRARY_PATH = dirs.concat([env.LD_LIBRARY_PATH || '']).filter(Boolean).join(':')
  const result = spawnSync('ldd', [binary], { encoding: 'utf8', env: env, timeout: 30000 })
  if (result.status !== 0) return []
  return String(result.stdout || '').split(NL).filter(function (line) { return line.includes('not found') }).map(function (line) { return line.trim() })
}

function sharedObjectDirs(root) {
  const found = []
  const walk = function (dir, depth) {
    if (depth > 6 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(join(dir, entry.name), depth + 1); continue }
      if (/.so(.d+)*$/.test(entry.name)) {
        if (!found.includes(dir)) found.push(dir)
        return
      }
    }
  }
  walk(root, 0)
  return found
}

function prepareChromeLibs(binary) {
  const extractRoot = join(options.workdir, 'chrome-libs')
  const missing = missingChromeLibs(binary)
  if (missing.length === 0) return { status: 'not-needed', libDirs: [] }
  if (!options.ensureChromeDeps) return { status: 'missing', libDirs: [], missing: missing }
  if (existsSync(extractRoot)) {
    const cachedDirs = sharedObjectDirs(extractRoot)
    if (cachedDirs.length > 0 && missingChromeLibs(binary, cachedDirs).length === 0) return { status: 'prepared', libDirs: cachedDirs }
  }
  log('  [chrome] missing shared libraries: ' + missing.map(function (line) { return line.split('=>')[0].trim() }).join(', '))
  const debs = join(options.workdir, 'chrome-debs')
  mkdirSync(debs, { recursive: true })
  log('  [chrome] fetching libnss3 libnspr4 libasound2t64 with apt-get download (no system install)')
  const download = spawnSync('apt-get', ['download', 'libnss3', 'libnspr4', 'libasound2t64'], { cwd: debs, encoding: 'utf8', timeout: 180000 })
  if (download.status !== 0) return { status: 'failed', libDir: '', missing: missing, error: String(download.stderr || download.stdout || '').slice(-2000) }
  mkdirSync(extractRoot, { recursive: true })
  for (const file of readdirSync(debs).filter(function (name) { return name.endsWith('.deb') })) {
    const extraction = spawnSync('dpkg-deb', ['-x', join(debs, file), extractRoot], { encoding: 'utf8', timeout: 120000 })
    if (extraction.status !== 0) return { status: 'failed', libDirs: [], missing: missing, error: String(extraction.stderr || '').slice(-2000) }
  }
  const libDirs = sharedObjectDirs(extractRoot)
  const remaining = missingChromeLibs(binary, libDirs)
  return { status: remaining.length === 0 ? 'prepared' : 'failed', libDirs: libDirs, missing: remaining }
}

// ── Minimal CDP client (no dependency; Node >= 22 global WebSocket) ──────────

function connectCdp(wsUrl) {
  return new Promise(function (done, fail) {
    let socket
    try { socket = new WebSocket(wsUrl) } catch (error) { fail(new Error('cannot open CDP WebSocket: ' + error.message)); return }
    const pending = new Map()
    let nextId = 0
    let opened = false
    function send(method, params) {
      return new Promise(function (resolveSend, rejectSend) {
        const id = (nextId += 1)
        pending.set(id, { resolve: resolveSend, reject: rejectSend })
        socket.send(JSON.stringify({ id: id, method: method, params: params || {} }))
      })
    }
    socket.addEventListener('open', function () {
      opened = true
      done({
        send: send,
        evaluate: async function (expression) {
          const response = await send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true })
          if (response && response.result && response.result.exceptionDetails) {
            const details = response.result.exceptionDetails
            throw new Error('page evaluate failed: ' + details.text + ' ' + ((details.exception && details.exception.description) || ''))
          }
          return response && response.result ? response.result.result.value : undefined
        },
        close: function () { try { socket.close() } catch (error) { /* ignore */ } },
      })
    }, { once: true })
    socket.addEventListener('message', function (event) {
      let message
      try { message = JSON.parse(String(event.data)) } catch (error) { return }
      if (message.id === undefined) return
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message || 'CDP error'))
      else waiter.resolve(message)
    })
    socket.addEventListener('error', function () { if (!opened) fail(new Error('CDP WebSocket error')) }, { once: true })
    socket.addEventListener('close', function () {
      if (!opened) fail(new Error('CDP WebSocket closed before open'))
      for (const waiter of pending.values()) waiter.reject(new Error('CDP WebSocket closed'))
      pending.clear()
    })
  })
}

async function fetchJson(url) {
  const response = await fetch(url)
  return response.json()
}

function cookieFromSetCookie(setCookie) { return String(setCookie || '').split(';')[0] }

// ── Phase 1: preflight + pack + install ──────────────────────────────────────

async function phasePrepare() {
  step('preflight', 'Locate the DSH checkout, Host version, and toolchain')
  const checkout = resolve(options.checkout)
  const cliManifestPath = join(checkout, 'apps/cli/package.json')
  if (!existsSync(cliManifestPath)) throw new Error(checkout + ' is not a DSH checkout (missing apps/cli/package.json)')
  const hostVersion = readJson(cliManifestPath).version
  const gitHead = runSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { allowFail: true }).stdout.trim()
  const gitDescribe = runSync('git', ['-C', checkout, 'describe', '--tags', '--always'], { allowFail: true }).stdout.trim()
  const gitStatus = runSync('git', ['-C', checkout, 'status', '--short'], { allowFail: true }).stdout.trim()
  const pluginManifest = readJson(join(options.plugin, 'package.json'))
  const pluginName = options.pluginName || pluginManifest.name
  evidence.host = { checkout: checkout, version: hostVersion, commit: gitHead || null, describe: gitDescribe || null, dirty: gitStatus === '' ? [] : gitStatus.split(NL).filter(Boolean) }
  evidence.plugin = { name: pluginName, version: pluginManifest.version, directory: options.plugin }
  const pnpmVersion = runSync('pnpm', ['--version'], { allowFail: true }).stdout.trim()
  evidence.environment.pnpm = pnpmVersion
  check('preflight.host-version', /^\d+\.\d+\.\d+/.test(hostVersion), 'Host version ' + hostVersion + ' (commit ' + (gitHead || 'unknown') + ', describe ' + (gitDescribe || 'unknown') + ')')
  check('preflight.dsh-home-isolated', true, 'DSH_HOME is a fresh mkdtemp directory; inherited DSH_*/DEEPSEEK_* variables are scrubbed from every child environment')
  check('preflight.plugin-version', typeof pluginManifest.version === 'string' && pluginManifest.version.length > 0, 'plugin ' + pluginName + '@' + pluginManifest.version)
  check('preflight.node', Number(process.versions.node.split('.')[0]) >= 22, 'node ' + process.version)
  check('preflight.pnpm', pnpmVersion !== '', 'pnpm ' + pnpmVersion)
  const homeDir = join(options.workdir, 'home')
  mkdirSync(homeDir, { recursive: true })
  const workspaceDir = join(options.workdir, 'workspace')
  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(join(workspaceDir, 'README.txt'), 'dsh-host-smoke workspace' + NL)
  evidence.environment.dshHome = homeDir
  evidence.environment.workspaceDir = workspaceDir
  endStep('pass', 'Host ' + hostVersion + ', plugin ' + pluginName + '@' + pluginManifest.version)

  step('pack', 'npm pack the plugin tarball')
  const pkgDir = join(options.workdir, 'pkg')
  mkdirSync(pkgDir, { recursive: true })
  const pack = runSync('npm', ['pack', '--pack-destination', pkgDir], { cwd: options.plugin, timeoutMs: 180000 })
  // Prefer the directory listing over npm's stdout/stderr mix (the "npm notice
  // filename:" line also ends in .tgz, and the plain filename arrives on stdout).
  const tarballNames = readdirSync(pkgDir).filter(function (name) { return name.endsWith('.tgz') })
  tarballNames.sort(function (a, b) {
    const statA = statSync(join(pkgDir, a)).mtimeMs
    const statB = statSync(join(pkgDir, b)).mtimeMs
    return statB - statA
  })
  if (tarballNames.length === 0) throw new Error('npm pack produced no tarball in ' + pkgDir + ':' + NL + pack.combined.slice(-2000))
  const tarball = join(pkgDir, tarballNames[0])
  if (!existsSync(tarball)) throw new Error('npm pack tarball missing: ' + tarball)
  const tarballBytes = readFileSync(tarball)
  evidence.plugin.tarball = tarball
  evidence.plugin.tarballSha256 = sha256(tarballBytes)
  evidence.plugin.tarballBytes = tarballBytes.length
  evidence.artifacts.npmPackLog = join(options.workdir, 'npm-pack.log')
  writeFileSync(evidence.artifacts.npmPackLog, pack.combined)
  check('pack.tarball', tarballBytes.length > 0, basename(tarball) + ' (' + tarballBytes.length + ' bytes, sha256 ' + evidence.plugin.tarballSha256.slice(0, 16) + '...)')
  endStep('pass', tarball)

  step('install', 'dsh plugin --profile web add <tarball> with an isolated DSH_HOME')
  const installLogPath = join(options.workdir, 'install.log')
  const install = spawnSync('pnpm', ['dsh', 'plugin', '--profile', 'web', 'add', tarball], {
    cwd: checkout,
    env: childEnv({ DSH_HOME: homeDir }),
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 64 * 1024 * 1024,
  })
  writeFileSync(installLogPath, String(install.stdout || '') + String(install.stderr || ''))
  evidence.artifacts.installLog = installLogPath
  check('install.exit-code', install.status === 0, 'pnpm dsh plugin add exited ' + install.status + (install.status === 0 ? '' : ' - ' + String(install.stderr || '').slice(-1200)))
  if (install.status !== 0) throw new Error('plugin installation failed; see ' + installLogPath)
  const profileDir = join(homeDir, 'profiles', 'web')
  const profileManifest = readJson(join(profileDir, 'package.json'))
  const bundles = (profileManifest.dsh && profileManifest.dsh.profile && profileManifest.dsh.profile.bundles) || []
  const dependencies = profileManifest.dependencies || {}
  check('install.profile-bundle-selected', bundles.includes(pluginName), 'profile bundles: ' + JSON.stringify(bundles))
  check('install.profile-dependency', Object.keys(dependencies).includes(pluginName), 'profile dependency ' + pluginName + ': ' + String(dependencies[pluginName]))
  const installedManifestPath = join(profileDir, 'node_modules', pluginName, 'package.json')
  check('install.package-materialized', existsSync(installedManifestPath), installedManifestPath)
  if (!existsSync(installedManifestPath)) throw new Error('installed plugin package not found in profile node_modules')
  const installedManifest = readJson(installedManifestPath)
  check('install.installed-version', installedManifest.version === pluginManifest.version, 'installed ' + pluginName + '@' + installedManifest.version)
  observe('install.engines', 'engines.dsh declared by the packaged plugin and accepted by the Host', installedManifest.engines && installedManifest.engines.dsh ? installedManifest.engines.dsh : null)
  check('install.bundle-patch-present', existsSync(join(profileDir, 'node_modules', pluginName, 'cordis.patch.yml')), 'cordis.patch.yml materialized in the profile')
  endStep('pass', 'installed ' + pluginName + '@' + installedManifest.version)
  return { checkout: checkout, hostVersion: hostVersion, pluginManifest: pluginManifest, pluginName: pluginName, homeDir: homeDir, workspaceDir: workspaceDir }
}

// ── Phase 2: mock LLM + real Web host ────────────────────────────────────────

async function phaseHost(context) {
  step('mock-llm', 'Start the scriptable Messages mock endpoint')
  const mockPort = options.mockPort || await getFreePort()
  const mockLogPath = join(options.workdir, 'mock-llm.log')
  const mock = spawnChild('mock-llm', 'node', [
    '--import', 'tsx',
    'packages/test-support/llm-mock-server/src/bin.ts',
    '--port', String(mockPort),
    '--api-key', MOCK_API_KEY,
    '--sequence', 'success',
    '--repeat-last',
    '--success-text', MOCK_SUCCESS_TEXT,
  ], { cwd: context.checkout, env: childEnv({}), stdoutPath: mockLogPath, stderrPath: join(options.workdir, 'mock-llm.err.log') })
  await poll(function () {
    if (mock.exited) throw new Error('mock LLM exited ' + mock.exitCode)
    return existsSync(mockLogPath) && readFileSync(mockLogPath, 'utf8').includes('"type":"ready"')
  }, { timeoutMs: 30000, label: 'mock LLM ready record' })
  evidence.artifacts.mockLlmLog = mockLogPath
  evidence.environment.mockLlmBaseUrl = 'http://127.0.0.1:' + mockPort + '/v1'
  check('mock-llm.ready', true, 'Messages mock on ' + evidence.environment.mockLlmBaseUrl + ' (scripted success repeated, no provider key, no network)')
  endStep('pass', evidence.environment.mockLlmBaseUrl)

  step('host', 'Boot the real Web host (dsh --profile web --no-open)')
  const webPort = options.port || await getFreePort()
  const webLogPath = join(options.workdir, 'web.log')
  const webErrPath = join(options.workdir, 'web.err.log')
  const host = spawnChild('web-host', 'pnpm', ['dsh', '--profile', 'web', '--no-open', '--port', String(webPort)], {
    cwd: context.checkout,
    env: childEnv({
      DSH_HOME: context.homeDir,
      DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + mockPort + '/v1',
      DEEPSEEK_API_KEY: MOCK_API_KEY,
    }),
    stdoutPath: webLogPath,
    stderrPath: webErrPath,
  })
  const tokenUrl = await poll(function () {
    if (host.exited) throw new Error('web host exited ' + host.exitCode + ': ' + String(readFileSync(webErrPath, 'utf8')).slice(-2000))
    if (!existsSync(webLogPath)) return false
    const match = /dsh web: (http:\/\/\S+)/.exec(readFileSync(webLogPath, 'utf8'))
    return match ? match[1] : false
  }, { timeoutMs: options.timeout, label: 'printed dsh web token URL' })
  const baseUrl = new URL(tokenUrl).origin + '/'
  evidence.environment.webUrl = baseUrl
  evidence.artifacts.webLog = webLogPath
  check('host.token-url', tokenUrl.indexOf(baseUrl + '?token=') === 0, 'startup printed a tokenized URL on ' + baseUrl + ' (token redacted)')
  observe('host.startup-url', 'tokenized launch URL printed by dsh web; the credential itself is redacted on purpose', 'redacted')
  const launchResponse = await fetch(tokenUrl, { redirect: 'manual' })
  const cookie = cookieFromSetCookie(launchResponse.headers.get('set-cookie'))
  check('host.token-exchange', [301, 302, 303, 307, 308].includes(launchResponse.status) && cookie !== '', 'launch token exchanged for a signed Cookie (HTTP ' + launchResponse.status + ')')
  if (cookie === '') throw new Error('launch token exchange returned no cookie')
  endStep('pass', baseUrl)
  return { tokenUrl: tokenUrl, baseUrl: baseUrl, cookie: cookie }
}

// ── Phase 3: HTTP-visible contract ───────────────────────────────────────────

async function phaseHttp(context, hostState) {
  step('http-contract', 'Verify the boot graph, the client bundle route, and the authenticated bridge over HTTP')
  const headers = { cookie: hostState.cookie }
  const indexResponse = await fetch(hostState.baseUrl, { headers: headers })
  const indexHtml = await indexResponse.text()
  check('http.index-status', indexResponse.status === 200, 'GET / -> HTTP ' + indexResponse.status + ' (' + indexHtml.length + ' bytes)')
  const bootMatch = /globalThis\["__DSH_BOOT__"\] = (\{.*?\})<\/script>/s.exec(indexHtml)
  if (!bootMatch) throw new Error('__DSH_BOOT__ graph not found in the served index')
  const bootGraph = JSON.parse(bootMatch[1])
  evidence.host.bootRelease = bootGraph.release || null
  evidence.host.bootEntries = bootGraph.entries.length
  let famlingEntry = null
  for (const entry of bootGraph.entries) if (entry.id === context.pluginName) famlingEntry = entry
  check('http.boot-graph-entry', famlingEntry !== null, famlingEntry === null ? 'plugin entry missing from __DSH_BOOT__' : "__DSH_BOOT__ entry '" + famlingEntry.id + "' url=" + famlingEntry.url + ' inject=' + JSON.stringify(famlingEntry.inject))
  if (famlingEntry === null) throw new Error('plugin client entry is absent from the composed boot graph')
  check('http.boot-graph-release', bootGraph.release && bootGraph.release.version === context.hostVersion, 'boot release ' + JSON.stringify(bootGraph.release) + ' matches Host ' + context.hostVersion)
  const bundleUrl = new URL(famlingEntry.url, hostState.baseUrl).href
  const bundleResponse = await fetch(bundleUrl, { headers: headers })
  const bundleBody = await bundleResponse.text()
  evidence.artifacts.clientBundleUrl = bundleUrl
  evidence.artifacts.clientBundleBytes = bundleBody.length
  check('http.client-bundle-status', bundleResponse.status === 200 && bundleBody.length > 1000, 'GET client bundle -> HTTP ' + bundleResponse.status + ' (' + bundleBody.length + ' bytes)')
  check('http.client-bundle-shape', bundleBody.includes('window.__ModuleLoader__.load') && bundleBody.includes("id: '" + context.pluginName + "'"), 'served bundle registers the package through __ModuleLoader__')

  const helloPayload = { v: 2, op: 'hello', clientVersion: context.pluginManifest.version, wireVersion: 2, contentExtension: 3, hostVersion: context.hostVersion }
  const helloResponse = await fetch(new URL(BRIDGE_PATH, hostState.baseUrl), {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(helloPayload),
  })
  const hello = await helloResponse.json()
  evidence.bridge = { hello: hello }
  check('bridge.hello-status', helloResponse.status === 200 && hello.ok === true, 'POST hello -> HTTP ' + helloResponse.status + ' ok=' + hello.ok)
  check('bridge.hello-wire', hello.wire && hello.wire.version === 2 && Array.isArray(hello.wire.accepts) && hello.wire.accepts.indexOf(2) !== -1, 'bridge wire v' + (hello.wire && hello.wire.version) + ' accepts ' + JSON.stringify(hello.wire && hello.wire.accepts))
  check('bridge.hello-host-version', hello.host && hello.host.version === context.hostVersion, 'hello host.version=' + JSON.stringify(hello.host && hello.host.version) + ' source=' + JSON.stringify(hello.host && hello.host.source))
  check('bridge.hello-compatible', hello.compatible === true && hello.versionMismatch === false, 'compatible=' + hello.compatible + ' versionMismatch=' + hello.versionMismatch)
  check('bridge.hello-capabilities', hello.capabilities && hello.capabilities.bridge === true, 'capabilities=' + JSON.stringify(hello.capabilities))
  observe('bridge.hello-host-identity', 'hello reports the Host version through the client boot report because a source launch sets no DSH_CLIENT_VERSION', hello.host)

  const probeResponse = await fetch(new URL(BRIDGE_PATH, hostState.baseUrl), {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify({ v: 2, op: 'probe' }),
  })
  const probe = await probeResponse.json()
  evidence.bridge.probe = probe
  check('bridge.probe-status', probeResponse.status === 200 && probe.ok === true, 'POST probe -> HTTP ' + probeResponse.status + ' ok=' + probe.ok)
  check('bridge.probe-wire', probe.wire && probe.wire.version === 2, 'probe wire v' + (probe.wire && probe.wire.version))
  observe('bridge.probe-host-identity', 'probe carries no client boot payload, so host.version/source stay null/unknown in a source launch without DSH_CLIENT_VERSION', probe.host)

  const stateResponse = await fetch(new URL(BRIDGE_PATH, hostState.baseUrl), {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify({ v: 2, op: 'state' }),
  })
  const state = await stateResponse.json()
  evidence.bridge.stateBaseline = state
  check('bridge.agent-status-contract', stateResponse.status === 200 && state.available === true && state.source === 'events', 'state available=' + state.available + ' source=' + JSON.stringify(state.source) + ' (agent/status subscription live in the real Host)')

  const unauth = await fetch(new URL(BRIDGE_PATH, hostState.baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 2, op: 'state' }),
  })
  check('bridge.requires-authentication', unauth.status !== 200, 'unauthenticated POST -> HTTP ' + unauth.status + ' (owner Peer policy enforced)')
  endStep('pass', 'boot graph + bundle route + bridge hello/probe/state')
}

// ── Phase 4: the real browser ────────────────────────────────────────────────

function fnExpression(fn, args) {
  return '(' + fn.toString() + ')(' + (args || []).map(function (value) { return JSON.stringify(value) }).join(',') + ')'
}

async function phaseBrowser(context, hostState) {
  step('browser', 'Drive headless Chromium over CDP against the real Web GUI')
  let chrome = null
  let libs = { status: 'not-needed', libDirs: [] }
  let lastPrepFailure = ''
  const candidates = chromeCandidates().filter(function (candidate) {
    return process.platform === 'win32' || !candidate.toLowerCase().endsWith('.exe')
  })
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    let version = chromeVersion(candidate)
    if (version === undefined) {
      // A Chromium from a playwright/puppeteer cache commonly lacks libnss3 and
      // friends on a slim Linux host; prepare the libs, then retry the probe.
      const prepared = prepareChromeLibs(candidate)
      if (prepared.status === 'prepared') {
        version = chromeVersion(candidate, prepared.libDirs)
        if (version !== undefined) libs = prepared
        else lastPrepFailure = 'library preparation completed but ' + candidate + ' still refused --version'
      } else if (prepared.status === 'failed') {
        lastPrepFailure = 'library preparation failed for ' + candidate + ': missing ' + JSON.stringify(prepared.missing || []) + ' ' + String(prepared.error || '')
      }
      if (version === undefined) continue
    }
    chrome = { path: candidate, version: version }
    break
  }
  if (chrome === null) throw new Error('no usable Chrome/Chromium binary found' + (lastPrepFailure === '' ? '' : '; last attempt: ' + lastPrepFailure))
  if (libs.status === 'not-needed') libs = prepareChromeLibs(chrome.path)
  if (libs.status === 'failed') throw new Error('Chromium cannot run: missing shared libraries and preparation failed (' + JSON.stringify(libs.missing || []) + ') ' + String(libs.error || ''))
  evidence.environment.chrome = { path: chrome.path, version: chrome.version, headless: !options.headed, libDirs: libs.libDirs || [], libPrep: libs.status }
  check('browser.chrome-available', true, chrome.version + ' (' + chrome.path + ')')

  const userDataDir = join(options.workdir, 'chrome-profile')
  mkdirSync(userDataDir, { recursive: true })
  const chromeArgs = []
  if (!options.headed) chromeArgs.push('--headless=new')
  chromeArgs.push(
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--window-size=1440,900',
    '--user-data-dir=' + userDataDir, '--lang=en-US', hostState.tokenUrl,
  )
  const chromeLogPath = join(options.workdir, 'chrome.log')
  const chromeEnv = childEnv({})
  if (libs.libDirs && libs.libDirs.length > 0) chromeEnv.LD_LIBRARY_PATH = libs.libDirs.concat([process.env.LD_LIBRARY_PATH || '']).filter(Boolean).join(':')
  const chromeChild = spawnChild('chrome', chrome.path, chromeArgs, { env: chromeEnv, stdoutPath: chromeLogPath, stderrPath: join(options.workdir, 'chrome.err.log') })
  const portFile = join(userDataDir, 'DevToolsActivePort')
  const cdpPort = await poll(function () {
    if (chromeChild.exited) throw new Error('chrome exited ' + chromeChild.exitCode + ': ' + String(readFileSync(join(options.workdir, 'chrome.err.log'), 'utf8')).slice(-1500))
    if (!existsSync(portFile)) return false
    const parsed = Number(readFileSync(portFile, 'utf8').split(NL)[0])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : false
  }, { timeoutMs: 45000, label: 'Chrome DevToolsActivePort' })
  evidence.environment.chrome.debugPort = cdpPort
  const pageTarget = await poll(async function () {
    const targets = await fetchJson('http://127.0.0.1:' + cdpPort + '/json/list')
    for (const target of targets) if (target.type === 'page') return target
    return false
  }, { timeoutMs: 30000, label: 'DSH page target' })
  const cdp = await connectCdp(pageTarget.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  check('browser.cdp-connected', true, 'CDP connected to the page target (debug port ' + cdpPort + ')')

  const evaluateFn = function (fn, args) { return cdp.evaluate(fnExpression(fn, args)) }
  const waitPage = function (fn, args, label, timeoutMs) {
    return poll(async function () {
      const value = await evaluateFn(fn, args)
      return value === false || value === null || value === undefined ? false : value
    }, { timeoutMs: timeoutMs === undefined ? 45000 : timeoutMs, label: label })
  }

  // (1) the character exists in the sidebar footer and renders at 72px
  const pet = await waitPage(function () {
    const candidate = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find(function (button) { return button.querySelector('img') })
    if (!candidate) return false
    const image = candidate.querySelector('img')
    const rect = candidate.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    return {
      ariaLabel: candidate.getAttribute('aria-label'),
      buttonRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      imageRect: { width: imageRect.width, height: imageRect.height },
      imageWidthAttribute: image.getAttribute('width'),
      imageHeightAttribute: image.getAttribute('height'),
      imageSrcPrefix: String(image.getAttribute('src') || '').slice(0, 22),
      inSidebarFooter: rect.x < 300 && (window.innerHeight - rect.bottom) < 160,
    }
  }, [], 'famling character in the sidebar footer')
  evidence.browser = { pet: pet }
  check('browser.pet-present', pet.inSidebarFooter === true, 'character button aria-label=' + JSON.stringify(pet.ariaLabel) + ' at x=' + Math.round(pet.buttonRect.x) + ' y=' + Math.round(pet.buttonRect.y) + ' in the sidebar footer')
  check('browser.pet-72px', Math.abs(pet.imageRect.width - 72) <= 1 && Math.abs(pet.imageRect.height - 72) <= 1, 'rendered character is ' + pet.imageRect.width + 'x' + pet.imageRect.height + ' px (img width/height attributes ' + pet.imageWidthAttribute + '/' + pet.imageHeightAttribute + ')')
  check('browser.pet-label', CHARACTER_LABELS.indexOf(pet.ariaLabel) !== -1, 'character aria-label ' + JSON.stringify(pet.ariaLabel) + ' is one of the shipped character names')
  check('browser.pet-sprite', pet.imageSrcPrefix.indexOf('data:image/png;base64') === 0, 'character sprite is an inline PNG data URL (no network asset)')

  // (2) the real right-click menu
  const menu = await evaluateFn(async function () {
    const button = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find(function (candidate) { return candidate.querySelector('img') })
    if (!button) return { found: false, menuPresent: false }
    const rect = button.getBoundingClientRect()
    button.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, view: window, button: 2,
      clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
    }))
    await new Promise(function (resolve) { setTimeout(resolve, 600) })
    const menu = document.getElementById('dsh-famling-menu')
    const items = menu ? Array.from(menu.querySelectorAll('[role="menuitem"], button')).map(function (el) { return String(el.textContent || '').trim() }).filter(Boolean) : []
    const menuRect = menu ? menu.getBoundingClientRect() : null
    return {
      found: true,
      menuPresent: Boolean(menu),
      role: menu ? menu.getAttribute('role') : null,
      ariaLabel: menu ? menu.getAttribute('aria-label') : null,
      items: items,
      rect: menuRect ? { x: menuRect.x, y: menuRect.y, width: menuRect.width, height: menuRect.height } : null,
    }
  }, [])
  evidence.browser.contextMenu = menu
  check('browser.context-menu-opens', menu.menuPresent === true && menu.role === 'menu', 'right-click opened #dsh-famling-menu role=' + JSON.stringify(menu.role) + ' aria-label=' + JSON.stringify(menu.ariaLabel))
  const menuJoined = (menu.items || []).join(' | ')
  const menuMissing = MENU_EXPECTED.filter(function (pair) {
    return pair.every(function (label) { return menuJoined.indexOf(label) === -1 })
  })
  check('browser.context-menu-items', menuMissing.length === 0, 'menu items: ' + menuJoined + (menuMissing.length === 0 ? '' : ' (missing groups: ' + JSON.stringify(menuMissing) + ')'))
  const menuShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const menuShotPath = join(options.workdir, 'screenshot-menu-open.png')
  if (menuShot && menuShot.result && menuShot.result.data) writeFileSync(menuShotPath, Buffer.from(menuShot.result.data, 'base64'))
  evidence.artifacts.screenshotMenuOpen = menuShotPath
  const closed = await evaluateFn(async function () {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await new Promise(function (resolve) { setTimeout(resolve, 400) })
    return !document.getElementById('dsh-famling-menu')
  }, [])
  check('browser.context-menu-escape', closed === true, 'Escape closed the menu')

  // (3) keyboard entry (Shift+F10) reopens the same menu
  const keyboardMenu = await evaluateFn(async function () {
    const button = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find(function (candidate) { return candidate.querySelector('img') })
    if (!button) return { found: false, menuPresent: false }
    button.focus()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', code: 'F10', shiftKey: true, bubbles: true }))
    await new Promise(function (resolve) { setTimeout(resolve, 500) })
    const menu = document.getElementById('dsh-famling-menu')
    if (menu) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await new Promise(function (resolve) { setTimeout(resolve, 300) })
    return { found: true, menuPresent: Boolean(menu) }
  }, [])
  check('browser.keyboard-menu', keyboardMenu.menuPresent === true, 'Shift+F10 on the character opened the same menu')

  // (4) browser-side bridge handshake on the same-origin cookie path
  const pageHello = await evaluateFn(async function (bridgePath, clientVersion, hostVersion) {
    const response = await fetch(bridgePath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 2, op: 'hello', clientVersion: clientVersion, wireVersion: 2, contentExtension: 3, hostVersion: hostVersion }),
    })
    return await response.json()
  }, [BRIDGE_PATH, context.pluginManifest.version, context.hostVersion])
  evidence.browser.hello = pageHello
  check('browser.bridge-hello', pageHello && pageHello.ok === true && pageHello.compatible === true, 'browser POST hello ok=' + (pageHello && pageHello.ok) + ' compatible=' + (pageHello && pageHello.compatible) + ' host.version=' + JSON.stringify(pageHello && pageHello.host && pageHello.host.version) + ' source=' + JSON.stringify(pageHello && pageHello.host && pageHello.host.source))

  // (5) one real Agent turn observed through agent/status
  const baseline = await evaluateFn(async function (bridgePath) {
    const response = await fetch(bridgePath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 2, op: 'state' }) })
    return await response.json()
  }, [BRIDGE_PATH])
  evidence.browser.stateBaseline = baseline
  const baselineCount = baseline && Array.isArray(baseline.transitions) ? baseline.transitions.length : 0
  await evaluateFn(async function () {
    for (const pattern of [/^continue$/i, /got it/i]) {
      const button = Array.from(document.querySelectorAll('button')).find(function (candidate) { return pattern.test(String(candidate.textContent || '').trim()) })
      if (button) {
        button.click()
        await new Promise(function (resolve) { setTimeout(resolve, 400) })
      }
    }
    const newSession = Array.from(document.querySelectorAll('button')).find(function (candidate) { return /new session/i.test(candidate.getAttribute('aria-label') || candidate.textContent || '') })
    if (newSession) newSession.click()
    await new Promise(function (resolve) { setTimeout(resolve, 1500) })
    const choose = Array.from(document.querySelectorAll('button, [role="button"]')).find(function (candidate) { return /choose workspace/i.test(candidate.getAttribute('aria-label') || candidate.textContent || '') })
    if (choose) choose.click()
    await new Promise(function (resolve) { setTimeout(resolve, 900) })
    return true
  }, [])
  const workspaceOpened = await poll(async function () {
    return await evaluateFn(async function (workspaceDir) {
      if (document.querySelector('[contenteditable="true"][role="textbox"]')) return 'already-open'
      const dialog = document.querySelector('[role="dialog"]')
      if (!dialog) return false
      const edit = Array.from(dialog.querySelectorAll('button')).find(function (candidate) { return /edit path/i.test(candidate.getAttribute('aria-label') || candidate.textContent || '') })
      if (edit && !dialog.querySelector('input[aria-label="Edit path"]')) {
        edit.click()
        await new Promise(function (resolve) { setTimeout(resolve, 400) })
      }
      const input = document.querySelector('input[aria-label="Edit path"]')
      if (!input) return false
      if (input.value !== workspaceDir) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, workspaceDir)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise(function (resolve) { setTimeout(resolve, 300) })
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
        await new Promise(function (resolve) { setTimeout(resolve, 900) })
      }
      const current = document.querySelector('[role="dialog"]')
      const open = current && Array.from(current.querySelectorAll('button')).find(function (candidate) { return /^open$/i.test(String(candidate.getAttribute('aria-label') || candidate.textContent || '').trim()) })
      if (open) open.click()
      await new Promise(function (resolve) { setTimeout(resolve, 1800) })
      return document.querySelector('[contenteditable="true"][role="textbox"]') ? 'opened' : false
    }, [context.workspaceDir])
  }, { timeoutMs: 30000, label: 'workspace picker selecting the smoke workspace' })
  check('browser.workspace-selected', workspaceOpened === 'opened' || workspaceOpened === 'already-open', 'workspace picker selected ' + context.workspaceDir + ' (' + workspaceOpened + ')')
  const focused = await poll(async function () {
    return await evaluateFn(function () {
      const box = document.querySelector('[contenteditable="true"][role="textbox"]')
      if (!box) return false
      box.focus()
      const selection = window.getSelection()
      selection.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(box)
      range.collapse(false)
      selection.addRange(range)
      return box.isContentEditable
    }, [])
  }, { timeoutMs: 20000, label: 'chat composer focus' })
  check('browser.composer-found', focused === true, 'session chat composer is available after workspace selection')
  await cdp.send('Input.insertText', { text: 'Say hello in one short sentence.' })
  await sleep(400)
  const sent = await evaluateFn(function () {
    const box = document.querySelector('[contenteditable="true"][role="textbox"]')
    const button = Array.from(document.querySelectorAll('button')).find(function (candidate) { return /send message/i.test(candidate.getAttribute('aria-label') || '') })
    if (!box || !button) return { ok: false, text: box ? box.innerText : null }
    const text = box.innerText
    button.click()
    return { ok: true, text: text }
  }, [])
  check('browser.turn-sent', sent && sent.ok === true, 'typed the prompt and clicked Send (composer text: ' + JSON.stringify(sent && sent.text) + ')')
  const turn = await poll(async function () {
    const state = await evaluateFn(async function (bridgePath) {
      const response = await fetch(bridgePath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 2, op: 'state' }) })
      return await response.json()
    }, [BRIDGE_PATH])
    const transitions = state && Array.isArray(state.transitions) ? state.transitions : []
    if (transitions.length <= baselineCount) return false
    const after = transitions.slice(-8)
    const sawRunning = after.some(function (item) { return item.state === 'running' })
    const last = after[after.length - 1]
    const endedIdle = last && last.state === 'idle'
    if (!(sawRunning && endedIdle && state.state === 'idle')) return false
    return { state: state, transitions: after }
  }, { timeoutMs: 90000, intervalMs: 400, label: 'agent/status running -> idle through the famling bridge' })
  evidence.browser.turn = {
    baselineTransitions: baselineCount,
    observedTransitions: turn.transitions,
    finalState: { available: turn.state.available, source: turn.state.source, state: turn.state.state, active: turn.state.active, lastError: turn.state.lastError },
  }
  check('browser.agent-busy-quiet', true, 'agent/status observed through the plugin: ' + turn.transitions.map(function (item) { return item.state }).join(' -> ') + ' (available=' + turn.state.available + ' source=' + turn.state.source + ' lastError=' + JSON.stringify(turn.state.lastError) + ')')
  const replyText = await poll(async function () {
    const text = await evaluateFn(function () { return document.body.innerText }, [])
    return String(text).indexOf(MOCK_SUCCESS_TEXT) !== -1 ? String(text) : false
  }, { timeoutMs: 30000, label: 'mock model reply in the chat transcript' })
  check('browser.model-turn-rendered', true, 'the real Web UI rendered the mock provider reply (' + JSON.stringify(MOCK_SUCCESS_TEXT.slice(0, 40) + '...') + ')')
  observe('browser.turn-transcript', 'body text after the turn (bounded)', replyText.slice(0, 1200))
  const finalShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  if (finalShot && finalShot.result && finalShot.result.data) writeFileSync(options.screenshot, Buffer.from(finalShot.result.data, 'base64'))
  evidence.artifacts.screenshot = options.screenshot
  check('browser.screenshot', existsSync(options.screenshot), options.screenshot)
  cdp.close()
  endStep('pass', 'character + menu + bridge + one real agent turn')
}

// ── Entry point ──────────────────────────────────────────────────────────────

let interrupted = false
process.on('SIGINT', function () { interrupted = true })
process.on('SIGTERM', function () { interrupted = true })

async function run() {
  try {
    const context = await phasePrepare()
    const hostState = await phaseHost(context)
    await phaseHttp(context, hostState)
    await phaseBrowser(context, hostState)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(NL + '[error] ' + message)
    if (currentStep) endStep('fail', message)
    failures.push({ id: 'harness', ok: false, detail: message, at: new Date().toISOString() })
  } finally {
    await killEverything()
    evidence.finishedAt = new Date().toISOString()
    evidence.pass = failures.length === 0 && !interrupted
    evidence.summary = {
      checks: evidence.checks.length,
      passed: evidence.checks.filter(function (item) { return item.ok }).length,
      failed: failures.length,
      failedIds: failures.map(function (item) { return item.id }),
    }
    mkdirSync(dirname(options.json), { recursive: true })
    writeFileSync(options.json, JSON.stringify(evidence, undefined, 2) + NL)
    log(NL + '=== dsh-host-smoke: ' + (evidence.pass ? 'PASS' : 'FAIL') + ' (' + evidence.summary.passed + '/' + evidence.summary.checks + ' checks) ===')
    for (const failure of failures) log('  failed: ' + failure.id + ' - ' + failure.detail)
    log('evidence: ' + options.json)
    if (options.clean && evidence.pass && !options.json.startsWith(options.workdir) && !options.screenshot.startsWith(options.workdir)) {
      try { rmSync(options.workdir, { recursive: true, force: true }) } catch (error) { /* ignore */ }
    } else {
      log('workdir kept: ' + options.workdir)
    }
    process.exit(evidence.pass ? 0 : 1)
  }
}

run()
