/** Host half of dsh-famling: a small authenticated bridge for the pet input panel.
 *
 * P0 only: validate the request and echo text back. No LLM/TTS/ASR/credentials
 * are read here yet; those are separate, reviewed stages (see docs/DSH-FAMLING-BRIDGE).
 * The route is exact and below /api, so the DSH connection trust policy only
 * admits owner Peers and browser same-origin Cookie auth.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'dsh-famling'
export const inject = ['connection', 'llm', 'schedule']

const MAX_INPUT_CHARS = 2000
const MAX_BODY_BYTES = 16 * 1024
const BRIDGE_PATH = '/api/famling/bridge'
const LLM_PROVIDER = 'deepseek-official'
const LLM_MODEL = 'deepseek-flash'
const LLM_TIMEOUT_MS = 25_000
const SYSTEM_PROMPT = '你是汀岚，一只安静、简洁的桌面小生灵。用中文回答，1-3 句；不知道就说不知道。不要声称自己是真人、官方或专业顾问；不要诱导依赖、恋爱、付费或未成年人情感关系；不输出违法、隐私或冒充内容。'

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

async function chatWithDsh(ctx, input) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  let reply = ''
  try {
    for await (const chunk of ctx.llm.stream({
      provider: LLM_PROVIDER,
      model: LLM_MODEL,
      system: SYSTEM_PROMPT,
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
    return trimmed
  } finally {
    clearTimeout(timer)
  }
}

async function handleBridge(ctx, request) {
  if (request.method !== 'POST') return error('E_METHOD', 'POST required.', 405)
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return error('E_INPUT', 'Request is too large.', 413)
  let payload
  try { payload = JSON.parse(text) } catch { return error('E_INPUT', 'Invalid JSON.') }
  if (!payload || payload.v !== 1 || typeof payload.op !== 'string') return error('E_INPUT', 'Invalid bridge request.')
  const op = payload.op
  if (op !== 'echo' && op !== 'chat' && op !== 'brief' && op !== 'task' && op !== 'task-delete') return error('E_OP', 'Unsupported operation.')
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
  try {
    const reply = await chatWithDsh(ctx, input)
    return json(200, { v: 1, ok: true, reply, bubbleKind: 'speech', meta: { stage: 'P2', provider: LLM_PROVIDER, model: LLM_MODEL } })
  } catch {
    return error('E_LLM', 'DSH LLM is unavailable or failed.', 503)
  }
}

export function apply(ctx) {
  return ctx.effect(() => ctx.connection.fetch.register({
    path: BRIDGE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleBridge(ctx, request),
  }), 'dsh-famling: P0 bridge route')
}
