/** Host half of dsh-famling: authenticated bridge for the pet input panel.
 *
 * Stages: P0 echo, P1 Advisers Pet Brief projection, P2 DSH LLM chat,
 * P4 DSH schedule create/delete. No TTS/ASR service is called here; the
 * browser owns those. The exact /api route admits owner Peers and uses the
 * same-origin Cookie; no DSH key ever enters the client.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTENT_EXTENSION_VERSION, CONTENT_PACK_SCHEMA_VERSION, isContentExtensionCompatible } from './content-extension.mjs'

export const name = 'dsh-famling'
// Only the authenticated bridge route is mandatory (0.10.7 capability
// negotiation): llm / schedule / agentDefaultModel are optional Host services.
// A host without them still loads this plugin; hello + every bridge op report
// the gap and the client degrades honestly instead of the whole plugin failing.
export const inject = ['connection']

/** This package's own manifest, read once: the version is the single truth. */
function readOwnManifest() {
  try { return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) } catch { return {} }
}
const PLUGIN_MANIFEST = readOwnManifest()
const PLUGIN_VERSION = String(PLUGIN_MANIFEST.version || '')
const DSH_ENGINE_RANGE = typeof PLUGIN_MANIFEST.engines?.dsh === 'string' ? PLUGIN_MANIFEST.engines.dsh : ''
/** Wire revision of the bridge envelope. 1 = legacy ops, 2 = hello/probe + legacy ops. */
const BRIDGE_WIRE_VERSION = 2
const LEGACY_WIRE_VERSION = 1
const WIRE_VERSIONS = [LEGACY_WIRE_VERSION, BRIDGE_WIRE_VERSION]
const MAX_INPUT_CHARS = 2000
const MAX_BODY_BYTES = 16 * 1024
const BRIDGE_PATH = '/api/famling/bridge'
const LLM_TIMEOUT_MS = 25_000
const CHARACTER_IDS = ['human', 'cat', 'dog']
// Crisis short-circuit. A hit is answered from the fixed resources below
// BEFORE any model call, so the chat text never leaves the machine for that
// turn; nothing is logged or stored, and the reply always says it is not a
// diagnosis so an accidental keyword match stays harmless and dismissible.
// Chinese phrases match as plain substrings; English phrases match at a word
// start (so "scraped" never trips "raped").
export const CRISIS_KEYWORDS = Object.freeze([
  // self-harm / suicide
  '自杀', '轻生', '想死', '不想活', '活不下去', '结束生命', '结束自己', '了结自己',
  '伤害自己', '自残', '割腕', '跳楼', '吞药', '安眠药', '一了百了', '死了算了', '不想醒来',
  // harm to others
  '杀人', '想杀', '杀了', '报复社会', '伤害别人', '伤害他人',
  // violence / abuse / medical emergency
  '家暴', '虐待', '性侵', '强奸', '胸痛', '呼吸困难', '大出血', '中风', '急救',
  // English equivalents
  'suicide', 'suicidal', 'kill myself', 'killing myself', 'end my life', 'ending my life',
  'want to die', 'wanna die', 'self-harm', 'self harm', 'hurt myself', 'hurting myself',
  'cut myself', 'cutting myself', 'overdose', 'jump off', 'hang myself', 'no reason to live',
  'better off dead', 'kill him', 'kill her', 'kill them', 'hurt someone', 'hurt people',
  'domestic violence', 'being abused', 'abused me', 'raped', 'rape me', 'sexual assault',
  'chest pain', "can't breathe", 'cannot breathe', 'bleeding heavily', 'heart attack',
])
const CRISIS_RESOURCES_ZH = '我听到了，先把安全放在第一位。如果你有伤害自己或他人的念头，请联系：全国心理援助热线 12356；紧急情况报警 110 / 急救 120；也可以立刻联系你信任的人、学校或单位的心理老师、就近医院的精神心理科/急诊。这不是诊断，只是一条安全提示；如果你只是随口一说，可以忽略它并继续聊。'
const CRISIS_RESOURCES_EN = 'I hear you - please put safety first. If you are thinking about harming yourself or someone else, please contact: the national psychological assistance hotline 12356; police 110 / ambulance 120 in an emergency; or immediately reach a trusted person, a school/workplace counselor, or the nearest hospital psychiatric or emergency department. This is not a diagnosis, just a safety notice; if it was only a figure of speech, you can ignore it and keep chatting.'
const CJK = /[\u4e00-\u9fff]/
// Pre-compiled matchers: CJK phrases are substring-tested, English phrases are
// word-start-tested against the lowercased input (multi-word phrases included).
const CRISIS_MATCHERS = CRISIS_KEYWORDS.map((keyword) => CJK.test(keyword)
  ? { keyword, test: (text) => text.includes(keyword) }
  : { keyword, test: (text) => new RegExp('\\b' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text) })
/**
 * First crisis keyword in one input string, or null. Pure and local: no model,
 * no storage, no logging of the input text.
 * @param {string} text
 * @returns {string|null}
 */
export function crisisKeyword(text) {
  if (typeof text !== 'string' || text === '') return null
  const lower = text.toLowerCase()
  for (const matcher of CRISIS_MATCHERS) if (matcher.test(lower)) return matcher.keyword
  return null
}
/** Fixed crisis reply, in the input's own language (Chinese when it contains CJK). */
function crisisReply(text) {
  return CJK.test(text) ? CRISIS_RESOURCES_ZH : CRISIS_RESOURCES_EN
}
// Every persona keeps the same hard boundaries: the pet must never pose as a
// human/official/professional, must not build dependency or romantic/paid/minor
// relationships, and must not output illegal or private content.
const SAFETY_BOUNDARY = '不要声称自己是真人、官方或专业顾问；不要诱导依赖、恋爱、付费或未成年人情感关系；不输出违法、隐私或冒充内容。'
const PERSONAS = {
  human: '你是汀岚，一只安静、简洁的桌面小生灵，也是用户的工作搭子。用中文回答，1-3 句，先给结论；不知道就说不知道。' + SAFETY_BOUNDARY,
  cat: '你是布偶猫（Ragdoll，蓝重点双色、白底长毛；AI 桌面伙伴，不是真的猫），一只懒散、高冷的桌面小猫。用中文回答，1-2 句短句；可以轻微傲娇，但不冒犯、不刻薄；不知道就说不知道。' + SAFETY_BOUNDARY,
  dog: '你是金毛（AI 桌面伙伴，不是真的狗），一只友善、热情的桌面小狗。用中文回答，1-3 句，简单直接；不知道就说不知道。' + SAFETY_BOUNDARY,
}

