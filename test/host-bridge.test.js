import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply } from '../index.js'

const BRIDGE_PATH = '/api/famling/bridge'

/** Build a fake Host context: real Request/Response, fake llm/schedule/connection. */
function makeContext({ selection = { provider: 'profile-provider', model: 'profile-model' } } = {}) {
  const calls = { llm: [], schedule: [] }
  let registered
  const ctx = {
    effect(fn) { return fn() },
    connection: {
      fetch: {
        register(options) { registered = options; return () => {} },
      },
    },
    llm: {
      stream(options) {
        calls.llm.push(options)
        return (async function* () {
          yield { type: 'text-delta', text: '嗯，' }
          yield { type: 'text-delta', text: '我在。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    schedule: {
      async create(options) { calls.schedule.push(['create', options]); return { id: 'task-1' } },
      async edit(options) { calls.schedule.push(['edit', options]); return {} },
    },
    get(name) {
      if (name === 'agentDefaultModel' && selection) {
        return { currentSelection: () => selection }
      }
      return undefined
    },
  }
  return { ctx, calls, route: () => registered }
}

async function post(route, payload, init = {}) {
  return route.fetch(new Request('http://localhost' + BRIDGE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    ...init,
  }))
}

test('chat follows the DSH profile default model instead of a frozen literal', async () => {
  const env = makeContext()
  apply(env.ctx)
  const res = await post(env.route(), { v: 1, op: 'chat', text: '在吗' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.reply, '嗯，我在。')
  assert.equal(body.meta.stage, 'P2')
  assert.equal(body.meta.provider, 'profile-provider')
  assert.equal(body.meta.model, 'profile-model')
  assert.equal(body.meta.modelSource, 'dsh-profile')
  assert.equal(env.calls.llm.length, 1)
  assert.equal(env.calls.llm[0].provider, 'profile-provider')
  assert.equal(env.calls.llm[0].model, 'profile-model')
  assert.match(env.calls.llm[0].system, /汀岚/)
  assert.equal(env.calls.llm[0].maxTokens, 300)
  assert.equal('reasoningEffort' in env.calls.llm[0], false)
})

test('chat passes the profile reasoning effort through', async () => {
  const env = makeContext({ selection: { provider: 'p', model: 'm', reasoningEffort: 'max' } })
  apply(env.ctx)
  const body = await (await post(env.route(), { v: 1, op: 'chat', text: 'hi' })).json()
  assert.equal(body.meta.modelSource, 'dsh-profile')
  assert.equal(env.calls.llm[0].reasoningEffort, 'max')
})

test('an explicit plugin config overrides the profile selection', async () => {
  const env = makeContext()
  apply(env.ctx, { provider: 'cfg-provider', model: 'cfg-model', reasoningEffort: 'high' })
  const res = await post(env.route(), { v: 1, op: 'chat', text: 'hi' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.meta.provider, 'cfg-provider')
  assert.equal(body.meta.model, 'cfg-model')
  assert.equal(body.meta.modelSource, 'plugin-config')
  assert.equal(env.calls.llm[0].provider, 'cfg-provider')
  assert.equal(env.calls.llm[0].model, 'cfg-model')
  assert.equal(env.calls.llm[0].reasoningEffort, 'high')
})

test('a half-configured override fails at load time', () => {
  const env = makeContext()
  assert.throws(() => apply(env.ctx, { provider: 'only-provider' }), /must be configured together/)
  assert.throws(() => apply(env.ctx, { model: 'only-model' }), /must be configured together/)
  assert.throws(() => apply(env.ctx, 'nope'), /must be an object/)
})

test('chat fails honestly when no model selection exists', async () => {
  const env = makeContext({ selection: null })
  apply(env.ctx)
  const res = await post(env.route(), { v: 1, op: 'chat', text: 'hi' })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'E_LLM')
  assert.equal(env.calls.llm.length, 0)
})

test('echo stays local and never calls the model', async () => {
  const env = makeContext()
  apply(env.ctx)
  const body = await (await post(env.route(), { v: 1, op: 'echo', text: ' 你好 ' })).json()
  assert.equal(body.ok, true)
  assert.equal(body.reply, '（本地回显）你好')
  assert.equal(body.meta.stage, 'P0')
  assert.equal(env.calls.llm.length, 0)
})

test('brief projects a pet-brief file from ADVISERS_HOME without leaking extra fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-famling-brief-'))
  const previous = process.env.ADVISERS_HOME
  process.env.ADVISERS_HOME = dir
  try {
    await writeFile(join(dir, 'pet-brief.json'), JSON.stringify({
      schemaVersion: 2,
      displayPolicy: 'private',
      generatedAt: '2026-11-18T00:00:00Z',
      counts: { today: 2, commitments: 1, risks: 0, facts: 9 },
      today: [{ title: '写交接', status: 'done' }, { title: '跑测试', status: 'todo' }],
      commitments: [{ what: '发布核对', due: '2026-11-18', risk: 'low' }],
      suggestedLines: ['SHOULD NOT LEAK'],
      evidence: ['SHOULD NOT LEAK'],
    }), 'utf8')
    const env = makeContext()
    apply(env.ctx)
    const res = await post(env.route(), { v: 1, op: 'brief' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.meta.stage, 'P1')
    assert.equal(body.brief.counts.today, 2)
    assert.equal(body.brief.today.length, 2)
    assert.equal(body.brief.suggestedLines, undefined)
    assert.equal(body.brief.evidence, undefined)
    assert.match(body.reply, /今天 2 项/)
    assert.equal(env.calls.llm.length, 0)
  } finally {
    if (previous === undefined) delete process.env.ADVISERS_HOME
    else process.env.ADVISERS_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('brief returns 404 when the file is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-famling-nobrief-'))
  const previous = process.env.ADVISERS_HOME
  process.env.ADVISERS_HOME = dir
  try {
    const env = makeContext()
    apply(env.ctx)
    const res = await post(env.route(), { v: 1, op: 'brief' })
    assert.equal(res.status, 404)
    assert.equal((await res.json()).code, 'E_MEMORY')
  } finally {
    if (previous === undefined) delete process.env.ADVISERS_HOME
    else process.env.ADVISERS_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('task validates the time and creates through the Host schedule service', async () => {
  const env = makeContext()
  apply(env.ctx)

  const past = await post(env.route(), { v: 1, op: 'task', text: '过去', at: '2000-01-01T00:00:00Z' })
  assert.equal(past.status, 400)
  assert.equal((await past.json()).code, 'E_INPUT')
  assert.equal(env.calls.schedule.length, 0)

  const at = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const res = await post(env.route(), { v: 1, op: 'task', text: '喝水', at })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.meta.taskId, 'task-1')
  assert.equal(env.calls.schedule.length, 1)
  assert.equal(env.calls.schedule[0][0], 'create')
  assert.equal(env.calls.schedule[0][1].timing.kind, 'at')
  assert.equal(env.calls.schedule[0][1].target.kind, 'new_once')
})

test('task-delete delegates to the Host schedule service', async () => {
  const env = makeContext()
  apply(env.ctx)
  const res = await post(env.route(), { v: 1, op: 'task-delete', id: 'task-9' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).ok, true)
  assert.deepEqual(env.calls.schedule[0], ['edit', { id: 'task-9', action: 'delete' }])
})

test('rejects malformed requests without touching services', async () => {
  const env = makeContext()
  apply(env.ctx)
  const route = env.route()

  assert.equal((await post(route, 'not-json')).status, 400)
  assert.equal((await post(route, { v: 2, op: 'chat', text: 'x' })).status, 400)
  assert.equal((await post(route, { v: 1, op: 'nope' })).status, 400)
  assert.equal((await post(route, { v: 1, op: 'echo', text: '   ' })).status, 400)

  const get = await route.fetch(new Request('http://localhost' + BRIDGE_PATH, { method: 'GET' }))
  assert.equal(get.status, 405)
  assert.equal(env.calls.llm.length, 0)
  assert.equal(env.calls.schedule.length, 0)
})
