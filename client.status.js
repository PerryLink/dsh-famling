/* dsh-famling host-status kit (lazy package-local chunk): coarse Agent running/
 * idle polling for quiet hints. client.js owns the bridge call and reads this
 * handle when suppressing automatic output; a failed or unsupported watcher is
 * inert (no throw, no blocked render, no changed behaviour). Replies are
 * validated against the closed schema, retries are silent and capped, and
 * nothing is persisted or logged (no message/prompt text is ever read).
 *
 * Work state (0.13.2): `workState` idle|working|success|error + `workSince`;
 * an older Host omits them -> idle/null, never a guessed busy state.
 *
 * Approval mirror (0.14.0 P0): `approvals` {available, pending, oldestAt} = one
 * count + one timestamp. A waiting episode (0 -> N) yields one localized status
 * line through the entry's accessible bubble channel; the kit never decides,
 * stores, notifies or fetches, and no tool name/reason/id/args reaches it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-famling',
  chunk: 'client.status.js',
  factory() {
    // One poll per 30s, at most 3 silent retries, matching the Host `state` bounds.
    const POLL_MS = 30000
    const MAX_RETRIES = 3
    const MAX_ACTIVE = 64
    // Mirror of the Host-side clamp: a bigger count is malformed, never trusted.
    const MAX_APPROVALS = 8
    const MAX_RING = 16
    const STATES = ['idle', 'running']
    // Derived work states; `idle` is the safe fallback.
    const WORK_STATES = ['idle', 'working', 'success', 'error']
    const ERROR_KINDS = ['aborted', 'auth', 'network', 'rate-limit', 'server', 'timeout', 'tool', 'unknown']
    // Closed field set of the additive approval mirror (three scalars, no text).
    const APPROVAL_FIELDS = ['available', 'pending', 'oldestAt']
    // Fixed local copy: the line never carries anything about the request itself.
    const APPROVAL_LINES = {
      zh: (pending) => '有 ' + pending + ' 个确认在等',
      en: (pending) => pending + (pending === 1 ? ' approval is waiting' : ' approvals are waiting'),
    }
    // Same language rule as the entry labels; the kit stays DOM-free.
    const LANG = typeof navigator !== 'undefined' && /^en/i.test(navigator.language || '') ? 'en' : 'zh'

    // Closed-schema check of one `state` reply; null = failed, {available:false} = unsupported.
    function readStateReport(result) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return null
      if (result.ok === false || result.op !== 'state') return null
      if (result.available !== true) return { available: false }
      if (!STATES.includes(result.state)) return null
      if (!Number.isInteger(result.active) || result.active < 0 || result.active > MAX_ACTIVE) return null
      if (result.updatedAt !== null && (!Number.isInteger(result.updatedAt) || result.updatedAt < 0)) return null
      const lastError = result.lastError
      if (lastError !== null) {
        if (!lastError || typeof lastError !== 'object' || Object.keys(lastError).length !== 2 || !ERROR_KINDS.includes(lastError.kind) || !Number.isInteger(lastError.at)) return null
      }
      if (!Array.isArray(result.transitions) || result.transitions.length > MAX_RING) return null
      for (const entry of result.transitions) {
        if (!entry || typeof entry !== 'object' || Object.keys(entry).length !== 2 || !STATES.includes(entry.state) || !Number.isInteger(entry.at)) return null
      }
      // Optional P0 fields: old Host omits them (idle). Bad values fail closed.
      if ('workState' in result && !WORK_STATES.includes(result.workState)) return null
      if ('workSince' in result && result.workSince !== null && (!Number.isInteger(result.workSince) || result.workSince < 0)) return null
      const workState = 'workState' in result ? result.workState : 'idle'
      const workSince = workState !== 'idle' && 'workSince' in result ? result.workSince : null
      // Optional P0 approval mirror: an older Host omits it entirely. When it is
      // present it must be exactly the three declared scalars with sane bounds.
      const approvals = result.approvals
      let approval = { available: false, pending: 0, oldestAt: null }
      if (approvals !== undefined) {
        if (!approvals || typeof approvals !== 'object' || Array.isArray(approvals)) return null
        for (const key of Object.keys(approvals)) if (!APPROVAL_FIELDS.includes(key)) return null
        if (typeof approvals.available !== 'boolean') return null
        if (!Number.isInteger(approvals.pending) || approvals.pending < 0 || approvals.pending > MAX_APPROVALS) return null
        if (approvals.oldestAt !== null && (!Number.isInteger(approvals.oldestAt) || approvals.oldestAt < 0)) return null
        if (approvals.pending === 0 && approvals.oldestAt !== null) return null
        if (!approvals.available && approvals.pending !== 0) return null
        approval = { available: approvals.available, pending: approvals.pending, oldestAt: approvals.oldestAt }
      }
      return { available: true, state: result.state, workState, workSince, approvals: approval }
    }

    // poll: first pull one interval after mount; refresh(visible) pauses/catches up
    // on the entry's existing visibility handler; stop() is the mount cleanup.
    function watchHostStatus(callBridge, statusRef) {
      const lineFor = APPROVAL_LINES[LANG]
      // workState/workSince/approval*: idle/zero until the first reply and after
      // any failure, so a dropped poll can never leave a stale "waiting" badge.
      const handle = {
        busy: false, available: false, workState: 'idle', workSince: null,
        approvalAvailable: false, approvalPending: 0, approvalOldestAt: null,
        refresh: null, stop: null,
      }
      let timer = null
      let failures = 0
      let paused = false
      let stopped = false
      const schedule = (delay) => { if (!stopped && !paused) timer = setTimeout(poll, delay) }
      const reset = () => {
        handle.busy = false; handle.workState = 'idle'; handle.workSince = null
        handle.approvalAvailable = false; handle.approvalPending = 0; handle.approvalOldestAt = null
      }
      const settle = (report) => {
        if (report === null) {
          failures += 1
          reset()
          if (failures <= MAX_RETRIES) schedule(POLL_MS)
          return
        }
        failures = 0
        handle.available = report.available
        if (!report.available) { reset(); return }
        handle.busy = report.state === 'running'
        handle.workState = report.workState
        handle.workSince = report.workSince
        const before = handle.approvalPending
        handle.approvalAvailable = report.approvals.available
        handle.approvalPending = report.approvals.pending
        handle.approvalOldestAt = report.approvals.oldestAt
        if (before === 0 && report.approvals.available && report.approvals.pending > 0) {
          // One status line per waiting episode; the entry ref's say() keeps the
          // low-disturb gates (bubble switch, visibility, quiet hours).
          try { statusRef?.current?.say?.(lineFor(report.approvals.pending), 'speech', 'status') } catch {}
        }
        schedule(POLL_MS)
      }
      function poll() {
        timer = null
        if (stopped || paused) return
        let reply = null
        try { reply = callBridge({ v: 2, op: 'state' }, 4000) } catch { settle(null); return }
        Promise.resolve(reply).then(
          (answer) => { if (!stopped) settle(readStateReport(answer && answer.ok ? answer.result : null)) },
          () => { if (!stopped) settle(null) },
        )
      }
      handle.refresh = (visible) => {
        if (stopped) return
        if (visible === false) {
          paused = true
          if (timer !== null) { clearTimeout(timer); timer = null }
          return
        }
        const resumed = paused
        paused = false
        if (resumed || timer === null) poll()
      }
      handle.stop = () => {
        stopped = true
        if (timer !== null) { clearTimeout(timer); timer = null }
      }
      schedule(POLL_MS)
      return handle
    }

    return { watchHostStatus, readStateReport }
  },
})
