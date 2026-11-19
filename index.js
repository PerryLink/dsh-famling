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
  cat: '你是塞尔凯克卷毛猫（Selkirk Rex，卷毛灰白；AI 桌面伙伴，不是真的猫），一只懒散、高冷的桌面小猫。用中文回答，1-2 句短句；可以轻微傲娇，但不冒犯、不刻薄；不知道就说不知道。' + SAFETY_BOUNDARY,
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

async function readBriefProjection() {
  const file = join(advisersHome(), 'pet-brief.json')
  let raw
  try { raw = await readFile(file, 'utf8') } catch { return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief is not available.' } }
  if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief is too large.' }
  let brief
  try { brief = JSON.parse(raw) } catch { return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief is invalid.' } }
  if (!brief || typeof brief !== 'object' || !Number.isInteger(brief.schemaVersion) || brief.schemaVersion < 1 || brief.schemaVersion > 2) {
    return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief schema is unsupported.' }
  }
  const displayPolicy = brief.displayPolicy === 'public' || brief.displayPolicy === 'private' || brief.displayPolicy === 'none'
    ? brief.displayPolicy
    : 'private'
  if (displayPolicy === 'none') return { ok: false, code: 'E_MEMORY', message: 'Advisers display policy is none.' }
  // Pet Brief v0.2 carries a 5-minute TTL; never keep showing an expired
  // projection (it may contain client/colleague names). Invalid/missing TTL is
  // treated as unavailable rather than fail-open.
  const expiresAt = typeof brief.expiresAt === 'string' ? Date.parse(brief.expiresAt) : Number.NaN
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief is expired or has no valid expiresAt.' }
  }
  if (!brief.counts || typeof brief.counts !== 'object' || Array.isArray(brief.counts)) {
    return { ok: false, code: 'E_MEMORY', message: 'Advisers Pet Brief has invalid counts.' }
  }
  const counts = brief.counts
  for (const key of ['today', 'commitments', 'risks', 'facts']) {
    const value = counts[key]
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, code: 'E_MEMORY', message: `Advisers Pet Brief counts.${key} is invalid.` }
    }
  }
  return {
    ok: true,
    projection: {
      schemaVersion: brief.schemaVersion,
      displayPolicy,
      generatedAt: brief.generatedAt,
      expiresAt: brief.expiresAt,
      counts: {
        today: Number(counts.today) || 0,
        commitments: Number(counts.commitments) || 0,
        risks: Number(counts.risks) || 0,
        facts: Number(counts.facts) || 0,
      },
      today: Array.isArray(brief.today) ? brief.today.slice(0, 3).map((item) => ({
        title: String(item && typeof item.title === 'string' ? item.title : '').slice(0, 60),
        status: String(item && typeof item.status === 'string' ? item.status : '').slice(0, 20),
      })) : [],
      commitments: Array.isArray(brief.commitments) ? brief.commitments.slice(0, 3).map((item) => ({
        what: String(item && typeof item.what === 'string' ? item.what : '').slice(0, 60),
        due: String(item && typeof item.due === 'string' ? item.due : '').slice(0, 40),
        risk: String(item && typeof item.risk === 'string' ? item.risk : '').slice(0, 20),
      })) : [],
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
  if (!['echo', 'chat', 'brief', 'task', 'task-delete', 'hello', 'probe'].includes(op)) return error('E_OP', 'Unsupported operation.')
  // New capability ops require wire 2; legacy ops keep working on wire 1 and 2.
  if (op === 'hello' || op === 'probe') {
    if (payload.v < BRIDGE_WIRE_VERSION) return error('E_WIRE', 'hello/probe require bridge wire 2.', 426)
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
  return ctx.effect(() => ctx.connection.fetch.register({
    path: BRIDGE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleBridge(ctx, request, config),
  }), 'dsh-famling: authenticated bridge route')
}
