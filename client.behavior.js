/* dsh-famling behavior kit (lazy package-local chunk): tap geometry, region
 * hit-testing, repeat-tap cooldown, random line picking and clip frame timing.
 * client.js owns every state update; a failed chunk falls back to the entry's
 * uniform default frame rhythm and skips region reactions (no throw/block).
 * Pure logic: no React/DOM/storage/network/eval. Requested at mount: keep lean.
 */
window.__ModuleLoader__.load({
  id: 'dsh-famling',
  chunk: 'client.behavior.js',
  factory() {
    // Fallback display size when the tap event carries no element rect (art 96x96).
    const SIZE = 72
    // P-04 repeat-tap guard (1.2s coalesce, 2.5s saturated, 4th tap in 10s blinks).
    const TAP_COOLDOWN_MS = 1200
    const TAP_SATURATED_MS = 2500
    const TAP_WINDOW_MS = 10000
    const TAP_SATURATION_COUNT = 4

    function pickSaidLine(pool, key, previous) {
      if (!Array.isArray(pool) || pool.length === 0) return ''
      const candidates = pool.length > 1 ? pool.filter((line) => line !== previous[key]) : pool
      const choices = candidates.length > 0 ? candidates : pool
      const line = choices[Math.floor(Math.random() * choices.length)]
      previous[key] = line
      return line
    }

    function regionAt(config, artX, artY) {
      if (!config || !Array.isArray(config.regions) || !Number.isFinite(artX) || !Number.isFinite(artY)) return null
      let hit = null
      let hitPriority = -Infinity
      for (const region of config.regions) {
        if (!region || !Array.isArray(region.rect) || region.rect.length !== 4) continue
        const [x, y, width, height] = region.rect
        if (artX < x || artX >= x + width || artY < y || artY >= y + height) continue
        const priority = Number.isFinite(region.priority) ? region.priority : 0
        if (hit === null || priority > hitPriority) { hit = region; hitPriority = priority }
      }
      return hit
    }

    function regionReaction(config, regionId, state, gesture) {
      if (!config || !Array.isArray(config.gestures)) return null
      for (const rule of config.gestures) {
        if (!rule || rule.region !== regionId) continue
        if ((rule.gesture || 'tap') !== gesture) continue
        if (Array.isArray(rule.states) && rule.states.length > 0 && !rule.states.includes(state)) continue
        return rule
      }
      return null
    }

    function clickArtPoint(event, config) {
      const native = event && event.nativeEvent ? event.nativeEvent : event
      if (!native) return null
      const element = (event && event.target) || (event && event.currentTarget) || null
      const rect = element && typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null
      const width = rect && Number.isFinite(rect.width) && rect.width > 0 ? rect.width : SIZE
      const height = rect && Number.isFinite(rect.height) && rect.height > 0 ? rect.height : SIZE
      let offsetX = native.offsetX
      let offsetY = native.offsetY
      if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
        if (!rect || !Number.isFinite(native.clientX) || !Number.isFinite(native.clientY)) return null
        offsetX = native.clientX - rect.left
        offsetY = native.clientY - rect.top
      }
      const canvas = config && Array.isArray(config.canvas) ? config.canvas : [96, 96]
      if (!(width > 0) || !(height > 0) || !Number.isFinite(canvas[0]) || !Number.isFinite(canvas[1])) return null
      const artX = (offsetX * canvas[0]) / width
      const artY = (offsetY * canvas[1]) / height
      if (!Number.isFinite(artX) || !Number.isFinite(artY)) return null
      if (artX < 0 || artY < 0 || artX >= canvas[0] || artY >= canvas[1]) return null
      return { x: artX, y: artY }
    }

    function tapGuard(history, key, now) {
      const guard = history[key] || (history[key] = { since: now, taps: 0, at: 0, cooldown: TAP_COOLDOWN_MS })
      if (now - guard.since > TAP_WINDOW_MS) { guard.since = now; guard.taps = 0 }
      if (now - guard.at < guard.cooldown) return null
      guard.at = now
      guard.taps += 1
      const saturated = guard.taps >= TAP_SATURATION_COUNT
      guard.cooldown = saturated ? TAP_SATURATED_MS : TAP_COOLDOWN_MS
      return { taps: guard.taps, saturated }
    }

    function tapPlan(config, clips, eventClips, event, state, history, character, now) {
      const point = clickArtPoint(event, config)
      if (!point) return null
      const region = regionAt(config, point.x, point.y)
      if (!region) return null
      const reaction = regionReaction(config, region.id, state, 'tap')
      if (!reaction) return null
      const clipId = eventClips[reaction.event]
      if (!clipId || !clips[clipId]) return null
      const guard = tapGuard(history, character + ':' + region.id, now)
      if (!guard) return null
      return { region, reaction, clipId: guard.saturated && clips.idle_blink ? 'idle_blink' : clipId }
    }

    // Manifest holdMs wins, else 1000/fps (min 30ms); a non-loop clip with
    // durationMs keeps its last frame up to that duration (cat stand_wag 3200ms).
    function frameDurations(seq) {
      const durations = seq.frames.map((_, index) => {
        const hold = Array.isArray(seq.holdMs) ? seq.holdMs[index] : undefined
        return Number.isFinite(hold) && hold > 0 ? hold : Math.max(30, Math.round(1000 / (seq.fps || 6)))
      })
      if (!seq.loop && Number.isFinite(seq.durationMs) && seq.durationMs > 0) {
        const total = durations.reduce((sum, value) => sum + value, 0)
        if (seq.durationMs > total) durations[durations.length - 1] += seq.durationMs - total
      }
      return durations
    }

    return { pickSaidLine, regionAt, regionReaction, clickArtPoint, tapGuard, tapPlan, frameDurations }
  },
})
