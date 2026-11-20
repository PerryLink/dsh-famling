/* dsh-famling host-status kit (lazy package-local chunk): coarse Agent running/
 * idle polling for quiet hints. client.js owns the bridge call and reads this
 * handle when suppressing automatic output; a failed or unsupported watcher is
 * inert (no throw, no blocked render, no changed behaviour). Replies are
 * validated against the closed schema, retries are silent and capped, and
 * nothing is persisted or logged (no message/prompt text is ever read).
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
      return { available: true, state: result.state }
    }

    // poll: first pull one interval after mount; refresh(visible) pauses/catches up
    // on the entry's existing visibility handler; stop() is the mount cleanup.
    function watchHostStatus(callBridge) {
      const handle = { busy: false, available: false, refresh: null, stop: null }
      let timer = null
      let failures = 0
      let paused = false
      let stopped = false
      const schedule = (delay) => { if (!stopped && !paused) timer = setTimeout(poll, delay) }
      const settle = (report) => {
        if (report === null) {
          failures += 1
          handle.busy = false
          if (failures <= MAX_RETRIES) schedule(POLL_MS)
          return
        }
        failures = 0
        handle.available = report.available
        handle.busy = report.available && report.state === 'running'
        // Unsupported/unavailable fails closed: stop polling instead of guessing.
        if (report.available) schedule(POLL_MS)
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
