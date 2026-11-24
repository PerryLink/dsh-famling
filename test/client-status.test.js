/**
 * P0 host work-state kit tests: the client half exposes the optional
 * `workState` / `workSince` fields of the bridge `state` reply on its handle,
 * defaults an older Host to idle/null and rejects malformed values fail-closed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const STATUS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'client.status.js')

/**
 * Evaluate the lazy chunk with a fake module-table registration and fake
 * timers: the chunk factory runs in a vm realm, so tests compare fields only.
 */
function loadStatusKit() {
  const timers = new Map()
  let nextTimer = 1
  let registration = null
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    setTimeout(fn, delay) { const id = nextTimer; nextTimer += 1; timers.set(id, { fn, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  sandbox.globalThis = sandbox
  createContext(sandbox)
  runInContext(readFileSync(STATUS_PATH, 'utf8'), sandbox, { filename: STATUS_PATH })
  assert.ok(registration && typeof registration.factory === 'function', 'the chunk registers a module factory')
  const exports = registration.factory(() => { throw new Error('the host-status kit must not require modules') })
  return { exports, timers }
}

/** Let the chunk's cross-realm promise callbacks settle. */
async function flush() { for (let tick = 0; tick < 3; tick += 1) await new Promise((resolve) => setImmediate(resolve)) }

/** Force the watcher to poll now through the visibility hook. */
function trigger(handle) { handle.refresh(false); handle.refresh(true) }

/** A Host reply in the shape a 0.13.2 Host sends (no workState/workSince). */
function oldReport() {
  return { v: 2, ok: true, op: 'state', available: true, source: 'events', state: 'idle', active: 0, updatedAt: 9, lastError: null, transitions: [{ state: 'idle', at: 9 }] }
}

/** A Host reply with the optional P0 work-state fields patched in. */
function report(extra = {}) {
  return { v: 2, ok: true, op: 'state', available: true, source: 'events', state: 'running', active: 1, updatedAt: 5, lastError: null, transitions: [{ state: 'running', at: 5 }], ...extra }
}

test('readStateReport parses the optional work state and defaults an old Host to idle', () => {
  const { readStateReport } = loadStatusKit().exports
  const reading = readStateReport(report({ workState: 'working', workSince: 5 }))
  assert.equal(reading.available, true)
  assert.equal(reading.state, 'running')
  assert.equal(reading.workState, 'working')
  assert.equal(reading.workSince, 5)
  // Older Host: the fields are absent -> idle/null, never a guessed busy state.
  const legacy = readStateReport(oldReport())
  assert.equal(legacy.available, true)
  assert.equal(legacy.workState, 'idle')
  assert.equal(legacy.workSince, null)
  // success/error pass through; idle has no meaningful start stamp.
  assert.equal(readStateReport(report({ state: 'idle', active: 0, workState: 'success', workSince: 9 })).workState, 'success')
  assert.equal(readStateReport(report({ state: 'idle', active: 0, workState: 'error', workSince: 9 })).workSince, 9)
  const idleStamp = readStateReport(report({ state: 'idle', active: 0, workState: 'idle', workSince: 9 }))
  assert.equal(idleStamp.workState, 'idle')
  assert.equal(idleStamp.workSince, null)
  // Unsupported Host: reported as unavailable, no work state is invented.
  const unsupported = readStateReport({ v: 2, ok: true, op: 'state', available: false, source: 'unsupported', state: 'unknown', active: 0, updatedAt: null, lastError: null, transitions: [] })
  assert.equal(unsupported.available, false)
})

test('the host-status reader rejects malformed work-state fields fail-closed', () => {
  const { readStateReport } = loadStatusKit().exports
  const malformed = [
    { workState: 'busy' }, { workState: '' }, { workState: null }, { workState: 42 }, { workState: ['working'] },
    { workState: 'working', workSince: -1 }, { workState: 'working', workSince: 1.5 }, { workState: 'working', workSince: '5' },
    { workState: 'error', workSince: -100 }, { workSince: -2 },
  ]
  for (const patch of malformed) assert.equal(readStateReport(report(patch)), null, 'fail-closed: ' + JSON.stringify(patch))
  // The pre-existing malformed families keep failing too.
  for (const patch of [{ state: 'busy' }, { active: '1' }, { lastError: { kind: 'weird', at: 1 } }, { transitions: [{ state: 'busy', at: 1 }] }]) {
    assert.equal(readStateReport(report(patch)), null, 'still fail-closed: ' + JSON.stringify(patch))
  }
})

test('watchHostStatus exposes workState/workSince on the handle and keeps busy', async () => {
  const kit = loadStatusKit()
  let reply = { ok: true, result: report({ workState: 'working', workSince: 5 }) }
  const handle = kit.exports.watchHostStatus(() => reply)
  assert.equal(handle.workState, 'idle', 'safe default before the first reply')
  assert.equal(handle.workSince, null)
  assert.equal(handle.busy, false)
  trigger(handle)
  await flush()
  assert.equal(handle.available, true)
  assert.equal(handle.busy, true)
  assert.equal(handle.workState, 'working')
  assert.equal(handle.workSince, 5)
  // An old Host reply drops the extra fields back to idle/null without a crash.
  reply = { ok: true, result: oldReport() }
  trigger(handle)
  await flush()
  assert.equal(handle.busy, false)
  assert.equal(handle.workState, 'idle')
  assert.equal(handle.workSince, null)
  // The derived success/error values pass straight through to the entry.
  reply = { ok: true, result: report({ state: 'idle', active: 0, workState: 'success', workSince: 9 }) }
  trigger(handle)
  await flush()
  assert.equal(handle.workState, 'success')
  assert.equal(handle.workSince, 9)
  handle.stop()
  assert.equal(kit.timers.size, 0, 'stop() clears the pending poll')
})

test('a failed or unsupported reply never leaves a stale work state', async () => {
  const kit = loadStatusKit()
  let reply = { ok: true, result: report({ workState: 'working', workSince: 5 }) }
  const handle = kit.exports.watchHostStatus(() => reply)
  trigger(handle)
  await flush()
  assert.equal(handle.workState, 'working')
  // A failed bridge call fails closed to idle; the silent retry is scheduled.
  reply = { ok: false, code: 'E_INTERNAL' }
  trigger(handle)
  await flush()
  assert.equal(handle.busy, false)
  assert.equal(handle.workState, 'idle')
  assert.equal(handle.workSince, null)
  // An invalid work enum is a malformed report, never silently accepted.
  reply = { ok: true, result: report({ workState: 'busy' }) }
  trigger(handle)
  await flush()
  assert.equal(handle.workState, 'idle')
  // An unsupported Host stops the polling loop and reports unavailable.
  reply = { ok: true, result: { v: 2, ok: true, op: 'state', available: false, source: 'unsupported', state: 'unknown', active: 0, updatedAt: null, lastError: null, transitions: [] } }
  trigger(handle)
  await flush()
  assert.equal(handle.available, false)
  assert.equal(handle.workState, 'idle')
  assert.equal(kit.timers.size, 0, 'unsupported stops polling instead of guessing')
})
