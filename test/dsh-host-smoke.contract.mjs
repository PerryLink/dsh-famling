#!/usr/bin/env node
/**
 * Static rc.4 / rc.5 host-contract gate for dsh-famling (A3, 2026-11-21).
 *
 * The plugin's engines.dsh range starts at 0.2.1-rc.5, and its runtime writes
 * four Host contracts by hand (no DSH types at runtime):
 *
 *   1. the sidebar.footer.action slot is DECLARED by ui-sidebar and rendered
 *      through ctx.slots.register(), with the list kind that requires an id
 *   2. Host features register authenticated Fetch routes through
 *      ctx.connection.fetch.register() (the plugin's /api/famling/bridge)
 *   3. Agent lifecycle transitions arrive on the agent/status event with
 *      status 'idle' | 'running'
 *   4. the Web client-module scan loads only packages declaring a dsh.client
 *      platform of 'web' (this plugin declares exactly that)
 *
 * This script proves those four contracts by reading the tagged git trees
 * (git show <tag>:<path>), not by trusting a checkout's working tree:
 *   --from dsh-v0.2.1-rc.4   the last release the plugin excludes
 *   --to   dsh-v0.2.1-rc.5   the first release the plugin admits
 *   --head HEAD              the checkout actually booted by the smoke script
 *
 * It also evaluates the plugin's engines.dsh range against every ref, and
 * records blob hashes so "the contract is the same in both releases" is
 * reproducible rather than asserted. rc.4 and rc.5 hosts are NOT booted here:
 * this machine carries one built checkout (HEAD); building a second release
 * from a git tag would need another full pnpm install + build. The dynamic
 * proof of the contract lives in test/dsh-host-smoke.mjs against HEAD.
 *
 * Usage:
 *   node test/dsh-host-smoke.contract.mjs [options]
 *     --checkout PATH   DSH checkout (default $DSH_CHECKOUT)
 *     --plugin PATH     this plugin's directory (default: repo root)
 *     --from REF        first ref (default dsh-v0.2.1-rc.4)
 *     --to REF          second ref (default dsh-v0.2.1-rc.5)
 *     --head REF        checkout ref (default HEAD)
 *     --json PATH       evidence JSON (default <plugin>/test/dsh-host-smoke.contract.json)
 *     --help            this help
 *
 * Exit codes: 0 = every required contract gate passed, 1 = a gate failed, 2 = setup.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NL = String.fromCharCode(10)

const USAGE = [
  'Usage: node test/dsh-host-smoke.contract.mjs [options]',
  '  --checkout PATH   DSH checkout (default $DSH_CHECKOUT)',
  '  --plugin PATH     plugin directory (default: repo root)',
  '  --from REF        first ref (default dsh-v0.2.1-rc.4)',
  '  --to REF          second ref (default dsh-v0.2.1-rc.5)',
  '  --head REF        checkout ref (default HEAD)',
  '  --json PATH       evidence JSON output path',
  '  --help            this help',
].join(NL)

function parseArgs(argv) {
  const parsed = {
    checkout: process.env.DSH_CHECKOUT || '',
    plugin: REPO_ROOT,
    from: 'dsh-v0.2.1-rc.4',
    to: 'dsh-v0.2.1-rc.5',
    head: 'HEAD',
    json: '',
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
    else if (arg === '--from') parsed.from = value()
    else if (arg === '--to') parsed.to = value()
    else if (arg === '--head') parsed.head = value()
    else if (arg === '--json') parsed.json = resolve(value())
    else if (arg === '--help' || arg === '-h') { process.stdout.write(USAGE + NL); process.exit(0) }
    else throw new Error('unknown argument ' + JSON.stringify(arg) + ' (try --help)')
  }
  if (!parsed.checkout) throw new Error('--checkout PATH or $DSH_CHECKOUT is required')
  if (!parsed.json) parsed.json = join(parsed.plugin, 'test', 'dsh-host-smoke.contract.json')
  return parsed
}

const options = parseArgs(process.argv.slice(2))
const checkout = resolve(options.checkout)
const failures = []
const checks = []

function log(message) { process.stdout.write(String(message) + NL) }

function check(id, ok, detail) {
  const record = { id: id, ok: Boolean(ok), detail: String(detail) }
  checks.push(record)
  if (!record.ok) failures.push(record)
  log('  [' + (record.ok ? 'pass' : 'FAIL') + '] ' + id + ': ' + record.detail)
  return record
}

function git(args, settings) {
  const config = settings || {}
  const result = spawnSync('git', ['-C', checkout].concat(args), { encoding: 'utf8', timeout: 60000 })
  if (result.status !== 0) {
    if (config.allowFail) return null
    throw new Error('git ' + args.join(' ') + ' failed: ' + String(result.stderr || ''))
  }
  return String(result.stdout || '')
}

function readRefFile(ref, path) {
  const text = git(['show', ref + ':' + path], { allowFail: true })
  return text === null ? { exists: false, text: '', blob: null } : { exists: true, text: text, blob: git(['rev-parse', ref + ':' + path], { allowFail: true }).trim() }
}

function lineOf(text, regex) {
  const lines = text.split(NL)
  for (let index = 0; index < lines.length; index += 1) if (regex.test(lines[index])) return index + 1
  return null
}

function countOf(text, regex) {
  const matches = text.match(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g'))
  return matches === null ? 0 : matches.length
}

// ── Semver satisfaction for the plugin's engines.dsh range ───────────────────

function parseSemver(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(text).trim())
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] === undefined ? [] : match[4].split('.') }
}

function compareIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : Number(a) > Number(b) ? 1 : 0
  if (aNumeric) return -1
  if (bNumeric) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function compareSemver(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1
    if (b.prerelease[index] === undefined) return 1
    const order = compareIdentifiers(a.prerelease[index], b.prerelease[index])
    if (order !== 0) return order
  }
  return 0
}

function satisfiesComparator(version, comparator) {
  const match = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator.trim())
  if (match === null) return false
  const operator = match[1] === undefined ? '=' : match[1]
  const target = parseSemver(match[2])
  if (target === null) return false
  const order = compareSemver(version, target)
  if (operator === '>=') return order >= 0
  if (operator === '<=') return order <= 0
  if (operator === '>') return order > 0
  if (operator === '<') return order < 0
  return order === 0
}

function satisfiesRange(versionText, rangeText) {
  const version = parseSemver(versionText)
  if (version === null) return false
  for (const alternative of String(rangeText).split('||')) {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean)
    if (comparators.length === 0) continue
    if (comparators.every(function (comparator) { return satisfiesComparator(version, comparator) })) return true
  }
  return false
}

// ── The contract table ───────────────────────────────────────────────────────

const HOST_CONTRACTS = [
  {
    id: 'slot.sidebar-footer-action-declaration',
    title: 'ui-sidebar declares the sidebar.footer.action list slot',
    file: 'packages/client/ui-sidebar/src/client/contract/slots.ts',
    patterns: [
      { id: 'slot-type-declaration', regex: /'sidebar\.footer\.action': \{ kind: 'list'; scope: 'root'/ },
      { id: 'owner-props', regex: /SidebarFooterActionOwnerProps/ },
    ],
  },
  {
    id: 'slot.sidebar-footer-action-runtime-declaration',
    title: 'the sidebar entry declares sidebar.footer.action to the slot registry at runtime',
    file: 'packages/client/ui-sidebar/src/client/index.ts',
    patterns: [
      { id: 'slot-runtime-declaration', regex: /'sidebar\.footer\.action': \{ kind: 'list', scope: 'root' \}/ },
    ],
  },
  {
    id: 'slots.register-and-inject',
    title: 'the slots service offers register() and inject(), the two calls this plugin makes',
    file: 'packages/client/ui-renderer/src/client/registry.ts',
    patterns: [
      { id: 'inject-signature', regex: /inject\(key: keyof SlotMap & string, callback: \(\) => SlotInjectionEffect\): \(\) => void/ },
      { id: 'register-forwarding', regex: /declare readonly register: SlotCore\['register'\]/ },
    ],
  },
  {
    id: 'slots.list-requires-id',
    title: 'a list slot registration requires the id this plugin passes',
    file: 'packages/client/ui-slots/src/index.ts',
    patterns: [
      { id: 'requires-id-error', regex: /requires options\.id/ },
      { id: 'list-kind-case', regex: /case 'list':/ },
    ],
  },
  {
    id: 'connection.fetch-route-shape',
    title: 'ConnectionFetchRoute admits POST plus a buffered body (the plugin bridge route)',
    file: 'packages/client/connection/src/rpc.ts',
    patterns: [
      { id: 'route-interface', regex: /export interface ConnectionFetchRoute/ },
      { id: 'methods-type', regex: /ConnectionFetchMethod = 'GET' \| 'HEAD' \| 'POST'/ },
      { id: 'body-mode-type', regex: /ConnectionRequestBodyMode = 'buffered' \| 'streaming'/ },
      { id: 'host-registry', regex: /register\(route: ConnectionFetchRoute\): \(\) => Promise<void>/ },
    ],
  },
  {
    id: 'connection.fetch-register-registration',
    title: 'ctx.connection.fetch.register() wires an exact Fetch route and validates it',
    file: 'packages/client/connection/src/rpc-host.ts',
    patterns: [
      { id: 'register-method', regex: /register: route => this\.registerFetchRoute\(owner, route\)/ },
      { id: 'route-validation', regex: /function assertFetchRoute\(route: ConnectionFetchRoute\): void/ },
    ],
  },
  {
    id: 'agent.status-event',
    title: 'agent/status is emitted with { agent, status } and AgentStatus is idle|running',
    file: 'packages/core/agent/src/runtime-types.ts',
    patterns: [
      { id: 'status-type', regex: /export type AgentStatus = 'idle' \| 'running'/ },
      { id: 'status-event', regex: /'agent\/status'\(this: Scoped<Agent>, payload: \{ agent: Agent; status: AgentStatus \}\): void/ },
    ],
  },
  {
    id: 'client.platform-gate',
    title: "the client-module scan loads only a dsh.client platform of 'web' (what this plugin declares)",
    file: 'packages/client/modules/src/index.ts',
    patterns: [
      { id: 'platform-check', regex: /decl\.platform !== 'web'/ },
    ],
  },
]

const INJECT_PACKAGES = [
  { id: 'inject.ui-sidebar', directory: 'packages/client/ui-sidebar', name: '@deepseek-ai/dsh-client-ui-sidebar' },
  { id: 'inject.ui-layout', directory: 'packages/client/ui-layout', name: '@deepseek-ai/dsh-client-ui-layout' },
  { id: 'inject.ui-renderer', directory: 'packages/client/ui-renderer', name: '@deepseek-ai/dsh-client-ui-renderer' },
]

const PLUGIN_WIRE_CONTRACTS = [
  { id: 'plugin.bridge-wire-version', file: 'index.js', regex: /const BRIDGE_WIRE_VERSION = 2/, detail: 'Host half negotiates bridge wire v2' },
  { id: 'plugin.bridge-wire-accepts', file: 'index.js', regex: /const WIRE_VERSIONS = \[LEGACY_WIRE_VERSION, BRIDGE_WIRE_VERSION\]/, detail: 'legacy v1 remains accepted' },
  { id: 'plugin.bridge-path', file: 'index.js', regex: /const BRIDGE_PATH = '\/api\/famling\/bridge'/, detail: 'bridge path is under /api so it requires an authenticated Peer' },
  { id: 'plugin.hello-op', file: 'index.js', regex: /op: 'hello'/, detail: 'Host answers hello' },
  { id: 'plugin.probe-op', file: 'index.js', regex: /op: 'probe'/, detail: 'Host answers probe' },
  { id: 'plugin.state-op', file: 'index.js', regex: /op: 'state'/, detail: 'Host answers state' },
  { id: 'plugin.hello-probe-wire-guard', file: 'index.js', regex: /hello\/probe\/state require bridge wire 2/, detail: 'hello/probe/state are rejected below wire 2' },
  { id: 'plugin.client-wire-version', file: 'client.js', regex: /const BRIDGE_WIRE_VERSION = 2/, detail: 'browser half sends bridge wire v2' },
  { id: 'plugin.client-hello', file: 'client.js', regex: /op: 'hello', clientVersion: PLUGIN_VERSION, wireVersion: BRIDGE_WIRE_VERSION/, detail: 'browser hello carries its version and wire revision' },
  { id: 'plugin.client-probe', file: 'client.js', regex: /op: 'probe'/, detail: 'browser can re-probe capabilities' },
  { id: 'plugin.client-slot-inject', file: 'client.js', regex: /ctx\.slots\.inject\('sidebar\.footer\.action'/, detail: 'browser registers into the footer action slot' },
]

function versionOfRef(ref) {
  const file = readRefFile(ref, 'apps/cli/package.json')
  if (!file.exists) return null
  try { return JSON.parse(file.text).version } catch (error) { return null }
}

function main() {
  const evidence = {
    schema: 'dsh-host-smoke-contract/1',
    kind: 'dsh-famling-rc4-rc5-contract-gate',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    pass: false,
    checkout: checkout,
    refs: { from: options.from, to: options.to, head: options.head },
    versions: { from: null, to: null, head: null },
    engineRange: null,
    hostContracts: [],
    injectPackages: [],
    pluginWire: [],
    hashes: [],
    checks: checks,
    limitations: [
      'rc.4/rc.5 Host instances are not booted by this script: only one built checkout exists on this machine, and building a release tag needs another full pnpm install + build. The dynamic proof runs in test/dsh-host-smoke.mjs against HEAD.',
      'Static assertions read blobs from the git object database (git show <ref>:<path>), so they do not depend on the checkout working tree state.',
    ],
  }
  log('=== dsh-famling rc.4/rc.5 contract gate ===')
  log('checkout: ' + checkout)
  for (const ref of [options.from, options.to, options.head]) {
    const version = versionOfRef(ref)
    if (version === null) throw new Error('ref ' + ref + ' is not a usable DSH tree (no apps/cli/package.json version)')
    if (ref === options.from) evidence.versions.from = version
    if (ref === options.to) evidence.versions.to = version
    if (ref === options.head) evidence.versions.head = version
    log('ref ' + ref + ' -> Host ' + version)
  }

  const pluginManifest = JSON.parse(readFileSync(join(options.plugin, 'package.json'), 'utf8'))
  const engineRange = pluginManifest.engines && pluginManifest.engines.dsh
  evidence.engineRange = engineRange || null
  evidence.plugin = { name: pluginManifest.name, version: pluginManifest.version, enginesDsh: engineRange || null }
  const clientDeclaration = pluginManifest.dsh && pluginManifest.dsh.client
  check('plugin.declares-client-platform-web', clientDeclaration !== undefined && clientDeclaration.platform === 'web', 'package.json dsh.client.platform = ' + JSON.stringify(clientDeclaration && clientDeclaration.platform) + ' (the Host gate this plugin must satisfy)')

  // Host contracts, per ref
  for (const contract of HOST_CONTRACTS) {
    const record = { id: contract.id, title: contract.title, file: contract.file, refs: {} }
    for (const ref of [options.from, options.to, options.head]) {
      const file = readRefFile(ref, contract.file)
      const patterns = []
      let refOk = file.exists
      for (const pattern of contract.patterns) {
        const line = file.exists ? lineOf(file.text, pattern.regex) : null
        patterns.push({ id: pattern.id, present: line !== null, line: line, count: line === null ? 0 : countOf(file.text, pattern.regex) })
        if (line === null) refOk = false
      }
      record.refs[ref] = { exists: file.exists, blob: file.blob, ok: refOk, patterns: patterns }
    }
    evidence.hostContracts.push(record)
    check('contract.' + contract.id + '.to', record.refs[options.to].ok, contract.title + ' [' + options.to + ']: ' + summarizeRef(record.refs[options.to]))
    check('contract.' + contract.id + '.head', record.refs[options.head].ok, contract.title + ' [head ' + options.head + ']: ' + summarizeRef(record.refs[options.head]))
    const identical = record.refs[options.from].blob !== null && record.refs[options.from].blob === record.refs[options.to].blob
    evidence.hashes.push({ id: contract.id, file: contract.file, fromBlob: record.refs[options.from].blob, toBlob: record.refs[options.to].blob, headBlob: record.refs[options.head].blob, fromEqualsTo: identical, toEqualsHead: record.refs[options.to].blob === record.refs[options.head].blob })
  }

  // The three client packages this plugin's dsh.client.inject names must exist in both releases.
  for (const inject of INJECT_PACKAGES) {
    const refs = {}
    for (const ref of [options.from, options.to, options.head]) {
      const file = readRefFile(ref, inject.directory + '/package.json')
      let name = null
      if (file.exists) { try { name = JSON.parse(file.text).name } catch (error) { name = null } }
      refs[ref] = { exists: file.exists, name: name, ok: name === inject.name }
    }
    evidence.injectPackages.push({ id: inject.id, package: inject.name, refs: refs })
    check('inject.' + inject.id + '.to', refs[options.to].ok, inject.name + ' resolves in ' + options.to)
    check('inject.' + inject.id + '.head', refs[options.head].ok, inject.name + ' resolves at ' + options.head)
  }

  // The hello/probe wire is plugin-owned; assert the constants the two halves share.
  for (const wire of PLUGIN_WIRE_CONTRACTS) {
    const text = readFileSync(join(options.plugin, wire.file), 'utf8')
    const line = lineOf(text, wire.regex)
    evidence.pluginWire.push({ id: wire.id, file: wire.file, present: line !== null, line: line, detail: wire.detail })
    check('wire.' + wire.id, line !== null, wire.detail + ' (' + wire.file + (line === null ? ': pattern missing)' : ':' + line + ')'))
  }

  // engines.dsh must exclude rc.4 and admit rc.5 and the booted checkout.
  if (engineRange === undefined || engineRange === null) {
    check('engine.range-present', false, 'package.json declares no engines.dsh range')
  } else {
    const engineResults = {
      from: { version: evidence.versions.from, satisfies: satisfiesRange(evidence.versions.from, engineRange) },
      to: { version: evidence.versions.to, satisfies: satisfiesRange(evidence.versions.to, engineRange) },
      head: { version: evidence.versions.head, satisfies: satisfiesRange(evidence.versions.head, engineRange) },
    }
    evidence.engineResults = engineResults
    check('engine.excludes-from', engineResults.from.satisfies === false, 'engines.dsh ' + JSON.stringify(engineRange) + ' rejects ' + options.from + ' (' + evidence.versions.from + ')')
    check('engine.admits-to', engineResults.to.satisfies === true, 'engines.dsh ' + JSON.stringify(engineRange) + ' admits ' + options.to + ' (' + evidence.versions.to + ')')
    check('engine.admits-head', engineResults.head.satisfies === true, 'engines.dsh ' + JSON.stringify(engineRange) + ' admits the booted checkout (' + evidence.versions.head + ')')
  }

  // Record what moved between rc.5 and HEAD, without failing on a move.
  for (const hash of evidence.hashes) {
    check('location.' + hash.id, hash.toEqualsHead ? true : true, hash.id + ': ' + (hash.fromEqualsTo ? 'rc.4==rc.5 identical blob (' + short(hash.toBlob) + ')' : 'rc.4/rc.5 differ') + ', rc.5->HEAD ' + (hash.toEqualsHead ? 'unchanged' : 'moved (blob ' + short(hash.toBlob) + ' -> ' + short(hash.headBlob) + ')'))
  }

  evidence.finishedAt = new Date().toISOString()
  evidence.pass = failures.length === 0
  evidence.summary = { checks: checks.length, passed: checks.filter(function (item) { return item.ok }).length, failed: failures.length, failedIds: failures.map(function (item) { return item.id }) }
  mkdirSync(dirname(options.json), { recursive: true })
  writeFileSync(options.json, JSON.stringify(evidence, undefined, 2) + NL)
  log('')
  log('=== contract gate: ' + (evidence.pass ? 'PASS' : 'FAIL') + ' (' + evidence.summary.passed + '/' + evidence.summary.checks + ' checks) ===')
  for (const failure of failures) log('  failed: ' + failure.id + ' - ' + failure.detail)
  log('evidence: ' + options.json)
  process.exit(evidence.pass ? 0 : 1)
}

function short(blob) { return blob === null ? 'null' : blob.slice(0, 10) }
function summarizeRef(ref) {
  if (!ref.exists) return 'file missing'
  const present = ref.patterns.filter(function (pattern) { return pattern.present }).length
  return present + '/' + ref.patterns.length + ' patterns at ' + ref.patterns.map(function (pattern) { return pattern.id + (pattern.line === null ? ':missing' : ':' + pattern.line) }).join(', ')
}

try {
  main()
} catch (error) {
  log(NL + '[error] ' + (error instanceof Error ? error.message : String(error)))
  process.exit(2)
}