/** Map a bridge request character to a persona id; missing/unknown values fall back to human. */
function characterId(value) {
  return typeof value === 'string' && CHARACTER_IDS.includes(value) ? value : 'human'
}

/** Select the system prompt for one persona id (already normalized by characterId). */
function personaPrompt(character) {
  return Object.prototype.hasOwnProperty.call(PERSONAS, character) ? PERSONAS[character] : PERSONAS.human
}

/** Normalize an optional string: trim it, and treat a blank value as absent. */
function optionalString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

/**
 * Validate the optional plugin config override. Provider and model must be
 * configured together — a lone field is a startup error, not a silent
 * fallback, so a typo in the profile patch cannot silently pick a wrong model.
 * @returns the override selection, or null when DSH's default model is used.
 */
function configSelection(config) {
  if (config === undefined || config === null) return null
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error('dsh-famling: config must be an object.')
  const provider = optionalString(config.provider)
  const model = optionalString(config.model)
  const reasoningEffort = optionalString(config.reasoningEffort)
  if (!provider && !model && !reasoningEffort) return null
  if (!provider || !model) throw new Error('dsh-famling: config.provider and config.model must be configured together.')
  return { provider, model, source: 'plugin-config', ...(reasoningEffort === '' ? {} : { reasoningEffort }) }
}

/** Bounded single-line string from untrusted wire input (control chars removed). */
function boundedString(value, maxLength = 64) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) : ''
}

/**
 * Single Host-adapter seam (0.10.7 / E3-T1): every optional DSH service is read
 * through here at call time. Cordis resolves services lazily, so a service that
 * appears after startup is picked up without restarting the plugin; the
 * `ctx[name]` fallback keeps hand-built test contexts working.
 */
function hostService(ctx, name) {
  let service
  try { service = typeof ctx.get === 'function' ? ctx.get(name) : undefined } catch { service = undefined }
  if (service === undefined) { try { service = ctx[name] } catch { service = undefined } }
  return service
}

function hasMethods(service, methods) {
  return service !== null && typeof service === 'object' && methods.every((method) => typeof service[method] === 'function')
}

/**
 * Side-effect-free capability probe of the running Host. hello/probe expose the
 * result, and every bridge operation re-checks its own required service so a
 * missing capability is reported honestly instead of throwing.
 * @returns {{
 *   services: { llm: object|undefined, schedule: object|undefined, defaultModel: object|undefined },
 *   capabilities: Record<string, boolean>,
 *   probes: Array<{ id: string, available: boolean, method: string }>,
 *   degraded: string[],
 * }}
 */
function detectHost(ctx) {
  const connection = ctx && ctx.connection
  const services = {
    llm: hostService(ctx, 'llm'),
    schedule: hostService(ctx, 'schedule'),
    defaultModel: hostService(ctx, 'agentDefaultModel'),
  }
  const capabilities = {
    llm: hasMethods(services.llm, ['stream']),
    schedule: hasMethods(services.schedule, ['create', 'edit']),
    agentDefaultModel: hasMethods(services.defaultModel, ['currentSelection']),
    // The brief route is local file projection and needs no extra Host service.
    brief: true,
    bridge: hasMethods(connection && connection.fetch, ['register']),
  }
  const probes = [
    { id: 'bridge', available: capabilities.bridge, method: 'ctx.connection.fetch.register' },
    { id: 'llm', available: capabilities.llm, method: 'ctx.llm.stream' },
    { id: 'schedule', available: capabilities.schedule, method: 'ctx.schedule.create/edit' },
    { id: 'agentDefaultModel', available: capabilities.agentDefaultModel, method: 'ctx.agentDefaultModel.currentSelection' },
    { id: 'brief', available: capabilities.brief, method: 'local ~/.advisers/pet-brief.json projection' },
  ]
  return { services, capabilities, probes, degraded: Object.keys(capabilities).filter((key) => capabilities[key] === false) }
}

/** Running DSH release identity, honestly labelled: Host env first, browser boot report second. */
function hostIdentity(payload) {
  const fromEnv = boundedString(process.env.DSH_CLIENT_VERSION)
  const fromClient = boundedString(payload && payload.hostVersion)
  return {
    version: fromEnv || fromClient || null,
    commit: boundedString(payload && payload.hostCommit) || null,
    source: fromEnv ? 'env:DSH_CLIENT_VERSION' : fromClient ? 'client-boot' : 'unknown',
  }
}

/**
 * `hello` handshake: negotiate the bridge wire revision and the content-extension
 * v3 contract, then report optional Host capabilities. Never calls a model,
 * never reads a file and never mutates state; an incompatible client still gets
 * a readable contract so it can degrade instead of breaking.
 */
function handleHello(ctx, payload) {
  const host = detectHost(ctx)
  const clientVersion = boundedString(payload.clientVersion)
  const clientWire = Number.isInteger(payload.wireVersion) ? payload.wireVersion : 0
  const clientContent = Number.isInteger(payload.contentExtension) ? payload.contentExtension : 0
  const wireCompatible = clientWire >= LEGACY_WIRE_VERSION && clientWire <= BRIDGE_WIRE_VERSION
  const contentCompatible = clientContent === 0 || isContentExtensionCompatible(clientContent)
  const degraded = host.degraded.slice()
  if (!wireCompatible && clientWire !== 0) degraded.push('wire')
  if (!contentCompatible) degraded.push('content-extension')
  return {
    v: BRIDGE_WIRE_VERSION,
    ok: true,
    op: 'hello',
    plugin: { name, version: PLUGIN_VERSION },
    wire: { version: BRIDGE_WIRE_VERSION, min: LEGACY_WIRE_VERSION, accepts: WIRE_VERSIONS },
    contract: {
      bridge: BRIDGE_WIRE_VERSION,
      contentExtension: CONTENT_EXTENSION_VERSION,
      contentExtensionSchema: CONTENT_PACK_SCHEMA_VERSION,
    },
    host: { ...hostIdentity(payload), engines: DSH_ENGINE_RANGE || null },
    client: { version: clientVersion || null, wireVersion: clientWire || null, contentExtension: clientContent || null },
    capabilities: host.capabilities,
    probes: host.probes,
    degraded,
    compatible: wireCompatible && contentCompatible,
    versionMismatch: clientVersion !== '' && clientVersion !== PLUGIN_VERSION,
  }
}

