#!/usr/bin/env node
/**
 * Verify the generated multi-character animation block in client.js.
 *
 * Checks, without a browser:
 *   - the generated ANIMS/SPRITES block and the hand-written EVENT_CLIPS/
 *     MICRO_LINES block are structurally valid and every action maps to a clip
 *     that really exists for that character (talk is the documented bubble-only
 *     event and feed reuses the stand/wave clip);
 *   - each embedded character's regions (head/body/tail tap zones, idle gating,
 *     gesture -> event -> clip mapping, per-region random says) follow the
 *     famling hero regions contract;
 *   - the embedded species actions follow the per-species menu contract (dog
 *     fetch/retrieve with ball_throw -> ball_chase follow-up; cat/human never get
 *     ball actions; every action has at least two random says lines);
 *   - all embedded frames (per-manifest counts: dog/human 68, cat 72 = 208 today)
 *     decode as 96x96 PNGs with visible pixels, and clip timing (fps/holdMs/
 *     durationMs) is internally consistent;
 *   - bubble/TTS policy is human=speech+tts, cat/dog=thought+no-tts;
 *   - the white bubble background / dark text and the random-say code paths are
 *     present in client.js;
 *   - the hand-written micro-action bubble line i18n keys exist in both locales;
 *   - optionally (default: auto) the embedded frames still match the private
 *     asset pack byte-for-byte after re-encoding.
 *
 * Usage:
 *   node scripts/verify-anims.mjs            # verify, cross-check assets if found
 *   node scripts/verify-anims.mjs --no-assets # skip the private asset cross-check
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ACTION_EVENTS,
  BEGIN_MARKER,
  CHARACTERS,
  DEFAULT_ASSETS_ROOT,
  END_MARKER,
  PLUGIN_ROOT,
  REGION_EVENTS,
  buildAnimationData,
  decodePng,
  resolveAssetsRoot,
} from './embed-anims.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ACTION_BEGIN = '// <dsh-famling:actions:begin>'
export const ACTION_END = '// <dsh-famling:actions:end>'
export const CLIENT_PATH = join(PLUGIN_ROOT, 'client.js')
const EXPECTED_CANVAS = 96
/** Per-clip timing: holdMs must cover every frame and sum to durationMs. */
const MAX_FRAME_HOLD_MS = 60_000
const MAX_SAYS = 6
const MAX_SAY_CHARS = 120
// The plugin click layer maps region gesture events to these animation clips.
const REQUIRED_REGIONS = { head: 'pat', body: 'stand_wag', tail: 'chase_tail' }
/** Event -> clip the hand-written client table must provide. */
const REQUIRED_EVENT_CLIPS = {
  pat: 'pat_head',
  stand_wag: 'stand_wag',
  chase_tail: 'chase_tail',
  ball_throw: 'ball_throw',
  ball_chase: 'ball_chase',
  paw_face: 'paw_face',
  run: 'run',
}
/** Events the client deliberately keeps bubble-only (no animation clip). */
const BUBBLE_ONLY_EVENTS = ['talk']
const BALL_EVENTS = ['ball_throw', 'ball_chase']
/** Species menu contract: event coverage each character's actions must provide. */
const REQUIRED_ACTION_EVENTS = {
  human: ['pat', 'feed', 'stand_wag', 'paw_face', 'talk'],
  cat: ['pat', 'stand_wag', 'paw_face', 'chase_tail', 'run'],
  dog: ['pat', 'ball_throw', 'ball_chase', 'chase_tail', 'run'],
}

/** Validate a random-says array: at least two lines for a varied click. */
function verifySays(kind, where, says, errors) {
  if (!Array.isArray(says) || says.length < 2 || says.length > MAX_SAYS) {
    errors.push(kind + ' ' + where + ': says must be 2..' + MAX_SAYS + ' random lines')
    return
  }
  for (let index = 0; index < says.length; index += 1) {
    const line = says[index]
    if (typeof line !== 'string' || line.length === 0 || line.length > MAX_SAY_CHARS) {
      errors.push(kind + ' ' + where + '.says[' + index + '] must be a non-empty string <= ' + MAX_SAY_CHARS + ' chars')
    }
  }
}

