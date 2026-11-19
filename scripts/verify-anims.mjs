#!/usr/bin/env node
/**
 * Verify the generated multi-character animation block in client.js.
 *
 * Checks, without a browser:
 *   - the first-screen client.js carries no sprite base64 payload: the per-character
 *     sprite sets live in package-local lazy chunks (client.anims.<character>.js)
 *     that register through window.__ModuleLoader__.load and are loaded on demand
 *     via require.async - the chunks are part of this one package and are served
 *     by the local DSH host, so the split stays offline/no-network;
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
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import {
  ACTION_EVENTS,
  BEGIN_MARKER,
  CHARACTERS,
  CHUNK_NAMES,
  CLIENT_MODULE_ID,
  DEFAULT_ASSETS_ROOT,
  END_MARKER,
  PLUGIN_ROOT,
  REGION_EVENTS,
  buildAnimationData,
  chunkPath,
  decodePng,
  resolveAssetsRoot,
} from './embed-anims.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ACTION_BEGIN = '// <dsh-famling:actions:begin>'
export const ACTION_END = '// <dsh-famling:actions:end>'
export const CLIENT_PATH = join(PLUGIN_ROOT, 'client.js')
/**
 * First-screen budget for client.js itself (sprite payloads are lazy chunks).
 * 0.10.1 raises the cap 72 -> 78 KiB for the minimal zero-button UI plus the
 * right-click / Shift+F10 hierarchical menu (menu data, keyboard handling and
 * viewport clamping must be available before the lazy chunk loads). The content
 * center and the unified settings popup stay in client.content.js, and sprite
 * payloads stay in per-character chunks, so the entry is still well below the
 * pre-split audit baseline (checked in tests).
 */