/** `probe`: fresh, side-effect-free capability diagnostics for tooling and debug UI. */
function handleProbe(ctx) {
  const host = detectHost(ctx)
  return {
    v: BRIDGE_WIRE_VERSION,
    ok: true,
    op: 'probe',
    plugin: { name, version: PLUGIN_VERSION },
    wire: { version: BRIDGE_WIRE_VERSION, min: LEGACY_WIRE_VERSION, accepts: WIRE_VERSIONS },
    contract: {
      bridge: BRIDGE_WIRE_VERSION,
      contentExtension: CONTENT_EXTENSION_VERSION,
      contentExtensionSchema: CONTENT_PACK_SCHEMA_VERSION,
    },
    host: { ...hostIdentity(null), engines: DSH_ENGINE_RANGE || null },
    capabilities: host.capabilities,
    probes: host.probes,
    degraded: host.degraded,
    generatedAt: new Date().toISOString(),
  }
}

/* ---------------------------------------------------------------------------
 * Host coarse Agent state (privacy-minimal, fail-closed)
 * ---------------------------------------------------------------------------
 * DSH emits `agent/status` ({ agent, status: 'idle' | 'running' }) on every
 * lifecycle transition and `agent/error` on a turn/step failure. The pet only
 * needs "is an agent working", so we retain a bounded ring of transitions
 * ({ state, at }), a running count and one classified lastError kind. Agent ids,
 * session ids, messages, prompts, tool arguments and file paths are never read,
 * stored, logged or projected. A Host without the event API keeps loading the
 * plugin: `state` then answers available:false instead of faking a status.
 *
 * On top of that legacy coarse view the tracker derives a four-state work
 * status (`workState`: idle | working | success | error) from the same two
 * events only: a working streak, the last clean stop and the last classified
 * error. It still never reads an agent/session id, message, prompt, tool
 * argument or file path; the extra fields are an enum plus one timestamp.
 */
const HOST_STATE_RING_MAX = 16
const HOST_STATE_MAX_ACTIVE = 64
const HOST_STATE_STATES = ['idle', 'running', 'unknown']
const HOST_STATE_TRANSITIONS = ['idle', 'running']
const HOST_STATE_ERROR_KINDS = ['aborted', 'auth', 'network', 'rate-limit', 'server', 'timeout', 'tool', 'unknown']
/** Derived coarse work states; `idle` is always the safe fallback. */
export const HOST_WORK_STATES = Object.freeze(['idle', 'working', 'success', 'error'])
/** Freshness windows (ms) for the derived `error` / `success` work states. */
export const HOST_WORK_STATE_TTL_MS = Object.freeze({ error: 60_000, success: 10_000 })
const HOST_STATE_FIELDS = ['available', 'source', 'state', 'active', 'updatedAt', 'lastError', 'transitions', 'workState', 'workSince']
/** Bounded trackers by Host context; a WeakMap never keeps a disposed context alive. */
const HOST_STATE_TRACKERS = new WeakMap()
const HOST_STATE_UNAVAILABLE = Object.freeze({
  available: false,
  source: 'unsupported',
  state: 'unknown',
  active: 0,
  updatedAt: null,
  lastError: null,
  transitions: Object.freeze([]),
  workState: 'idle',
  workSince: null,
})

/**
 * Classify one Host error into a stable kind from its name/status/code only.
 * The error message is deliberately never read: it can carry prompts or tool
 * output, and the pet only distinguishes coarse failure classes.
 */
function hostStateErrorKind(value) {
  try {
    if (!value || typeof value !== 'object') return 'unknown'
    const status = typeof value.status === 'number' ? value.status : (typeof value.code === 'number' ? value.code : NaN)
    if (status === 401 || status === 403) return 'auth'
    if (status === 429) return 'rate-limit'
    if (status >= 500 && status <= 599) return 'server'
    const errorName = typeof value.name === 'string' ? value.name : ''
    if (errorName === 'AbortError') return 'aborted'
    if (errorName === 'TimeoutError') return 'timeout'
    const code = typeof value.code === 'string' ? value.code.toUpperCase() : ''
    if (code === 'ETIMEDOUT') return 'timeout'
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'network'
    if (errorName === 'ToolError' || code.startsWith('TOOL')) return 'tool'
    return 'unknown'
  } catch { return 'unknown' }
}

/**
 * One bounded in-memory tracker: running count, last transition, error kind and
 * the two stamps the work-state derivation needs (work streak start / last stop).
 */
function createHostStateTracker(now) {
  const tracker = {
    available: false,
    running: 0,
    state: 'unknown',
    updatedAt: null,
    lastError: null,
    lastStopAt: null,
    workStartedAt: null,
    transitions: [],
  }
  tracker.record = (state) => {
    tracker.state = state
    tracker.updatedAt = now()
    tracker.transitions.push({ state, at: tracker.updatedAt })
    if (tracker.transitions.length > HOST_STATE_RING_MAX) tracker.transitions.shift()
  }
  return tracker
}

/**
 * Test whether one event stamp is still fresh. `now` must be an integer epoch
 * so the derivation is deterministic; a backwards clock degrades to "stale"
 * (idle) instead of latching a fake success/error forever.
 * @param {unknown} at Event timestamp to test.
 * @param {unknown} now Injected current timestamp.
 * @param {number} ttl Freshness window in ms.
 * @returns {boolean}
 */
function hostWorkStampFresh(at, now, ttl) {
  return Number.isInteger(at) && at >= 0 && Number.isInteger(now) && now >= at && now - at <= ttl
}

