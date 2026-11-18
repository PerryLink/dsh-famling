/** Host half of dsh-famling: authenticated bridge for the pet input panel.
 *
 * Stages: P0 echo, P1 Advisers Pet Brief projection, P2 DSH LLM chat,
 * P4 DSH schedule create/delete. No TTS/ASR service is called here; the
 * browser owns those. The exact /api route admits owner Peers and uses the
 * same-origin Cookie; no DSH key ever enters the client.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'dsh-famling'
export const inject = ['connection', 'llm', 'schedule']

const MAX_INPUT_CHARS = 2000
const MAX_BODY_BYTES = 16 * 1024
const BRIDGE_PATH = '/api/famling/bridge'
const LLM_TIMEOUT_MS = 25_000
const CHARACTER_IDS = ['human', 'cat', 'dog']
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

/**
 * Read the current DSH default model selection (the profile setting / model
 * picker) from the Host. This is the normal source: pet chat must follow the
 * model the user configured in DSH, never a frozen provider/model literal.
 * @returns the profile selection, or null when the service is unavailable.
 */
function profileSelection(ctx) {
  const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
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
function resolveSelection(ctx, config) {
  return configSelection(config) || profileSelection(ctx)
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function error(code, message, status = 400) {
  return json(status, { v: 1, ok: false, code, message })
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
  if (brief.displayPolicy === 'none') return { ok: false, code: 'E_MEMORY', message: 'Advisers display policy is none.' }
  const counts = brief.counts && typeof brief.counts === 'object' ? brief.counts : {}
  return {
    ok: true,
    projection: {
      schemaVersion: brief.schemaVersion,
      displayPolicy: brief.displayPolicy || 'private',
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

async function chatWithDsh(ctx, input, config, character) {
  const selection = resolveSelection(ctx, config)
  if (!selection) throw new Error('no-model')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  let reply = ''
  try {
    for await (const chunk of ctx.llm.stream({
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
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return error('E_INPUT', 'Request is too large.', 413)
  let payload
  try { payload = JSON.parse(text) } catch { return error('E_INPUT', 'Invalid JSON.') }
  if (!payload || payload.v !== 1 || typeof payload.op !== 'string') return error('E_INPUT', 'Invalid bridge request.')
  const op = payload.op
  if (op !== 'echo' && op !== 'chat' && op !== 'brief' && op !== 'task' && op !== 'task-delete') return error('E_OP', 'Unsupported operation.')
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
    try {
      await ctx.schedule.edit({ id: payload.id, action: 'delete' })
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
    try {
      const task = await ctx.schedule.create({
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
  // Persona follows the character picked in the client; invalid/absent values
  // deliberately fall back to the human Tinglan persona instead of failing.
  const character = characterId(payload.character)
  try {
    const chat = await chatWithDsh(ctx, input, config, character)
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
