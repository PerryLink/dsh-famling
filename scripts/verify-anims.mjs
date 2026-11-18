#!/usr/bin/env node
/**
 * Verify the generated multi-character animation block in client.js.
 *
 * Checks, without a browser:
 *   - the generated ANIMS/SPRITES block and the hand-written ACTION_SETS/
 *     MICRO_LINES block are structurally valid and every action maps to a clip
 *     that really exists for that character;
 *   - each embedded character's regions (head/body/tail tap zones, idle gating,
 *     gesture -> event -> clip mapping) follow the famling hero regions contract;
 *   - all 3 x 68 frames decode as 96x96 PNGs with visible pixels;
 *   - bubble/TTS policy is human=speech+tts, cat/dog=thought+no-tts;
 *   - the hand-written label/line i18n keys the action table points at exist;
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
const EXPECTED_CLIP_COUNT = 12
const EXPECTED_FRAME_COUNT = 68
const EXPECTED_CANVAS = 96
const REQUIRED_ACTION_CLIPS = ['pat_head', 'ball_throw', 'ball_chase']
// The plugin click layer maps region gesture events to these animation clips.
const REQUIRED_REGIONS = { head: 'pat', body: 'stand_wag', tail: 'chase_tail' }

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
  const code = animsBlock + '\n' + actionsBlock + '\n' + 'return { ANIMS, SPRITES, ACTION_SETS, MICRO_LINES }'
  const data = new Function(code)()
  return { ANIMS: data.ANIMS, SPRITES: data.SPRITES, ACTION_SETS: data.ACTION_SETS, MICRO_LINES: data.MICRO_LINES }
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
  const { ANIMS, SPRITES, ACTION_SETS, MICRO_LINES } = data
  if (!ANIMS || typeof ANIMS !== 'object') errors.push('ANIMS is missing or not an object')
  if (!SPRITES || typeof SPRITES !== 'object') errors.push('SPRITES is missing or not an object')
  if (!ACTION_SETS || typeof ACTION_SETS !== 'object') errors.push('ACTION_SETS is missing or not an object')
  if (!MICRO_LINES || typeof MICRO_LINES !== 'object') errors.push('MICRO_LINES is missing or not an object')

  for (const kind of CHARACTERS) {
    const anim = ANIMS?.[kind]
    const expectedPolicy = kind === 'human' ? { canTts: true, bubble: 'speech' } : { canTts: false, bubble: 'thought' }
    if (!anim || typeof anim !== 'object' || !anim.clips) {
      errors.push(kind + ': ANIMS entry is missing')
      continue
    }
    const clipIds = Object.keys(anim.clips)
    if (clipIds.length !== EXPECTED_CLIP_COUNT) errors.push(kind + ': expected ' + EXPECTED_CLIP_COUNT + ' clips, got ' + clipIds.length)
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
    if (frameCount !== EXPECTED_FRAME_COUNT) errors.push(kind + ': expected ' + EXPECTED_FRAME_COUNT + ' frames, got ' + frameCount)
    if (emptyFrames > 0) errors.push(kind + ': ' + emptyFrames + ' fully transparent frames')
    verifyEmbeddedRegions(kind, anim, errors)
    const actionRows = ACTION_SETS?.[kind]
    if (!Array.isArray(actionRows) || actionRows.length === 0) {
      errors.push(kind + ': ACTION_SETS entry is missing')
    } else {
      const mappedClips = new Set()
      for (const row of actionRows) {
        if (!Array.isArray(row) || row.length !== 3) {
          errors.push(kind + ': malformed action row ' + JSON.stringify(row))
          continue
        }
        const [clipId, labelKey, lineKey] = row
        mappedClips.add(clipId)
        if (!anim.clips[clipId]) errors.push(kind + ': action maps to missing clip ' + clipId)
        if (countKeyOccurrences(source, labelKey) < 2) errors.push(kind + ': action label key ' + labelKey + ' is not defined in both locales')
        if (countKeyOccurrences(source, lineKey) < 2) errors.push(kind + ': action line key ' + lineKey + ' is not defined in both locales')
      }
      for (const clipId of REQUIRED_ACTION_CLIPS) if (!mappedClips.has(clipId)) errors.push(kind + ': action set must expose ' + clipId)
    }
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

  const assetsRootOption = Object.prototype.hasOwnProperty.call(options, 'assetsRoot') ? options.assetsRoot : undefined
  const assetsRoot = assetsRootOption === null ? null : resolveAssetsRoot(assetsRootOption)
  if (assetsRoot === null) {
    warnings.push('private animation assets not found; skipped byte-level source cross-check')
  } else {
    try {
      const fresh = buildAnimationData(assetsRoot, { optimize: true })
      const embeddedHash = extractSourceSha256(source)
      if (embeddedHash !== fresh.sourceSha256) errors.push('embedded source-sha256 is stale (embedded ' + embeddedHash + ', assets ' + fresh.sourceSha256 + ')')
      if (JSON.stringify(ANIMS) !== JSON.stringify(fresh.anims)) errors.push('embedded ANIMS table differs from the current asset pack')
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