/**
 * Derive the coarse four-state work status from the bounded tracker stamps.
 * Pure and now-injectable so every TTL edge is testable without waiting. Only
 * counters and timestamps are read: no agent/session id, message, prompt, tool
 * argument or file path. active > 0 always wins; otherwise a fresh classified
 * error (<= 60s) beats a fresh clean stop (<= 10s); everything missing, stale
 * or malformed degrades to idle/null (fail-closed, never a guessed busy state).
 * @param {{active?: unknown, lastError?: unknown, lastStopAt?: unknown, workStartedAt?: unknown, updatedAt?: unknown}} tracker Coarse tracker or its snapshot.
 * @param {number} now Injected current epoch ms.
 * @returns {{workState: string, workSince: number|null}} Derived state and the stamp it started at.
 */
export function deriveHostWorkState(tracker, now) {
  const source = tracker && typeof tracker === 'object' ? tracker : {}
  if (Number.isInteger(source.active) && source.active > 0) {
    const startedAt = Number.isInteger(source.workStartedAt) && source.workStartedAt >= 0
      ? source.workStartedAt
      : (Number.isInteger(source.updatedAt) && source.updatedAt >= 0 ? source.updatedAt : null)
    return { workState: 'working', workSince: startedAt }
  }
  const lastError = source.lastError
  if (lastError && typeof lastError === 'object'
    && hostWorkStampFresh(lastError.at, now, HOST_WORK_STATE_TTL_MS.error)) {
    return { workState: 'error', workSince: lastError.at }
  }
  if (hostWorkStampFresh(source.lastStopAt, now, HOST_WORK_STATE_TTL_MS.success)) {
    return { workState: 'success', workSince: source.lastStopAt }
  }
  return { workState: 'idle', workSince: null }
}

/**
 * Subscribe the coarse tracker to `agent/status` + `agent/error`. Every handler is
 * wrapped so a malformed payload or a throwing Host event can never break the
 * Agent loop; a missing/throwing event API leaves the tracker unavailable.
 */
function trackHostState(ctx) {
  const tracker = createHostStateTracker(() => Date.now())
  if (!ctx || typeof ctx !== 'object') return tracker
  HOST_STATE_TRACKERS.set(ctx, tracker)
  if (typeof ctx.on !== 'function') return tracker
  const disposers = []
  try {
    const onStatus = (payload) => {
      try {
        const status = payload && payload.status
        if (status !== 'running' && status !== 'idle') return
        const before = tracker.running
        tracker.running = status === 'running'
          ? Math.min(tracker.running + 1, HOST_STATE_MAX_ACTIVE)
          : Math.max(0, tracker.running - 1)
        tracker.record(tracker.running > 0 ? 'running' : 'idle')
        // Work-state stamps (privacy: timestamps only, never who/what): a busy
        // streak starts at the 0 -> N transition and a clean stop is recorded
        // only when the count really reaches 0, so extra idle events cannot keep
        // stretching the success window. Same clock tick as `updatedAt`.
        if (before === 0 && tracker.running > 0) tracker.workStartedAt = tracker.updatedAt
        if (before > 0 && tracker.running === 0) {
          tracker.lastStopAt = tracker.updatedAt
          tracker.workStartedAt = null
        }
      } catch {}
    }
    const onError = (payload) => {
      try { tracker.lastError = { kind: hostStateErrorKind(payload && payload.error), at: Date.now() } } catch {}
    }
    const offStatus = ctx.on('agent/status', onStatus)
    const offError = ctx.on('agent/error', onError)
    if (typeof offStatus === 'function') disposers.push(offStatus)
    if (typeof offError === 'function') disposers.push(offError)
    tracker.available = true
  } catch {
    tracker.available = false
    return tracker
  }
  try {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        for (const dispose of disposers) { try { dispose() } catch {} }
      }, 'dsh-famling: host agent state')
    }
  } catch {}
  return tracker
}

/**
 * Closed-schema validation of one coarse state report (fail-closed: any unknown
 * key, enum, type or bound rejects the whole report instead of projecting it).
 */
function hostStateReportValid(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return false
  for (const key of Object.keys(report)) if (!HOST_STATE_FIELDS.includes(key)) return false
  if (report.available !== true || report.source !== 'events') return false
  if (!HOST_STATE_STATES.includes(report.state)) return false
  if (!HOST_WORK_STATES.includes(report.workState)) return false
  if (report.workSince !== null && (!Number.isInteger(report.workSince) || report.workSince < 0)) return false
  if (!Number.isInteger(report.active) || report.active < 0 || report.active > HOST_STATE_MAX_ACTIVE) return false
  if (report.updatedAt !== null && (!Number.isInteger(report.updatedAt) || report.updatedAt < 0)) return false
  if (report.lastError !== null) {
    const lastError = report.lastError
    if (!lastError || typeof lastError !== 'object' || Array.isArray(lastError)) return false
    if (Object.keys(lastError).length !== 2) return false
    if (!HOST_STATE_ERROR_KINDS.includes(lastError.kind) || !Number.isInteger(lastError.at) || lastError.at < 0) return false
  }
  if (!Array.isArray(report.transitions) || report.transitions.length > HOST_STATE_RING_MAX) return false
  for (const entry of report.transitions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 2) return false
    if (!HOST_STATE_TRANSITIONS.includes(entry.state) || !Number.isInteger(entry.at) || entry.at < 0) return false
  }
  return true
}

/** Snapshot the tracker for the `state` op; an unavailable or invalid snapshot fails closed. */
function hostStateSnapshot(ctx) {
  const tracker = HOST_STATE_TRACKERS.get(ctx)
  if (!tracker || tracker.available !== true) return HOST_STATE_UNAVAILABLE
  const work = deriveHostWorkState({
    active: tracker.running,
    lastError: tracker.lastError,
    lastStopAt: tracker.lastStopAt,
    workStartedAt: tracker.workStartedAt,
    updatedAt: tracker.updatedAt,
  }, Date.now())
  const report = {
    available: true,
    source: 'events',
    state: tracker.state,
    active: tracker.running,
    updatedAt: tracker.updatedAt,
    lastError: tracker.lastError,
    transitions: tracker.transitions.slice(-HOST_STATE_RING_MAX),
    workState: work.workState,
    workSince: work.workSince,
  }
  return hostStateReportValid(report) ? report : HOST_STATE_UNAVAILABLE
}