/** Validate one embedded ANIMS[character].regions document against the hero contract. */
function verifyEmbeddedRegions(kind, anim, errors) {
  const config = anim.regions
  if (!config || typeof config !== 'object') {
    errors.push(kind + ': regions are missing')
    return
  }
  if (config.version !== 1) errors.push(kind + ': regions.version must be 1')
  if (!Array.isArray(config.canvas) || config.canvas[0] !== EXPECTED_CANVAS || config.canvas[1] !== EXPECTED_CANVAS) {
    errors.push(kind + ': regions.canvas must be ' + EXPECTED_CANVAS + 'x' + EXPECTED_CANVAS)
  }
  if (!Array.isArray(config.regions) || config.regions.length === 0) {
    errors.push(kind + ': regions must be a non-empty array')
    return
  }
  const regionIds = new Set()
  for (const region of config.regions) {
    if (!region || typeof region.id !== 'string' || region.id.length === 0) {
      errors.push(kind + ': region without a valid id')
      continue
    }
    if (regionIds.has(region.id)) errors.push(kind + ': duplicate region ' + region.id)
    regionIds.add(region.id)
    const rect = region.rect
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((value) => Number.isFinite(value))) {
      errors.push(kind + '/' + region.id + ': rect must be four finite numbers')
      continue
    }
    if (rect[2] <= 0 || rect[3] <= 0) errors.push(kind + '/' + region.id + ': rect width/height must be > 0')
    if (rect[0] < 0 || rect[1] < 0 || rect[0] + rect[2] > EXPECTED_CANVAS || rect[1] + rect[3] > EXPECTED_CANVAS) {
      errors.push(kind + '/' + region.id + ': rect must stay inside the ' + EXPECTED_CANVAS + 'x' + EXPECTED_CANVAS + ' canvas')
    }
  }
  if (!Array.isArray(config.gestures) || config.gestures.length === 0) {
    errors.push(kind + ': regions.gestures must be a non-empty array')
    return
  }
  for (const gesture of config.gestures) {
    if (!gesture || typeof gesture !== 'object') {
      errors.push(kind + ': malformed region gesture')
      continue
    }
    if (typeof gesture.region !== 'string' || !regionIds.has(gesture.region)) errors.push(kind + ': gesture region is not declared: ' + gesture.region)
    if (!REGION_EVENTS.includes(gesture.event)) errors.push(kind + ': gesture event has no client clip mapping: ' + gesture.event)
    if (gesture.gesture !== undefined && gesture.gesture !== 'tap') errors.push(kind + '/' + gesture.region + ': unsupported gesture ' + gesture.gesture)
    verifySays(kind, '/' + gesture.region + ' gesture', gesture.says, errors)
  }
  for (const [regionId, expectedEvent] of Object.entries(REQUIRED_REGIONS)) {
    if (!regionIds.has(regionId)) {
      errors.push(kind + ': regions must declare ' + regionId)
      continue
    }
    const rule = config.gestures.find((gesture) => gesture.region === regionId && gesture.event === expectedEvent)
    if (!rule) {
      errors.push(kind + ': ' + regionId + ' must map tap -> ' + expectedEvent)
      continue
    }
    if (!Array.isArray(rule.states) || !rule.states.includes('idle') || !rule.states.includes('idle_blink')) {
      errors.push(kind + ': ' + regionId + ' reaction must be state-gated to idle/idle_blink')
    }
  }
}

