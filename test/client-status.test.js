/**
 * P0 host work-state kit tests: the client half exposes the optional
 * `workState` / `workSince` fields of the bridge `state` reply on its handle,
 * defaults an older Host to idle/null and rejects malformed values fail-closed.
 *
 * P0 approval mirror (0.14.0): the optional `approvals` {available, pending,
 * oldestAt} sub-object is parsed fail-closed, defaults to unavailable/zero on
 * an older Host, and yields exactly one localized status line per waiting
 * episode (0 -> N) with no request text, storage or notification API.
 *
 * Adaptive polling (0.14.1): `nextPollDelay(report, failures)` is the pure
 * decision the watcher schedules with - mount 1s, working/waiting 3s, fresh
 * success/error 5s, idle 30s, failures 30s x3 then stop. The handle keeps its
 * exact 0.14.0 field set; only the timer decisions change.
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
 * `en: true` adds the browser navigator the real chunk reads for its copy.
 */
function loadStatusKit({ en = false } = {}) {
  const timers = new Map()
  let nextTimer = 1
  let registration = null
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    setTimeout(fn, delay) { const id = nextTimer; nextTimer += 1; timers.set(id, { fn, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    ...(en ? { navigator: { language: 'en-US' } } : {}),
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

/** Delays of the currently scheduled (single) poll timer. */
function delays(kit) { return [...kit.timers.values()].map((timer) => timer.delay) }

/** Fire the scheduled poll timer once and let the cross-realm reply settle. */
async function tick(kit) {
  const entry = [...kit.timers.entries()].pop()
  kit.timers.delete(entry[0])
  entry[1].fn()
  await flush()
}

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

/* ==================== P0 read-only approval waiting mirror (0.14.0) ==================== */

/** A state reply with the additive approval mirror patched in. */
function approvalReport(approvals, extra = {}) {
  return report({ approvals, ...extra })
}

test('readStateReport parses the additive approval mirror and defaults an old Host to unavailable', () => {
  const { readStateReport } = loadStatusKit().exports
  // Older Host (0.13.x): the field is absent -> unavailable/zero, never a guess.
  const legacy = readStateReport(oldReport())
  assert.deepEqual({ ...legacy.approvals }, { available: false, pending: 0, oldestAt: null }, 'an old Host has no approval mirror')
  assert.equal(legacy.available, true, 'the rest of the state reply still works')
  // A 0.14 Host: the three scalars pass through untouched (counts only, no text).
  const waiting = readStateReport(approvalReport({ available: true, pending: 2, oldestAt: 9 }))
  assert.deepEqual({ ...waiting.approvals }, { available: true, pending: 2, oldestAt: 9 })
  assert.equal(waiting.state, 'running', 'the approval mirror is additive to the existing state reply')
  const supportedIdle = readStateReport(approvalReport({ available: true, pending: 0, oldestAt: null }))
  assert.deepEqual({ ...supportedIdle.approvals }, { available: true, pending: 0, oldestAt: null })
  const unsupported = readStateReport(approvalReport({ available: false, pending: 0, oldestAt: null }))
  assert.deepEqual({ ...unsupported.approvals }, { available: false, pending: 0, oldestAt: null }, 'an unsupported approval mirror is reported honestly')
})

test('the host-status reader rejects malformed approval data fail-closed', () => {
  const { readStateReport } = loadStatusKit().exports
  const malformed = [
    null, 'waiting', [], 3,
    { available: true, pending: 0 },
    { available: true, pending: 0, oldestAt: null, toolName: 'bash' },
    { available: 'yes', pending: 0, oldestAt: null },
    { available: true, pending: -1, oldestAt: 5 },
    { available: true, pending: 9, oldestAt: 5 },
    { available: true, pending: 1.5, oldestAt: 5 },
    { available: true, pending: '1', oldestAt: 5 },
    { available: true, pending: 1, oldestAt: -5 },
    { available: true, pending: 0, oldestAt: 5 },
    { available: false, pending: 1, oldestAt: 5 },
  ]
  for (const approvals of malformed) assert.equal(readStateReport(approvalReport(approvals)), null, 'fail-closed: ' + JSON.stringify(approvals))
})

test('watchHostStatus exposes the approval mirror and shows one line per waiting episode', async () => {
  const kit = loadStatusKit()
  const lines = []
  const statusRef = { current: { say: (line, kind, source) => lines.push([line, kind, source]) } }
  let reply = { ok: true, result: approvalReport({ available: true, pending: 0, oldestAt: null }) }
  const handle = kit.exports.watchHostStatus(() => reply, statusRef)
  assert.equal(handle.approvalAvailable, false, 'safe default before the first reply')
  assert.equal(handle.approvalPending, 0)
  assert.equal(handle.approvalOldestAt, null)
  trigger(handle)
  await flush()
  assert.equal(handle.approvalAvailable, true)
  assert.equal(handle.approvalPending, 0)
  assert.deepEqual(lines, [], 'an idle mirror shows nothing')
  // 0 -> 2: exactly one localized line, no tool/reason text anywhere.
  reply = { ok: true, result: approvalReport({ available: true, pending: 2, oldestAt: 9 }) }
  trigger(handle)
  await flush()
  assert.equal(handle.approvalPending, 2)
  assert.equal(handle.approvalOldestAt, 9)
  assert.deepEqual(lines, [['有 2 个确认在等', 'speech', 'status']], 'one accessible status line per waiting episode')
  // Still waiting: no repeat, even when the count grows.
  reply = { ok: true, result: approvalReport({ available: true, pending: 3, oldestAt: 9 }) }
  trigger(handle)
  await flush()
  assert.equal(handle.approvalPending, 3)
  assert.deepEqual(lines, [['有 2 个确认在等', 'speech', 'status']], 'the same episode never re-notifies')
  // 0 again, then a new episode: one new line, never per request.
  reply = { ok: true, result: approvalReport({ available: true, pending: 0, oldestAt: null }) }
  trigger(handle)
  await flush()
  assert.equal(handle.approvalPending, 0)
  reply = { ok: true, result: approvalReport({ available: true, pending: 1, oldestAt: 11 }) }
  trigger(handle)
  await flush()
  assert.deepEqual(lines, [['有 2 个确认在等', 'speech', 'status'], ['有 1 个确认在等', 'speech', 'status']])
  handle.stop()
  assert.equal(kit.timers.size, 0, 'stop() clears the pending poll')
})

test('the waiting line follows the client language and never fires for an unavailable mirror', async () => {
  const kit = loadStatusKit({ en: true })
  const lines = []
  const statusRef = { current: { say: (line) => lines.push(line) } }
  let reply = { ok: true, result: approvalReport({ available: true, pending: 1, oldestAt: 9 }) }
  const handle = kit.exports.watchHostStatus(() => reply, statusRef)
  trigger(handle)
  await flush()
  assert.deepEqual(lines, ['1 approval is waiting'])
  reply = { ok: true, result: approvalReport({ available: false, pending: 0, oldestAt: null }) }
  trigger(handle)
  await flush()
  assert.equal(handle.approvalAvailable, false, 'an unsupported mirror resets the handle')
  assert.deepEqual(lines, ['1 approval is waiting'], 'no line without an available mirror')
})

test('a failed poll never leaves a stale approval waiting state', async () => {
  const kit = loadStatusKit()
  const lines = []
  const statusRef = { current: { say: (line) => lines.push(line) } }
  let reply = { ok: true, result: approvalReport({ available: true, pending: 2, oldestAt: 9 }) }
  const handle = kit.exports.watchHostStatus(() => reply, statusRef)
  trigger(handle)
  await flush()
  assert.equal(handle.approvalPending, 2)
  reply = { ok: false, code: 'E_INTERNAL' }
  trigger(handle)
  await flush()
  assert.equal(handle.approvalAvailable, false, 'a failed poll clears the mirror')
  assert.equal(handle.approvalPending, 0)
  assert.equal(handle.approvalOldestAt, null)
  // A throwing say() must never break the polling loop.
  const kit2 = loadStatusKit()
  let reply2 = { ok: true, result: approvalReport({ available: true, pending: 1, oldestAt: 9 }) }
  const handle2 = kit2.exports.watchHostStatus(() => reply2, { current: { say: () => { throw new Error('say boom') } } })
  assert.doesNotThrow(() => { trigger(handle2) })
  await flush()
  assert.equal(handle2.approvalPending, 1, 'the mirror still updates after a throwing say()')
  handle.stop()
  handle2.stop()
})

test('the lazy kit keeps the approval mirror count-only: no request text, storage or notification APIs', () => {
  const source = readFileSync(STATUS_PATH, 'utf8')
  assert.ok(source.includes("zh: (pending) => '有 ' + pending + ' 个确认在等'"), 'the zh line is the fixed local count copy')
  assert.ok(source.includes('MAX_APPROVALS = 8'), 'the client mirrors the Host 0..8 clamp')
  for (const forbidden of ['.toolName', '.reason', '.callId', '.displayReason', 'sessionId', 'localStorage', 'sessionStorage', 'document.', 'Notification', 'fetch(']) {
    assert.equal(source.includes(forbidden), false, 'the approval mirror never touches: ' + forbidden)
  }
  assert.ok(source.includes("statusRef?.current?.say?.(lineFor(report.approvals.pending), 'speech', 'status')"), 'only the bounded count reaches the accessible status line')
  assert.ok(source.includes("lineFor = APPROVAL_LINES[LANG]") && source.includes('/^en/i.test(navigator.language'), 'the fixed copy follows the browser language without new storage')
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

/* ==================== adaptive status polling (0.14.1) ==================== */

test('nextPollDelay is the pure adaptive decision: 1s first, 3s working/waiting, 5s fresh, 30s idle', () => {
  const { nextPollDelay, readStateReport } = loadStatusKit().exports
  const idle = readStateReport(oldReport())
  assert.equal(idle.workState, 'idle', 'an old Host reads as idle')
  // Working or a waiting approval is the most time-sensitive state -> 3s.
  assert.equal(nextPollDelay(readStateReport(report({ workState: 'working', workSince: 5 })), 0), 3000)
  assert.equal(nextPollDelay(readStateReport(approvalReport({ available: true, pending: 2, oldestAt: 9 })), 0), 3000, 'a pending approval outranks the idle cadence')
  // A fresh success/error is transient on the Host (10s/60s TTL) -> 5s.
  assert.equal(nextPollDelay(readStateReport(report({ state: 'idle', active: 0, workState: 'success', workSince: 9 })), 0), 5000)
  assert.equal(nextPollDelay(readStateReport(report({ state: 'idle', active: 0, workState: 'error', workSince: 9 })), 0), 5000)
  assert.equal(nextPollDelay(idle, 0), 30000, 'idle settles to the 30s cadence')
  // Unsupported stops; a failed pull retries silently 3 times at 30s then stops.
  const unsupported = readStateReport({ v: 2, ok: true, op: 'state', available: false, source: 'unsupported', state: 'unknown', active: 0, updatedAt: null, lastError: null, transitions: [] })
  assert.equal(unsupported.available, false)
  assert.equal(nextPollDelay(unsupported, 0), null)
  for (const failures of [1, 2, 3]) assert.equal(nextPollDelay(null, failures), 30000, 'silent retry ' + failures)
  assert.equal(nextPollDelay(null, 4), null, 'the retry cap stops the loop')
})

test('watchHostStatus schedules the adaptive cadence and pauses while hidden', async () => {
  const kit = loadStatusKit()
  let reply = { ok: true, result: report({ workState: 'working', workSince: 5 }) }
  const handle = kit.exports.watchHostStatus(() => reply)
  assert.deepEqual(delays(kit), [1000], 'the first pull is 1s after mount')
  await tick(kit)
  assert.deepEqual(delays(kit), [3000], 'a working agent polls at 3s')
  reply = { ok: true, result: report({ state: 'idle', active: 0, workState: 'success', workSince: 9 }) }
  await tick(kit)
  assert.deepEqual(delays(kit), [5000], 'a fresh success polls at 5s')
  reply = { ok: true, result: oldReport() }
  await tick(kit)
  assert.deepEqual(delays(kit), [30000], 'idle polls at 30s')
  reply = { ok: true, result: approvalReport({ available: true, pending: 1, oldestAt: 9 }) }
  await tick(kit)
  assert.deepEqual(delays(kit), [3000], 'a waiting approval keeps the fast cadence')
  // Hidden clears the timer and schedules nothing; returning pulls once now.
  handle.refresh(false)
  assert.deepEqual(delays(kit), [], 'the hidden tab has no pending poll')
  reply = { ok: true, result: oldReport() }
  handle.refresh(true)
  await flush()
  assert.equal(handle.approvalPending, 0, 'the immediate pull re-reads the state')
  assert.deepEqual(delays(kit), [30000], 'the resumed pull follows the refreshed idle state')
  handle.stop()
  assert.deepEqual(delays(kit), [], 'stop() clears the pending poll')
})

test('the adaptive watcher exposes no new handle fields', () => {
  const kit = loadStatusKit()
  const handle = kit.exports.watchHostStatus(() => ({ ok: true, result: oldReport() }))
  assert.deepEqual(Object.keys(handle).sort(), ['approvalAvailable', 'approvalOldestAt', 'approvalPending', 'available', 'busy', 'refresh', 'stop', 'workSince', 'workState'], 'the 0.14.0 handle shape is unchanged')
  handle.stop()
})