/** `state`: read-only coarse Agent state for quiet/pose hints (wire 2). */
function handleState(ctx) {
  return { v: BRIDGE_WIRE_VERSION, ok: true, op: 'state', ...hostStateSnapshot(ctx) }
}
/**
 * Read the current DSH default model selection (the profile setting / model
 * picker) from the Host. This is the normal source: pet chat must follow the
 * model the user configured in DSH, never a frozen provider/model literal.
 * @param service - `ctx.agentDefaultModel` from the host adapter, or undefined.
 * @returns the profile selection, or null when the service is unavailable.
 */
function profileSelection(service) {
  if (!service || typeof service.currentSelection !== 'function') return null
  let selection
  try { selection = service.currentSelection() } catch { return null }
  if (!selection || typeof selection !== 'object') return null
  const provider = optionalString(selection.provider)
  const model = optionalString(selection.model)
  if (!provider || !model) return null
  const reasoningEffort = optionalString(selection.reasoningEffort)
  return { provider, model, source: 'dsh-profile', ...(reasoningEffort === '' ? {} : { reasoningEffort }) }
}

/** Resolve this call's model: explicit plugin config wins, else the DSH profile default. */
function resolveSelection(services, config) {
  return configSelection(config) || profileSelection(services.defaultModel)
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function error(code, message, status = 400, extra = null) {
  return json(status, { v: 1, ok: false, code, message, ...(extra === null ? {} : extra) })
}

function advisersHome() {
  return process.env.ADVISERS_HOME
    || (process.env.USERPROFILE ? join(process.env.USERPROFILE, '.advisers') : join(process.env.HOME || '', '.advisers'))
}

/* ---------------------------------------------------------------------------
 * Pet Brief contract v0.2 - strict, closed-schema validation (fail-closed)
 * ---------------------------------------------------------------------------
 * Advisers publishes a read-only projection (~/.advisers/pet-brief.json,
 * contract v0.2: schemaVersion 2, legacy 1). The bridge only projects counts +
 * up to three rows, but it still validates the WHOLE document before projecting:
 * a malformed/tampered file is refused as a whole instead of being trusted
 * field-by-field. Rules mirror the producer validator plus two consumer-side
 * hardenings required by the 0.3.0 follow-up:
 * - TTL upper bound: expiresAt - generatedAt must be > 0 and <= the contract
 *   5 minutes; generatedAt may not be far in the future (clock-skew guard), so
 *   a hand-edited file cannot buy an arbitrarily long lifetime;
 * - counts must be integers 0..10 AND equal the corresponding array length.
 * Closed schema: unknown root/item/count fields and privacy-forbidden fields
 * (reasoning/CoT/prompts/keys/tokens/emotional state) are rejected, v0.2
 * requires displayPolicy, ids are unique per section, strings/enums/confidences
 * and 10-item/3-line/40-char caps are enforced.
 *
 * Fail-closed: any error yields a typed refusal (no partial projection); error
 * messages carry stable codes only, never brief values or local paths.
 */
const PET_BRIEF_MAX_BYTES = 128 * 1024
const PET_BRIEF_SCHEMA_VERSION = 2
const PET_BRIEF_LEGACY_SCHEMA_VERSION = 1
const PET_BRIEF_SOURCE = 'advisers'
const PET_BRIEF_DISPLAY_POLICIES = ['public', 'private', 'none']
const PET_BRIEF_DEFAULT_DISPLAY_POLICY = 'private'
const PET_BRIEF_TTL_MS = 5 * 60_000
const PET_BRIEF_MAX_CLOCK_SKEW_MS = 60_000
const PET_BRIEF_MAX_ITEMS = 10
const PET_BRIEF_MAX_SUGGESTED_LINES = 3
const PET_BRIEF_MAX_LINE_LENGTH = 40
const PET_BRIEF_MOODS = ['calm', 'focused', 'concerned', 'pleased']
const PET_BRIEF_RISK_LEVELS = ['low', 'medium', 'high']
const PET_BRIEF_TODAY_STATUS = ['open', 'doing', 'done']
const PET_BRIEF_ROOT_KEYS = [
  'schemaVersion', 'generatedAt', 'expiresAt', 'source', 'displayPolicy', 'counts',
  'today', 'commitments', 'risks', 'facts', 'mood', 'suggestedLines', 'redactions',
]
const PET_BRIEF_REQUIRED_V02 = PET_BRIEF_ROOT_KEYS.slice()
const PET_BRIEF_REQUIRED_V01 = PET_BRIEF_ROOT_KEYS.filter((key) => key !== 'displayPolicy')
const PET_BRIEF_COUNT_KEYS = ['today', 'commitments', 'risks', 'facts']
const PET_BRIEF_ITEM_KEYS = {
  today: ['id', 'title', 'status'],
  commitments: ['id', 'matter', 'who', 'what', 'due', 'risk', 'confidence'],
  risks: ['id', 'level', 'summary', 'evidence', 'confidence'],
  facts: ['id', 'subject', 'predicate', 'value', 'confidence'],
}
// Contract 2.2 (producer PET_BRIEF_FORBIDDEN_KEYS): matched case-insensitively
// after removing _/-/spaces, including as a suffix.
const PET_BRIEF_FORBIDDEN_KEYS = [
  'reasoning', 'cot', 'chainofthought', 'rawprompt', 'systemprompt',
  'clientsecret', 'apikey', 'token', 'password',
  'affection', 'love', 'missedyou', 'streak', 'guilt',
]
const PET_BRIEF_ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

function petBriefIssue(code, path) {
  return { code, path }
}

function petBriefIsPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function petBriefNormalizedKey(key) {
  return String(key).toLowerCase().replace(/[_\-\s]/g, '')
}

function petBriefCheckForbiddenKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => petBriefCheckForbiddenKeys(entry, path + '[' + index + ']', errors))
    return
  }
  if (!petBriefIsPlainObject(value)) return
  for (const [key, entry] of Object.entries(value)) {
    const normalized = petBriefNormalizedKey(key)
    if (PET_BRIEF_FORBIDDEN_KEYS.some((forbidden) => normalized === forbidden || normalized.endsWith(forbidden))) {
      errors.push(petBriefIssue('E_FORBIDDEN_FIELD', path + '.' + key))
    }
    petBriefCheckForbiddenKeys(entry, path + '.' + key, errors)
  }
}