/** Validate the embedded species action table and its event -> clip mapping. */
function verifyActions(kind, anim, eventClips, errors) {
  const actions = anim.actions
  if (!Array.isArray(actions) || actions.length === 0) {
    errors.push(kind + ': actions are missing')
    return
  }
  const actionIds = new Set()
  const events = new Set()
  for (const action of actions) {
    if (!action || typeof action !== 'object') {
      errors.push(kind + ': malformed action entry')
      continue
    }
    if (typeof action.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(action.id)) {
      errors.push(kind + ': action id is invalid: ' + String(action.id))
    } else if (actionIds.has(action.id)) {
      errors.push(kind + ': duplicate action id ' + action.id)
    } else {
      actionIds.add(action.id)
    }
    if (typeof action.label !== 'string' || action.label.length === 0 || action.label.length > 32) {
      errors.push(kind + '/' + String(action.id) + ': label must be a non-empty string <= 32 chars')
    }
    const event = action.event
    if (typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(eventClips, event)) {
      errors.push(kind + '/' + String(action.id) + ': event has no client clip mapping: ' + String(event))
    } else {
      const clipId = eventClips[event]
      if (clipId === null) {
        if (!BUBBLE_ONLY_EVENTS.includes(event)) errors.push(kind + '/' + String(action.id) + ': event ' + event + ' is bubble-only but not documented as such')
      } else if (typeof clipId !== 'string' || !anim.clips[clipId]) {
        errors.push(kind + '/' + String(action.id) + ': event ' + event + ' maps to missing clip ' + String(clipId))
      }
    }
    events.add(event)
    verifySays(kind, '/' + String(action.id) + ' action', action.says, errors)
    if (action.followUpEvent !== undefined) {
      if (typeof action.followUpEvent !== 'string' || !ACTION_EVENTS.includes(action.followUpEvent)) {
        errors.push(kind + '/' + String(action.id) + ': followUpEvent has no client clip mapping: ' + String(action.followUpEvent))
      } else if (action.followUpEvent === event) {
        errors.push(kind + '/' + String(action.id) + ': followUpEvent must differ from event')
      } else {
        const followClip = eventClips[action.followUpEvent]
        if (typeof followClip !== 'string' || !anim.clips[followClip]) {
          errors.push(kind + '/' + String(action.id) + ': followUpEvent ' + action.followUpEvent + ' maps to missing clip ' + String(followClip))
        }
      }
      if (action.followUpMs !== undefined && (typeof action.followUpMs !== 'number' || !Number.isFinite(action.followUpMs) || action.followUpMs < 0 || action.followUpMs > 5000)) {
        errors.push(kind + '/' + String(action.id) + ': followUpMs must be 0..5000')
      }
    } else if (action.followUpMs !== undefined) {
      errors.push(kind + '/' + String(action.id) + ': followUpMs requires followUpEvent')
    }
  }
  for (const requiredEvent of REQUIRED_ACTION_EVENTS[kind] || []) {
    if (!events.has(requiredEvent)) errors.push(kind + ': actions must cover event ' + requiredEvent)
  }
  if (kind === 'dog') {
    const fetch = actions.find((action) => action && action.event === 'ball_throw' && action.followUpEvent === 'ball_chase')
    if (!fetch) errors.push('dog: fetch action must follow ball_throw with ball_chase')
  } else {
    for (const ballEvent of BALL_EVENTS) {
      if (events.has(ballEvent)) errors.push(kind + ': must not expose ball action ' + ballEvent)
    }
    for (const action of actions) {
      if (action && typeof action.label === 'string' && /球|ball/i.test(action.label)) {
        errors.push(kind + ': ball-like action label is not allowed: ' + action.label)
      }
    }
  }
}

function extractConstBlock(source, beginMarker, endMarker) {
  const lines = source.split('\n')
  const begin = lines.findIndex((line) => line.trim() === beginMarker)
  const end = lines.findIndex((line) => line.trim() === endMarker)
  if (begin === -1 || end === -1 || end <= begin) throw new Error('missing generated-block markers ' + beginMarker + ' / ' + endMarker)
  return lines.slice(begin + 1, end).join('\n')
}

/** Evaluate the two generated/hand-written const blocks out of client.js. */
export function loadClientData(source) {
  const animsBlock = extractConstBlock(source, BEGIN_MARKER, END_MARKER)
  const actionsBlock = extractConstBlock(source, ACTION_BEGIN, ACTION_END)
  const code = animsBlock + '\n' + actionsBlock + '\n' + 'return { ANIMS, SPRITES, EVENT_CLIPS, MICRO_LINES }'
  const data = new Function(code)()
  return { ANIMS: data.ANIMS, SPRITES: data.SPRITES, EVENT_CLIPS: data.EVENT_CLIPS, MICRO_LINES: data.MICRO_LINES }
}

