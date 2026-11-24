/* dsh-famling host-status kit (lazy package-local chunk): coarse Agent running/
 * idle polling for quiet hints. client.js owns the bridge call and reads this
 * handle when suppressing automatic output; a failed or unsupported watcher is
 * inert (no throw, no blocked render, no changed behaviour). Replies are
 * validated against the closed schema, retries are silent and capped, and
 * nothing is persisted or logged (no message/prompt text is ever read).
 *
 * Optional work state (0.13.2): `workState` idle|working|success|error plus
 * `workSince` epoch ms|null. Older Hosts omit them -> idle/null (never a
 * guessed busy state); only that enum and timestamp are read, no ids, no text.
 */
window.__ModuleLoader__.load({
  id: 'dsh-famling',
  chunk: 'client.status.js',
  factory() {
    // One poll per 30s, at most 3 silent retries, matching the Host `state` bounds.
    const POLL_MS = 30000
    const MAX_RETRIES = 3
    const MAX_ACTIVE = 64
    const MAX_RING = 16
    const STATES = ['idle', 'running']
    // Derived work states; `idle` is the safe fallback.
    const WORK_STATES = ['idle', 'working', 'success', 'error']
    const ERROR_KINDS = ['aborted', 'auth', 'network', 'rate-limit', 'server', 'timeout', 'tool', 'unknown']

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
      return { available: true, state: result.state, workState, workSince }
    }

    // poll: first pull one interval after mount; refresh(visible) pauses/catches up
    // on the entry's existing visibility handler; stop() is the mount cleanup.
    function watchHostStatus(callBridge) {
      // workState/workSince: idle/null until the first reply and after any failure.
      const handle = { busy: false, available: false, workState: 'idle', workSince: null, refresh: null, stop: null }
      let timer = null
      let failures = 0
      let paused = false
      let stopped = false
      const schedule = (delay) => { if (!stopped && !paused) timer = setTimeout(poll, delay) }
      const reset = () => { handle.busy = false; handle.workState = 'idle'; handle.workSince = null }
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