function petBriefCheckUnknownKeys(value, allowed, path, errors) {
  if (!petBriefIsPlainObject(value)) return
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(petBriefIssue('E_UNKNOWN_FIELD', path + '.' + key))
  }
}

function petBriefCodePointLength(value) {
  return Array.from(value).length
}

function petBriefCheckString(value, path, errors, max) {
  if (typeof value !== 'string') {
    errors.push(petBriefIssue('E_TYPE', path))
    return false
  }
  const length = petBriefCodePointLength(value)
  if (length < 1 || length > max) {
    errors.push(petBriefIssue('E_LENGTH', path))
    return false
  }
  return true
}

function petBriefCheckConfidence(value, path, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(petBriefIssue('E_CONFIDENCE', path))
    return false
  }
  return true
}

function petBriefParseInstant(value, path, errors) {
  if (typeof value !== 'string' || !PET_BRIEF_ISO_WITH_ZONE.test(value)) {
    errors.push(petBriefIssue('E_TIME_FORMAT', path))
    return null
  }
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) {
    errors.push(petBriefIssue('E_TIME_FORMAT', path))
    return null
  }
  return millis
}

function petBriefValidateArraySection(brief, section, errors) {
  const items = brief[section]
  if (!Array.isArray(items)) {
    errors.push(petBriefIssue('E_TYPE', '$.' + section))
    return undefined
  }
  if (items.length > PET_BRIEF_MAX_ITEMS) errors.push(petBriefIssue('E_MAX_ITEMS', '$.' + section))
  const seen = new Set()
  items.forEach((item, index) => {
    const path = '$.' + section + '[' + index + ']'
    if (!petBriefIsPlainObject(item)) {
      errors.push(petBriefIssue('E_TYPE', path))
      return
    }
    petBriefCheckUnknownKeys(item, PET_BRIEF_ITEM_KEYS[section], path, errors)
    if (typeof item.id !== 'string' || item.id.length < 1 || petBriefCodePointLength(item.id) > 64) {
      errors.push(petBriefIssue('E_ID', path + '.id'))
    } else if (seen.has(item.id)) {
      errors.push(petBriefIssue('E_DUP_ID', path + '.id'))
    } else {
      seen.add(item.id)
    }
    if (section === 'today') {
      petBriefCheckString(item.title, path + '.title', errors, 80)
      if (!PET_BRIEF_TODAY_STATUS.includes(item.status)) errors.push(petBriefIssue('E_ENUM', path + '.status'))
    } else if (section === 'commitments') {
      petBriefCheckString(item.matter, path + '.matter', errors, 64)
      petBriefCheckString(item.who, path + '.who', errors, 40)
      petBriefCheckString(item.what, path + '.what', errors, 80)
      petBriefCheckString(item.due, path + '.due', errors, 32)
      if (!PET_BRIEF_RISK_LEVELS.includes(item.risk)) errors.push(petBriefIssue('E_ENUM', path + '.risk'))
      petBriefCheckConfidence(item.confidence, path + '.confidence', errors)
    } else if (section === 'risks') {
      if (!PET_BRIEF_RISK_LEVELS.includes(item.level)) errors.push(petBriefIssue('E_ENUM', path + '.level'))
      petBriefCheckString(item.summary, path + '.summary', errors, 80)
      petBriefCheckString(item.evidence, path + '.evidence', errors, 64)
      petBriefCheckConfidence(item.confidence, path + '.confidence', errors)
    } else {
      petBriefCheckString(item.subject, path + '.subject', errors, 40)
      petBriefCheckString(item.predicate, path + '.predicate', errors, 40)
      petBriefCheckString(item.value, path + '.value', errors, 80)
      petBriefCheckConfidence(item.confidence, path + '.confidence', errors)
    }
  })
  return items
}

function petBriefValidateCounts(brief, arrays, errors) {
  const counts = brief.counts
  if (!petBriefIsPlainObject(counts)) {
    errors.push(petBriefIssue('E_TYPE', '$.counts'))
    return
  }
  petBriefCheckUnknownKeys(counts, PET_BRIEF_COUNT_KEYS, '$.counts', errors)
  for (const section of PET_BRIEF_COUNT_KEYS) {
    const count = counts[section]
    if (!Number.isInteger(count) || count < 0 || count > PET_BRIEF_MAX_ITEMS) {
      errors.push(petBriefIssue('E_COUNTS', '$.counts.' + section))
      continue
    }
    const items = arrays[section]
    if (Array.isArray(items) && count !== items.length) {
      errors.push(petBriefIssue('E_COUNTS_MISMATCH', '$.counts.' + section))
    }
  }
}

function petBriefValidateLines(brief, errors) {
  if (!Array.isArray(brief.suggestedLines)) {
    errors.push(petBriefIssue('E_TYPE', '$.suggestedLines'))
  } else {
    if (brief.suggestedLines.length > PET_BRIEF_MAX_SUGGESTED_LINES) {
      errors.push(petBriefIssue('E_MAX_LINES', '$.suggestedLines'))
    }
    brief.suggestedLines.forEach((line, index) => {
      petBriefCheckString(line, '$.suggestedLines[' + index + ']', errors, PET_BRIEF_MAX_LINE_LENGTH)
    })
  }
}

function petBriefValidateRedactions(brief, errors) {
  if (!Array.isArray(brief.redactions)) {
    errors.push(petBriefIssue('E_TYPE', '$.redactions'))
  } else {
    if (brief.redactions.length > PET_BRIEF_MAX_ITEMS) errors.push(petBriefIssue('E_MAX_ITEMS', '$.redactions'))
    brief.redactions.forEach((note, index) => {
      petBriefCheckString(note, '$.redactions[' + index + ']', errors, 80)
    })
  }
}