function extractSourceSha256(source) {
  const match = source.match(/source-sha256: ([0-9a-f]{64})/)
  return match ? match[1] : null
}

function countKeyOccurrences(source, key) {
  return source.split(key + ':').length - 1
}

export function verifyClient(options = {}) {
  const pluginRoot = options.pluginRoot || PLUGIN_ROOT
  const clientPath = options.clientPath || join(pluginRoot, 'client.js')
  const source = readFileSync(clientPath, 'utf8')
  const errors = []
  const warnings = []
  const stats = { characters: {}, totalFrames: 0, totalBase64Chars: 0 }
  let data
  try {
    data = loadClientData(source)
  } catch (error) {
    return { ok: false, errors: ['cannot load generated animation block: ' + error.message], warnings, stats }
  }
  const { ANIMS, SPRITES, EVENT_CLIPS, MICRO_LINES } = data
  if (!ANIMS || typeof ANIMS !== 'object') errors.push('ANIMS is missing or not an object')
  if (!SPRITES || typeof SPRITES !== 'object') errors.push('SPRITES is missing or not an object')
  if (!EVENT_CLIPS || typeof EVENT_CLIPS !== 'object') errors.push('EVENT_CLIPS is missing or not an object')
  if (!MICRO_LINES || typeof MICRO_LINES !== 'object') errors.push('MICRO_LINES is missing or not an object')
  if (EVENT_CLIPS && typeof EVENT_CLIPS === 'object') {
    for (const [event, clipId] of Object.entries(REQUIRED_EVENT_CLIPS)) {
      if (EVENT_CLIPS[event] !== clipId) errors.push('EVENT_CLIPS.' + event + ' must map to ' + clipId + ', got ' + String(EVENT_CLIPS[event]))
    }
    if (EVENT_CLIPS.talk !== null) errors.push('EVENT_CLIPS.talk must stay bubble-only (null)')
    for (const [event, clipId] of Object.entries(EVENT_CLIPS)) {
      if (!ACTION_EVENTS.includes(event)) errors.push('EVENT_CLIPS contains an unknown event: ' + event)
      if (clipId !== null && typeof clipId !== 'string') errors.push('EVENT_CLIPS.' + event + ' must be a clip id or null')
    }
  }

  for (const kind of CHARACTERS) {
    const anim = ANIMS?.[kind]
    const expectedPolicy = kind === 'human' ? { canTts: true, bubble: 'speech' } : { canTts: false, bubble: 'thought' }
    if (!anim || typeof anim !== 'object' || !anim.clips) {
      errors.push(kind + ': ANIMS entry is missing')
      continue
    }
    const clipIds = Object.keys(anim.clips)
    if (clipIds.length === 0) errors.push(kind + ': no clips embedded')
    const referenceClipIds = Object.keys(ANIMS?.[CHARACTERS[0]]?.clips || {}).sort()
    if (clipIds.slice().sort().join(',') !== referenceClipIds.join(',')) errors.push(kind + ': clip ids differ from ' + CHARACTERS[0])
    if (anim.canTts !== expectedPolicy.canTts) errors.push(kind + ': canTts must be ' + expectedPolicy.canTts + ', got ' + anim.canTts)
    if (anim.bubble !== expectedPolicy.bubble) errors.push(kind + ': bubble must be ' + expectedPolicy.bubble + ', got ' + anim.bubble)
    let frameCount = 0
    let base64Chars = 0
    let emptyFrames = 0
    for (const clipId of clipIds) {
      const clip = anim.clips[clipId]
      if (!Number.isInteger(clip.fps) || clip.fps < 1) errors.push(kind + '/' + clipId + ': invalid fps')
      if (!Array.isArray(clip.frames) || clip.frames.length === 0) {
        errors.push(kind + '/' + clipId + ': no frames')
        continue
      }
      if (clip.holdMs !== undefined) {
        if (!Array.isArray(clip.holdMs) || clip.holdMs.length !== clip.frames.length) {
          errors.push(kind + '/' + clipId + ': holdMs must have exactly one entry per frame')
        } else {
          for (let index = 0; index < clip.holdMs.length; index += 1) {
            const value = clip.holdMs[index]
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 30 || value > MAX_FRAME_HOLD_MS) {
              errors.push(kind + '/' + clipId + ': holdMs[' + index + '] must be 30..' + MAX_FRAME_HOLD_MS + 'ms')
            }
          }
          if (Number.isFinite(clip.durationMs)) {
            const held = clip.holdMs.reduce((sum, value) => sum + value, 0)
            if (Math.abs(held - clip.durationMs) > 1) errors.push(kind + '/' + clipId + ': durationMs ' + clip.durationMs + ' does not match the sum of holdMs ' + held)
          }
        }
      }
      if (clip.durationMs !== undefined && (typeof clip.durationMs !== 'number' || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0)) {
        errors.push(kind + '/' + clipId + ': durationMs must be a positive finite number')
      }
      for (const frameKey of clip.frames) {
        frameCount += 1
        const base64 = SPRITES?.[frameKey]
        if (typeof base64 !== 'string' || base64.length === 0) {
          errors.push(kind + ': sprite missing for ' + frameKey)
          continue
        }
        base64Chars += base64.length
        let png
        try {
          png = decodePng(Buffer.from(base64, 'base64'))
        } catch (error) {
          errors.push(kind + ': frame does not decode (' + frameKey + '): ' + error.message)
          continue
        }
        if (png.width !== EXPECTED_CANVAS || png.height !== EXPECTED_CANVAS) errors.push(kind + '/' + frameKey + ': canvas is ' + png.width + 'x' + png.height)
        if (png.bitDepth !== 1 && png.bitDepth !== 2 && png.bitDepth !== 4 && png.bitDepth !== 8) errors.push(kind + '/' + frameKey + ': unsupported bit depth ' + png.bitDepth)
        let visible = 0
        for (let offset = 3; offset < png.rgba.length; offset += 4) if (png.rgba[offset] !== 0) visible += 1
        if (visible === 0) emptyFrames += 1
      }
    }
    if (frameCount === 0) errors.push(kind + ': no frames embedded')
    if (emptyFrames > 0) errors.push(kind + ': ' + emptyFrames + ' fully transparent frames')
    verifyEmbeddedRegions(kind, anim, errors)
    verifyActions(kind, anim, EVENT_CLIPS, errors)
    if (!Array.isArray(anim.microActions) || anim.microActions.length === 0) {
      errors.push(kind + ': microActions is empty')
    } else {
      for (const clipId of anim.microActions) {
        if (!anim.clips[clipId]) errors.push(kind + ': micro action maps to missing clip ' + clipId)
        if (clipId === 'idle' || clipId === 'idle_blink') errors.push(kind + ': micro action must not be ' + clipId)
        const lineKey = MICRO_LINES?.[kind]?.[clipId]
        if (!lineKey) errors.push(kind + ': micro action ' + clipId + ' has no bubble line')
        else if (countKeyOccurrences(source, lineKey) < 2) errors.push(kind + ': micro line key ' + lineKey + ' is not defined in both locales')
      }
    }
    stats.characters[kind] = { clips: clipIds.length, frames: frameCount, base64Chars }
    stats.totalFrames += frameCount
    stats.totalBase64Chars += base64Chars
  }

  if (!source.includes('canTts && settings.sound && ttsConsent')) errors.push('client.js is missing the canTts/sound/consent TTS guard')
  if (!source.includes('window.speechSynthesis.cancel()')) errors.push('client.js never cancels browser speech when switching to a silent character')
  if (!source.includes("localStorage.setItem(CHARACTER_KEY, character)")) errors.push('client.js does not persist the selected character')
  if (!source.includes('background: \'#ffffff\', color: \'#111111\'')) errors.push('bubble must stay white (#ffffff) with dark (#111111) text')
  if (!source.includes('1.5px dashed #8f8f8f') || !source.includes('1px solid #9a9a9a')) errors.push('bubble must keep the grey solid/dashed borders')
  if (!source.includes('function frameDuration(seq, index)')) errors.push('client.js is missing the per-frame (holdMs) duration helper')
  if (!source.includes('function frameDurations(seq)') || !source.includes('seq.durationMs')) errors.push('client.js does not read durationMs when timing a clip')
  if (!source.includes('seq.holdMs') || !source.includes('durations[index]')) errors.push('client.js playback does not schedule frames from holdMs')
  if (source.includes('setInterval(() => setFrameIndex')) errors.push('client.js still uses a fixed-interval frame advance instead of holdMs timeouts')
  if (!source.includes('function pickSaidLine(pool, key, previous)')) errors.push('client.js is missing the random bubble-line picker')
  if (!source.includes('previous[key] = line')) errors.push('random bubble-line picker does not remember the previous line')
  if (!source.includes('pickSaidLine(reaction.says')) errors.push('region taps do not pick a random line from the region says')
  if (!source.includes('pickSaidLine(action.says')) errors.push('menu actions do not pick a random line from the action says')
  if (!source.includes('ANIMS[character]?.actions')) errors.push('action panel is not rendered from the embedded species actions')
  if (!source.includes('action.followUpEvent')) errors.push('menu actions do not schedule follow-up events')
  if (!source.includes('function onPetClick(event)')) errors.push('client.js is missing the region tap handler')
  if (source.includes('ACTION_SETS')) errors.push('client.js still contains the obsolete ACTION_SETS table')

  const assetsRootOption = Object.prototype.hasOwnProperty.call(options, 'assetsRoot') ? options.assetsRoot : undefined
  const assetsRoot = assetsRootOption === null ? null : resolveAssetsRoot(assetsRootOption)
  if (assetsRoot === null) {
    warnings.push('private animation assets not found; skipped byte-level source cross-check')
  } else {
    try {
      const fresh = buildAnimationData(assetsRoot, { optimize: true })
      const embeddedHash = extractSourceSha256(source)
      if (embeddedHash !== fresh.sourceSha256) errors.push('embedded source-sha256 is stale (embedded ' + embeddedHash + ', assets ' + fresh.sourceSha256 + ')')
      if (JSON.stringify(ANIMS) !== JSON.stringify(fresh.anims)) errors.push('embedded ANIMS table differs from the current asset pack (clips/regions/actions)')
      if (JSON.stringify(SPRITES) !== JSON.stringify(fresh.sprites)) errors.push('embedded SPRITES differ from the current asset pack')
      stats.assetsRoot = assetsRoot
    } catch (error) {
      errors.push('asset cross-check failed: ' + error.message)
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats, data }
}

function formatKiB(bytes) { return (bytes / 1024).toFixed(1) + ' KiB' }

export async function main(argv = process.argv.slice(2)) {
  const assetsRoot = argv.includes('--no-assets') ? null : undefined
  const result = verifyClient({ assetsRoot })
  for (const warning of result.warnings) console.warn('[verify-anims] warn: ' + warning)
  if (result.stats.assetsRoot) console.log('[verify-anims] assets cross-check: ' + result.stats.assetsRoot)
  console.log('[verify-anims] total frames: ' + result.stats.totalFrames + ', base64: ' + formatKiB(result.stats.totalBase64Chars))
  for (const [kind, item] of Object.entries(result.stats.characters)) {
    console.log('[verify-anims] ' + kind.padEnd(5) + ' clips=' + item.clips + ' frames=' + item.frames + ' base64=' + formatKiB(item.base64Chars))
  }
  if (!result.ok) {
    for (const error of result.errors) console.error('[verify-anims] FAIL: ' + error)
    process.exitCode = 1
    return
  }
  console.log('[verify-anims] OK')
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) await main()