export const FIRST_SCREEN_BUDGET_BYTES = 78 * 1024
/** Package-local lazy chunk file names, accepted by the DSH client module table. */
export const CLIENT_CHUNK_RE = /^client\.anims\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/
/** Absolute external URLs in a load path would break the offline/no-network contract. */
const EXTERNAL_NETWORK = /(?:(?:fetch|import)\s*\(\s*['"]https?:\/\/|(?:src|href)\s*[:=]\s*['"]https?:\/\/)/
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

/**
 * Evaluate one generated lazy chunk from disk and return its registration plus
 * factory exports. The chunk is a browser script that only calls
 * window.__ModuleLoader__.load, so a stub window is enough here.
 */
export function loadChunkModule(filePath) {
  const code = readFileSync(filePath, 'utf8')
  let registration = null
  const sandbox = { window: { __ModuleLoader__: { load(value) { registration = value } } } }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: filePath })
  if (!registration || typeof registration.factory !== 'function') throw new Error('chunk did not register a module factory: ' + filePath)
  if (typeof registration.id !== 'string' || registration.id.length === 0) throw new Error('chunk registration has no module id: ' + filePath)
  return { registration, exports: registration.factory(() => { throw new Error('chunk factory must not require modules') }) }
}

/**
 * Evaluate the two generated/hand-written const blocks out of client.js and
 * merge the lazily loaded per-character chunk files. Callers therefore see the
 * same { ANIMS, SPRITES } view the browser assembles after each chunk arrives;
 * chunkPayloads keeps the raw registrations for chunk-contract assertions.
 */
export function loadClientData(source, options = {}) {
  const pluginRoot = options.pluginRoot || PLUGIN_ROOT
  const animsBlock = extractConstBlock(source, BEGIN_MARKER, END_MARKER)
  const actionsBlock = extractConstBlock(source, ACTION_BEGIN, ACTION_END)
  const code = animsBlock + '\n' + actionsBlock + '\n'
    + 'return { ANIMS, SPRITES, CHARACTER_POLICY, CHARACTER_CHUNKS, EVENT_CLIPS, MICRO_LINES }'
  const data = new Function(code)()
  const chunkPayloads = {}
  for (const kind of CHARACTERS) {
    const loaded = loadChunkModule(chunkPath(pluginRoot, kind))
    const registration = loaded.registration
    if (registration.id !== CLIENT_MODULE_ID) throw new Error(kind + ': chunk id must be ' + CLIENT_MODULE_ID + ', got ' + String(registration.id))
    if (registration.chunk !== CHUNK_NAMES[kind]) throw new Error(kind + ': chunk field must be ' + CHUNK_NAMES[kind] + ', got ' + String(registration.chunk))
    if (!loaded.exports || typeof loaded.exports !== 'object' || !loaded.exports.anims || !loaded.exports.sprites) {
      throw new Error(kind + ': chunk must export { anims, sprites }')
    }
    // The chunk factory runs in a vm realm, so normalize to this realm's plain
    // objects before deep comparisons (prototypes differ across realms).
    const anims = JSON.parse(JSON.stringify(loaded.exports.anims))
    const sprites = JSON.parse(JSON.stringify(loaded.exports.sprites))
    data.ANIMS[kind] = anims
    Object.assign(data.SPRITES, sprites)
    chunkPayloads[kind] = { registration: loaded.registration, exports: { anims, sprites } }
  }
  return {
    ANIMS: data.ANIMS,
    SPRITES: data.SPRITES,
    CHARACTER_POLICY: data.CHARACTER_POLICY,
    CHARACTER_CHUNKS: data.CHARACTER_CHUNKS,
    EVENT_CLIPS: data.EVENT_CLIPS,
    MICRO_LINES: data.MICRO_LINES,
    chunkPayloads,
  }
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
  const stats = { characters: {}, totalFrames: 0, totalBase64Chars: 0, chunkBytes: {}, entryBytes: 0, firstPaintBytes: 0, totalBytes: 0 }
  let data
  try {
    data = loadClientData(source, { pluginRoot })
  } catch (error) {
    return { ok: false, errors: ['cannot load generated animation block: ' + error.message], warnings, stats }
  }
  const { ANIMS, SPRITES, EVENT_CLIPS, MICRO_LINES, CHARACTER_POLICY, CHARACTER_CHUNKS, chunkPayloads } = data
  if (!ANIMS || typeof ANIMS !== 'object') errors.push('ANIMS is missing or not an object')
  if (!SPRITES || typeof SPRITES !== 'object') errors.push('SPRITES is missing or not an object')
  // P1-2 first-screen budget: client.js must stay code + metadata; the three
  // sprite sets are lazy package-local chunks, so the entry itself is small.
  stats.entryBytes = Buffer.byteLength(source)
  stats.totalBytes = stats.entryBytes
  if (stats.entryBytes > FIRST_SCREEN_BUDGET_BYTES) {
    errors.push('client.js first-screen size ' + stats.entryBytes + ' B exceeds the ' + FIRST_SCREEN_BUDGET_BYTES + ' B budget')
  }
  const embeddedPng = source.match(/data:image\/png;base64,([A-Za-z0-9+/]{512,})/)
  if (embeddedPng) errors.push('client.js still embeds a full base64 PNG frame; sprite payloads belong to the lazy character chunks')
  const longBase64 = source.match(/[A-Za-z0-9+/]{512,}={0,2}/)
  if (longBase64) errors.push('client.js contains a long base64-like literal (sprite data must stay out of the first-screen bundle): ' + longBase64[0].slice(0, 24) + '...')
  if (EXTERNAL_NETWORK.test(source)) errors.push('client.js load path references an external network URL (offline/no-network constraint)')
  // The generated chunk map and the tiny pre-chunk policy must be consistent.
  const published = new Set()
  try {
    const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
    if (Array.isArray(pkg.files)) for (const entry of pkg.files) published.add(entry)
    if (pkg.dsh && pkg.dsh.client && pkg.dsh.client.immediately === true) {
      errors.push('package.json dsh.client.immediately must not be true: the footer pet must not join the stage-one registration barrier')
    }
    stats.packageFiles = Array.isArray(pkg.files) ? pkg.files.slice() : []
    if (published.size > 0 && !published.has('client.content.js')) errors.push('package.json files must publish the lazy content chunk client.content.js')
  } catch (error) {
    errors.push('cannot read package.json: ' + error.message)
  }
  const declaredChunkHashes = {}
  const declaredHashLine = source.match(/chunk-sha256: ([^\n]+)/)
  if (!declaredHashLine) errors.push('client.js header is missing chunk-sha256: a chunk-only rebuild must still change the entry revision')
  else {
    for (const pair of declaredHashLine[1].trim().split(/\s+/)) {
      const [kind, hash] = pair.split('=')
      declaredChunkHashes[kind] = hash
    }
  }
  for (const kind of CHARACTERS) {
    if (!CHARACTER_CHUNKS || CHARACTER_CHUNKS[kind] !== './' + CHUNK_NAMES[kind]) {
      errors.push(kind + ': CHARACTER_CHUNKS entry must be "./' + CHUNK_NAMES[kind] + '", got ' + JSON.stringify(CHARACTER_CHUNKS?.[kind]))
    }
    if (published.size > 0 && !published.has(CHUNK_NAMES[kind])) errors.push('package.json files must publish lazy chunk ' + CHUNK_NAMES[kind])
    const payload = chunkPayloads[kind]
    const chunkSource = readFileSync(chunkPath(pluginRoot, kind), 'utf8')
    stats.chunkBytes[kind] = Buffer.byteLength(chunkSource)
    stats.totalBytes += stats.chunkBytes[kind]
    const policy = CHARACTER_POLICY && CHARACTER_POLICY[kind]
    const anim = ANIMS && ANIMS[kind]
    if (!policy) errors.push(kind + ': CHARACTER_POLICY is missing')
    else if (anim && (policy.canTts !== anim.canTts || policy.bubble !== anim.bubble)) {
      errors.push(kind + ': CHARACTER_POLICY differs from the embedded bubble/TTS policy')
    }
    if (!payload) {
      errors.push(kind + ': lazy chunk was not loaded')
      continue
    }
    const sprites = payload.exports.sprites
    const clipFrames = new Set()
    if (anim && anim.clips) for (const clip of Object.values(anim.clips)) for (const frameKey of clip.frames) clipFrames.add(frameKey)
    for (const frameKey of Object.keys(sprites)) {
      if (!frameKey.startsWith(kind + '/')) errors.push(kind + ': chunk contains a sprite for another character: ' + frameKey)
      else if (!clipFrames.has(frameKey)) errors.push(kind + ': chunk contains a sprite not referenced by ANIMS: ' + frameKey)
    }
    for (const frameKey of clipFrames) {
      if (!Object.prototype.hasOwnProperty.call(sprites, frameKey)) errors.push(kind + ': chunk is missing sprite ' + frameKey)
    }
    if (EXTERNAL_NETWORK.test(chunkSource)) errors.push(kind + ': lazy chunk references an external network URL (offline/no-network constraint)')
    const chunkHash = chunkSource.match(/source-sha256: ([0-9a-f]{64})/)
    if (!chunkHash) errors.push(kind + ': lazy chunk has no source-sha256 header')
    else if (!source.includes(chunkHash[1])) errors.push(kind + ': lazy chunk source-sha256 does not match client.js (chunk/client drift)')
    const actualChunkHash = createHash('sha256').update(chunkSource).digest('hex')
    if (!declaredChunkHashes[kind]) errors.push('client.js header chunk-sha256 is missing ' + kind)
    else if (declaredChunkHashes[kind] !== actualChunkHash) errors.push(kind + ': client.js chunk-sha256 does not match the chunk file (stale entry revision)')
  }
  stats.firstPaintBytes = stats.entryBytes + (stats.chunkBytes.human || 0)
  try {
    for (const name of readdirSync(pluginRoot)) {
      if (CLIENT_CHUNK_RE.test(name) && !Object.values(CHUNK_NAMES).includes(name)) errors.push('unexpected stale lazy chunk file: ' + name)
    }
  } catch (error) {
    warnings.push('cannot list plugin root for stale chunks: ' + error.message)
  }
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
  if (!source.includes("'--dsh-famling-bubble-bg': '#ffffff'") || !source.includes("'--dsh-famling-bubble-text': '#111111'")) errors.push('default content theme must keep the white bubble (#ffffff) with dark (#111111) text')
  if (!source.includes('var(--dsh-famling-bubble-bg, #ffffff)') || !source.includes('var(--dsh-famling-bubble-text, #111111)')) errors.push('bubble must be painted from the content-theme CSS variables')
  if (!source.includes('var(--dsh-famling-bubble-thought-border, #8f8f8f)') || !source.includes('var(--dsh-famling-bubble-border, #9a9a9a)')) errors.push('bubble must keep the grey solid/dashed theme borders')
  if (!source.includes("const DIALOGUE_MODE_IDS = ['standard', 'brief', 'quiet']")) errors.push('content center must expose the standard/brief/quiet dialogue modes')
  if (!source.includes("const THEME_IDS = ['default', 'paper', 'night']")) errors.push('content center must expose the default/paper/night local themes')
  if (!source.includes('function availableVoices()') || !source.includes('getVoices()')) errors.push('content center voice tab must read speechSynthesis.getVoices()')
  if (!source.includes('CONTENT_EXTENSION_POINTS')) errors.push('content center must reference the reserved CONTENT_EXTENSION_POINTS contract')
  if (!source.includes('content-extension.mjs')) errors.push('content center must document content-extension.mjs')
  if (!source.includes('const ROLE_BUNDLES = {')) errors.push('content center must expose role bundles (role = theme)')
  if (!source.includes("const ROLE_KEY = 'dsh-famling/role'")) errors.push('content center must persist the active role id')
  if (!source.includes('localStorage.setItem(ROLE_KEY, roleId)')) errors.push('content center does not persist dsh-famling/role')
  if (!source.includes('function applyRole(nextRole)') || !source.includes('function restoreRole()')) errors.push('content center must apply/restore role bundles atomically')
  if (!source.includes("requestContentChunk") || !source.includes("./client.content.js")) errors.push('content center UI must load from the lazy client.content.js chunk')
  if (!source.includes("const BACKGROUND_IDS = ['transparent', 'paper', 'dark']") || !source.includes('localStorage.setItem(BACKGROUND_KEY, backgroundId)')) errors.push('content center must expose persisted transparent/paper/dark backgrounds')
  if (!source.includes("const FONT_IDS = ['system', 'serif', 'mono']") || !source.includes('localStorage.setItem(FONT_KEY, JSON.stringify(fontChoice))')) errors.push('content center must expose persisted system/serif/mono local font stacks')
  if (!source.includes('var(--dsh-famling-widget-bg, transparent)') || !source.includes('var(--dsh-famling-font-family, inherit)')) errors.push('background/font choices must be applied through widget CSS variables')
  // Content-center UI chunk: lazy, package-local, offline and declaration-aware.
  try {
    const contentSource = readFileSync(join(pluginRoot, 'client.content.js'), 'utf8')
    if (!contentSource.includes("chunk: 'client.content.js'")) errors.push('client.content.js must register the package-local chunk name')
    if (/(?:^|[^.\w])fetch\s*\(/.test(contentSource)) errors.push('client.content.js must not call fetch (no network)')
    if (/(?:src|href)\s*[:=]\s*['\"]https?:/.test(contentSource) || /https?:\/\/[^\s'\"]+/.test(contentSource)) errors.push('client.content.js must not reference external URLs')
    for (const tab of ["roles: '角色'", "custom: '自定义'", "packs: '内容包'", "market: '市场'"]) {
      if (!contentSource.includes(tab)) errors.push('content chunk must expose the four first-level tabs: ' + tab)
    }
    if (!contentSource.includes('researchOnly=true')) errors.push('content chunk must show the researchOnly declaration check')
    if (!contentSource.includes('远程市场接口已预留')) errors.push('content chunk must show the reserved remote-market placeholder')
  } catch (error) { errors.push('cannot read client.content.js: ' + error.message) }
  if (/fonts\.googleapis|@import|url\(\s*['"]?https?:/i.test(source)) errors.push('backgrounds/fonts must not load network images or web fonts')
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
  if (result.stats.entryBytes > 0) {
    console.log('[verify-anims] first-screen client.js: ' + formatKiB(result.stats.entryBytes) + ' (lazy sprite payload stays out)')
    for (const kind of CHARACTERS) {
      if (result.stats.chunkBytes[kind] !== undefined) console.log('[verify-anims] lazy chunk ' + CHUNK_NAMES[kind] + ': ' + formatKiB(result.stats.chunkBytes[kind]))
    }
    console.log('[verify-anims] first paint (client.js + human chunk): ' + formatKiB(result.stats.firstPaintBytes))
    console.log('[verify-anims] all lazy chunks + entry: ' + formatKiB(result.stats.totalBytes))
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