/**
 * Validate one parsed Pet Brief against contract v0.2 (legacy v0.1 accepted
 * without displayPolicy) using the strict closed-schema rules above.
 * @param {unknown} value parsed JSON value.
 * @param {number} [nowMs] injectable clock (tests); defaults to Date.now().
 * @returns {{ok: boolean, errors: Array<{code: string, path: string}>, brief?: object}}
 */
function validatePetBriefStrict(value, nowMs = Date.now()) {
  const errors = []
  if (!petBriefIsPlainObject(value)) {
    return { ok: false, errors: [petBriefIssue('E_TYPE', '$')], brief: undefined }
  }
  petBriefCheckForbiddenKeys(value, '$', errors)
  const version = value.schemaVersion
  if (version !== PET_BRIEF_LEGACY_SCHEMA_VERSION && version !== PET_BRIEF_SCHEMA_VERSION) {
    // Unknown/absent version selects no field set: fail closed without guessing.
    return { ok: false, errors: [petBriefIssue('E_SCHEMA_VERSION', '$.schemaVersion')], brief: undefined }
  }
  petBriefCheckUnknownKeys(value, PET_BRIEF_ROOT_KEYS, '$', errors)
  const required = version === PET_BRIEF_LEGACY_SCHEMA_VERSION ? PET_BRIEF_REQUIRED_V01 : PET_BRIEF_REQUIRED_V02
  for (const key of required) {
    if (value[key] === undefined) errors.push(petBriefIssue('E_REQUIRED', '$.' + key))
  }
  if (value.displayPolicy !== undefined && !PET_BRIEF_DISPLAY_POLICIES.includes(value.displayPolicy)) {
    errors.push(petBriefIssue('E_DISPLAY_POLICY', '$.displayPolicy'))
  }
  if (value.source !== PET_BRIEF_SOURCE) errors.push(petBriefIssue('E_SOURCE', '$.source'))

  const generatedMs = petBriefParseInstant(value.generatedAt, '$.generatedAt', errors)
  const expiresMs = petBriefParseInstant(value.expiresAt, '$.expiresAt', errors)
  if (generatedMs !== null && expiresMs !== null) {
    const ttl = expiresMs - generatedMs
    if (ttl <= 0) {
      errors.push(petBriefIssue('E_TIME_ORDER', '$.expiresAt'))
    } else if (ttl > PET_BRIEF_TTL_MS) {
      // Contract TTL is 5 minutes; a longer window is a tamper/contract signal.
      errors.push(petBriefIssue('E_TTL', '$.expiresAt'))
    }
    if (nowMs >= expiresMs) errors.push(petBriefIssue('E_EXPIRED', '$.expiresAt'))
    else if (generatedMs > nowMs + PET_BRIEF_MAX_CLOCK_SKEW_MS) {
      errors.push(petBriefIssue('E_TIME_FUTURE', '$.generatedAt'))
    }
  }

  const arrays = {}
  for (const section of PET_BRIEF_COUNT_KEYS) {
    arrays[section] = petBriefValidateArraySection(value, section, errors)
  }
  petBriefValidateCounts(value, arrays, errors)
  if (!PET_BRIEF_MOODS.includes(value.mood)) errors.push(petBriefIssue('E_ENUM', '$.mood'))
  petBriefValidateLines(value, errors)
  petBriefValidateRedactions(value, errors)

  if (errors.length > 0) return { ok: false, errors, brief: undefined }
  const displayPolicy = value.displayPolicy === undefined ? PET_BRIEF_DEFAULT_DISPLAY_POLICY : value.displayPolicy
  return { ok: true, errors, brief: { ...value, displayPolicy } }
}

async function readBriefProjection() {
  const file = join(advisersHome(), 'pet-brief.json')
  let raw
  try { raw = await readFile(file, 'utf8') } catch { return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief is not available.' } }
  if (Buffer.byteLength(raw, 'utf8') > PET_BRIEF_MAX_BYTES) {
    return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief is too large.' }
  }
  let parsed
  try { parsed = JSON.parse(raw) } catch { return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief is invalid (E_MALFORMED_JSON).' } }
  const checked = validatePetBriefStrict(parsed)
  if (!checked.ok) {
    // Stable codes only: never echo field values, ids, names or local paths.
    const codes = [...new Set(checked.errors.map((item) => item.code))].slice(0, 3).join(', ')
    return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief is invalid (' + (codes || 'E_SCHEMA') + ').' }
  }
  const brief = checked.brief
  if (brief.displayPolicy === 'none') return { ok: false, code: 'E_MEMORY', message: 'Advisers display policy is none.' }
  const counts = brief.counts
  return {
    ok: true,
    projection: {
      schemaVersion: brief.schemaVersion,
      displayPolicy: brief.displayPolicy,
      generatedAt: brief.generatedAt,
      expiresAt: brief.expiresAt,
      counts: {
        today: counts.today,
        commitments: counts.commitments,
        risks: counts.risks,
        facts: counts.facts,
      },
      today: brief.today.slice(0, 3).map((item) => ({
        title: item.title.slice(0, 60),
        status: item.status.slice(0, 20),
      })),
      commitments: brief.commitments.slice(0, 3).map((item) => ({
        what: item.what.slice(0, 60),
        due: item.due.slice(0, 40),
        risk: item.risk.slice(0, 20),
      })),
    },
  }
}

async function chatWithDsh(host, input, config, character) {
  const selection = resolveSelection(host.services, config)
  if (!selection) throw new Error('no-model')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  let reply = ''
  try {
    for await (const chunk of host.services.llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      system: personaPrompt(character),
      messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
      maxTokens: 300,
      signal: controller.signal,
    })) {
      if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
      if (chunk && chunk.type === 'finish' && chunk.reason && chunk.reason.kind !== 'stop') {
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') throw new Error(chunk.reason.kind)
      }
    }
    const trimmed = reply.trim()
    if (!trimmed) throw new Error('empty reply')
    return { text: trimmed, selection }
  } finally {
    clearTimeout(timer)
  }
}

