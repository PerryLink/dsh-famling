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
export const inject = ['connection']

const MAX_INPUT_CHARS = 2000
const MAX_BODY_BYTES = 16 * 1024
const BRIDGE_PATH = '/api/famling/bridge'

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
    },
  }
}

async function handleBridge(request) {
  if (request.method !== 'POST') return error('E_METHOD', 'POST required.', 405)
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return error('E_INPUT', 'Request is too large.', 413)
  let payload
  try { payload = JSON.parse(text) } catch { return error('E_INPUT', 'Invalid JSON.') }
  if (!payload || payload.v !== 1 || typeof payload.op !== 'string') return error('E_INPUT', 'Invalid bridge request.')
  const op = payload.op
  if (op !== 'echo' && op !== 'chat' && op !== 'brief') return error('E_OP', 'Unsupported operation.')
  if (op === 'brief') {
    const result = await readBriefProjection()
    if (!result.ok) return error(result.code, result.message, 404)
    const p = result.projection
    return json(200, { v: 1, ok: true, reply: `Advisers：今天 ${p.counts.today} 项，承诺 ${p.counts.commitments} 项，风险 ${p.counts.risks} 项。`, bubbleKind: 'thought', brief: p, meta: { stage: 'P1' } })
  }
  if (typeof payload.text !== 'string') return error('E_INPUT', 'text is required.')
  const input = payload.text.trim()
  if (input.length === 0 || input.length > MAX_INPUT_CHARS) return error('E_INPUT', 'Text length is invalid.')
  // P0 deliberately does not call a model. The reply labels itself as local echo.
  return json(200, { v: 1, ok: true, reply: `（本地回显）${input}`, bubbleKind: 'speech', meta: { stage: 'P0' } })
}

export function apply(ctx) {
  return ctx.effect(() => ctx.connection.fetch.register({
    path: BRIDGE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: handleBridge,
  }), 'dsh-famling: P0 bridge route')
}
