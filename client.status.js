/* dsh-famling host-status kit (lazy package-local chunk): coarse Agent running/
 * idle polling for quiet hints. client.js owns the bridge call; a failed or
 * unsupported watcher is inert (no throw, no blocked render, no change).
 * Replies are validated against the closed schema, retries are silent and
 * capped, and nothing is persisted or logged (no message/prompt text read).
 *
 * Adaptive polling (0.14.1): mount 1s, working or waiting approval 3s, fresh
 * success/error 5s, idle 30s; hidden pauses; a failed pull retries silently
 * (3 x 30s) then stops. Existing workState/approval fields and the handle are
 * unchanged: no new field, storage, network or request text.
 */
window.__ModuleLoader__.load({
  id: 'dsh-famling',
  chunk: 'client.status.js',
  factory() {
    // Adaptive cadence; a failed pull keeps the old silent retry cap.
    const FIRST_MS = 1000, WORKING_MS = 3000, FRESH_MS = 5000, IDLE_MS = 30000
    const MAX_RETRIES = 3
    const MAX_ACTIVE = 64
    const MAX_APPROVALS = 8 // mirror of the Host clamp: bigger counts fail closed
    const MAX_RING = 16
    const STATES = ['idle', 'running']
    const WORK_STATES = ['idle', 'working', 'success', 'error']
    const ERROR_KINDS = ['aborted', 'auth', 'network', 'rate-limit', 'server', 'timeout', 'tool', 'unknown']
    const APPROVAL_FIELDS = ['available', 'pending', 'oldestAt'] // three scalars, no text
    // Fixed local copy: the line never carries anything about the request itself.
    const APPROVAL_LINES = {
      zh: (pending) => '有 ' + pending + ' 个确认在等',
      en: (pending) => pending + (pending === 1 ? ' approval is waiting' : ' approvals are waiting'),
    }
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
      // Optional fields: an old Host omits them (idle); bad values fail closed.
      if ('workState' in result && !WORK_STATES.includes(result.workState)) return null
      if ('workSince' in result && result.workSince !== null && (!Number.isInteger(result.workSince) || result.workSince < 0)) return null
      const workState = 'workState' in result ? result.workState : 'idle'
      const workSince = workState !== 'idle' && 'workSince' in result ? result.workSince : null
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

    // Delay before the next pull for one settled reply; null = stop the loop.
    function nextPollDelay(report, failures) {
      if (report === null) return failures <= MAX_RETRIES ? IDLE_MS : null
      if (!report.available) return null
      if (report.workState === 'working' || report.approvals.pending > 0) return WORKING_MS
      return report.workState === 'idle' ? IDLE_MS : FRESH_MS
    }

    // poll: first pull 1s after mount; refresh(visible) pauses/catches up on the
    // entry's existing visibility handler; stop() is the mount cleanup.
    function watchHostStatus(callBridge, statusRef) {
      const lineFor = APPROVAL_LINES[LANG]
      // idle/zero until the first reply and after any failure, so a dropped
      // poll can never leave a stale "waiting" badge.
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
        } else {
          failures = 0
          handle.available = report.available
          if (!report.available) reset()
          else {
            handle.busy = report.state === 'running'
            handle.workState = report.workState
            handle.workSince = report.workSince
            const before = handle.approvalPending
            handle.approvalAvailable = report.approvals.available
            handle.approvalPending = report.approvals.pending
            handle.approvalOldestAt = report.approvals.oldestAt
            if (before === 0 && report.approvals.available && report.approvals.pending > 0) {
              // One status line per waiting episode; the entry ref's say() keeps
              // the low-disturb gates (bubble switch, visibility, quiet hours).
              try { statusRef?.current?.say?.(lineFor(report.approvals.pending), 'speech', 'status') } catch {}
            }
          }
        }
        const delay = nextPollDelay(report, failures)
        if (delay !== null) schedule(delay)
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
      schedule(FIRST_MS)
      return handle
    }

    return { watchHostStatus, readStateReport, nextPollDelay }
  },
})