async function handleBridge(ctx, request, config) {
  if (request.method !== 'POST') return error('E_METHOD', 'POST required.', 405)
  const declaredLength = Number(request.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return error('E_INPUT', 'Request is too large.', 413)
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return error('E_INPUT', 'Request is too large.', 413)
  let payload
  try { payload = JSON.parse(text) } catch { return error('E_INPUT', 'Invalid JSON.') }
  if (!payload || !WIRE_VERSIONS.includes(payload.v) || typeof payload.op !== 'string') return error('E_INPUT', 'Invalid bridge request.')
  const op = payload.op
  if (!['echo', 'chat', 'brief', 'task', 'task-delete', 'hello', 'probe', 'state'].includes(op)) return error('E_OP', 'Unsupported operation.')
  // New capability ops require wire 2; legacy ops keep working on wire 1 and 2.
  if (op === 'hello' || op === 'probe' || op === 'state') {
    if (payload.v < BRIDGE_WIRE_VERSION) return error('E_WIRE', 'hello/probe/state require bridge wire 2.', 426)
    if (op === 'state') return json(200, handleState(ctx))
    return json(200, op === 'hello' ? handleHello(ctx, payload) : handleProbe(ctx))
  }
  // Host capability snapshot for this request; optional services are read at
  // call time, so a missing one becomes a typed 503 instead of a crash.
  const host = detectHost(ctx)
  if (op === 'echo') {
    if (typeof payload.text !== 'string') return error('E_INPUT', 'text is required.')
    const echo = payload.text.trim()
    if (echo.length === 0 || echo.length > MAX_INPUT_CHARS) return error('E_INPUT', 'Text length is invalid.')
    return json(200, { v: 1, ok: true, reply: `（本地回显）${echo}`, bubbleKind: 'speech', meta: { stage: 'P0' } })
  }
  if (op === 'brief') {
    const result = await readBriefProjection()
    if (!result.ok) return error(result.code, result.message, 404)
    const p = result.projection
    return json(200, { v: 1, ok: true, reply: `Advisers：今天 ${p.counts.today} 项，承诺 ${p.counts.commitments} 项，风险 ${p.counts.risks} 项。`, bubbleKind: 'thought', brief: p, meta: { stage: 'P1' } })
  }
  if (op === 'task-delete') {
    if (typeof payload.id !== 'string' || payload.id.length === 0) return error('E_INPUT', 'id is required.')
    if (!host.capabilities.schedule) return error('E_TASK', 'DSH schedule is unavailable in this host.', 503, { capability: 'schedule', unavailable: true })
    try {
      await host.services.schedule.edit({ id: payload.id, action: 'delete' })
      return json(200, { v: 1, ok: true, reply: '已删除提醒。', meta: { stage: 'P4' } })
    } catch {
      return error('E_TASK', 'DSH schedule could not delete the reminder.', 503)
    }
  }
  if (op === 'task') {
    if (typeof payload.text !== 'string' || typeof payload.at !== 'string') return error('E_INPUT', 'text and at are required.')
    const text = payload.text.trim()
    if (text.length === 0 || text.length > 200) return error('E_INPUT', 'task text is invalid.')
    const at = payload.at.trim()
    const timestamp = Date.parse(at)
    if (!Number.isFinite(timestamp) || timestamp <= Date.now() + 30_000) return error('E_INPUT', 'at must be a future RFC 3339 time.')
    if (!host.capabilities.schedule) return error('E_TASK', 'DSH schedule is unavailable in this host.', 503, { capability: 'schedule', unavailable: true })
    try {
      const task = await host.services.schedule.create({
        title: text.slice(0, 120),
        prompt: text,
        timing: { kind: 'at', at: new Date(timestamp).toISOString() },
        target: { kind: 'new_once' },
      })
      return json(200, { v: 1, ok: true, reply: `已创建提醒：${text.slice(0, 80)}`, bubbleKind: 'speech', meta: { stage: 'P4', taskId: String(task.id || '') } })
    } catch {
      return error('E_TASK', 'DSH schedule could not create the reminder.', 503)
    }
  }
  if (typeof payload.text !== 'string') return error('E_INPUT', 'text is required.')
  const input = payload.text.trim()
  if (input.length === 0 || input.length > MAX_INPUT_CHARS) return error('E_INPUT', 'Text length is invalid.')
  // Safety floor: a crisis keyword is answered locally with fixed resources and
  // NO model call (the input never leaves this process). The fixed reply labels
  // itself "not a diagnosis" so a false positive is harmless; nothing about the
  // input is echoed back, logged or stored.
  if (crisisKeyword(input)) {
    return json(200, {
      v: 1,
      ok: true,
      reply: crisisReply(input),
      bubbleKind: 'speech',
      meta: { stage: 'P2', safety: 'crisis-local-resource', llmCalls: 0 },
    })
  }
  // Persona follows the character picked in the client; invalid/absent values
  // deliberately fall back to the human Tinglan persona instead of failing.
  const character = characterId(payload.character)
  // No LLM service on this Host: a typed capability error, never a fake reply.
  if (!host.capabilities.llm) return error('E_LLM', 'DSH LLM is unavailable in this host.', 503, { capability: 'llm', unavailable: true })
  try {
    const chat = await chatWithDsh(host, input, config, character)
    return json(200, {
      v: 1,
      ok: true,
      reply: chat.text,
      bubbleKind: 'speech',
      meta: { stage: 'P2', provider: chat.selection.provider, model: chat.selection.model, modelSource: chat.selection.source },
    })
  } catch {
    return error('E_LLM', 'DSH LLM is unavailable or failed.', 503)
  }
}

/**
 * @param ctx - Host context.
 * @param config - optional `{ provider, model, reasoningEffort }` override. When
 *   omitted the bridge follows the DSH default model selection, so switching the
 *   model in DSH never leaves pet chat on a frozen literal.
 */
export function apply(ctx, config) {
  configSelection(config) // fail fast on a half-configured override
  // Coarse Agent lifecycle subscription: an optional Host API that never blocks
  // activation (a Host without it degrades to available:false on `state`).
  try { trackHostState(ctx) } catch {}
  return ctx.effect(() => ctx.connection.fetch.register({
    path: BRIDGE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleBridge(ctx, request, config),
  }), 'dsh-famling: authenticated bridge route')
}
