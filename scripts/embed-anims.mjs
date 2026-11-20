#!/usr/bin/env node
/**
 * Embed the three 96x96 pet animation packs (human / cat / dog) into client.js.
 *
 * Source of truth:
 *   ../../desktop-games/public/assets/pet/anim/{human,cat,dog}/
 *     manifest.json + <clip>/<clip>_NN.png   (12 clips, per-character frame counts, 96x96 RGBA)
 *   ../../desktop-games/public/characters/{pet-tinglan-anim,pet-cat,pet-dog}/
 *     regions.json                           (version/canvas/regions/gestures)
 *
 * The regions documents are shared verbatim with the standalone famling hero
 * app: head/body/tail art-pixel rectangles plus data-driven tap reactions with
 * a state whitelist. They are embedded as ANIMS[character].regions so the DSH
 * plugin can hit-test clicks on the logical 96x96 canvas without fetching JSON
 * at runtime.
 *
 * What it does:
 *   1. reads the three manifests and validates the shared anim contract (frame
 *      counts / fps / holdMs / durationMs are per-character data, never a fixed
 *      68), then reads + validates each character's regions.json tap-region
 *      document (head/body/tail zones, random bubble lines, species actions);
 *   2. reads every PNG and (by default) re-encodes it losslessly as an indexed
 *      PNG with the smallest bit depth - pixel-identical, roughly half the bytes;
 *   3. writes one package-local lazy chunk per character
 *      (client.anims.<character>.js). Each chunk registers itself through
 *      window.__ModuleLoader__.load({id: 'dsh-famling', chunk, factory}) and
 *      returns that character's { anims, sprites }; client.js loads it through
 *      require.async('./client.anims.<character>.js') only when the character
 *      is shown. The chunks are plain files in this plugin package, served by
 *      the local DSH host - offline, no CDN/network, one installable package;
 *   4. injects a small generated metadata block between the two marker comments
 *      in client.js: empty ANIMS/SPRITES registries, the bubble/TTS policy and
 *      the chunk map. No base64 PNG data stays in the first-screen client.js.
 *
 * The block and chunks are generated data: never hand-edit them. Re-run this
 * script instead.
 *
 * Usage:
 *   node scripts/embed-anims.mjs                 # inject / refresh client.js + chunks + spec
 *   node scripts/embed-anims.mjs --check         # fail if client.js/chunks or the vendored spec is stale
 *   node scripts/embed-anims.mjs --qa            # also write scripts/qa/anim-data.js
 *   node scripts/embed-anims.mjs --no-optimize   # embed source PNG bytes verbatim
 *   node scripts/embed-anims.mjs --src DIR       # explicit anim asset root
 *   node scripts/embed-anims.mjs --characters DIR # explicit public/characters root
 *
 * The asset root defaults to FAMLING_ANIM_DIR, else the sibling private repo
 * checkout ../../desktop-games/public/assets/pet/anim. The tap-region root
 * defaults to FAMLING_CHARACTERS_DIR, else the sibling private repo checkout
 * ../../desktop-games/public/characters. No network, no deps.
 *
 * Standalone (MB-004): when the private asset checkout is absent, --check does
 * NOT skip and does NOT need the private repo. It validates the committed
 * client.js + lazy chunks against the vendored semantic spec/LOCK at
 * scripts/spec/anim-spec.json (scripts/anim-spec.mjs); a missing or tampered
 * spec is a hard failure. The embed/update mode still requires the private art
 * checkout and always refreshes the spec together with the chunks, so the
 * vendored lock can never silently drift from the generated artifacts.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

import {
  SPEC_RELATIVE_PATH,
  animationSpecSummary,
  buildAnimationSpec,
  readAnimationSpec,
  renderAnimationSpec,
  specPathFor,
  validateEmbeddedAgainstSpec,
} from './anim-spec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = resolve(HERE, '..')
export const CLIENT_PATH = join(PLUGIN_ROOT, 'client.js')
export const QA_DATA_PATH = join(PLUGIN_ROOT, 'scripts', 'qa', 'anim-data.js')
export const CHARACTERS = ['human', 'cat', 'dog']
/**
 * Package-local lazy chunks, one per character. DSH's client module table
 * accepts exactly these sibling names (CLIENT_CHUNK in client/modules); the
 * browser derives the URL from client.js's own /plugins/<pkg>/ route, so the
 * chunk is read from this package directory on demand and never bundled into
 * the first-screen client.js.
 */
export const CHUNK_NAMES = {
  human: 'client.anims.human.js',
  cat: 'client.anims.cat.js',
  dog: 'client.anims.dog.js',
}
/** The module id shared by client.js and every chunk (the package name). */
export const CLIENT_MODULE_ID = 'dsh-famling'
/** @returns absolute path of one character chunk inside the plugin package. */
export function chunkPath(pluginRoot, kind) {
  return join(pluginRoot, CHUNK_NAMES[kind])
}
export const BEGIN_MARKER = '// <dsh-famling:anims:begin>'
export const END_MARKER = '// <dsh-famling:anims:end>'
export const DEFAULT_ASSETS_ROOT = resolve(PLUGIN_ROOT, '..', '..', 'desktop-games', 'public', 'assets', 'pet', 'anim')
/** The standalone famling hero keeps one tap-region document per character. */
export const DEFAULT_CHARACTERS_ROOT = resolve(PLUGIN_ROOT, '..', '..', 'desktop-games', 'public', 'characters')
export const REGION_CHARACTER_DIRS = { human: 'pet-tinglan-anim', cat: 'pet-cat', dog: 'pet-dog' }
/** Region gesture events the client knows how to play as animation clips. */
export const REGION_EVENTS = ['pat', 'stand_wag', 'chase_tail']
/**
 * Species-action events the client knows (client.js EVENT_CLIPS maps each to an
 * animation clip; talk is deliberately bubble-only and keeps the idle loop).
 * Shared with the standalone famling hero, which emits the same event names.
 */
export const ACTION_EVENTS = ['pat', 'stand_wag', 'chase_tail', 'ball_throw', 'ball_chase', 'paw_face', 'scratch', 'run', 'feed', 'talk']
const REGION_ID_RE = /^[a-z][a-z0-9_.-]{0,63}$/
const REGION_EVENT_RE = /^[a-z][a-z0-9_.-]{0,63}$/
const MAX_REGIONS = 32
const MAX_GESTURES = 64
const MAX_STATES = 8
const MAX_SAY = 120
const MAX_SAYS = 6
const MAX_ACTIONS = 8

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** CRC-32 table, shared by the PNG parser and writer. */
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

export function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Serialize one PNG chunk (length, type, payload, CRC). */
export function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'latin1')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/** Read the PNG signature and chunk list; verify every chunk CRC. */
export function parsePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG file')
  let offset = 8
  const chunks = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    const expected = buffer.readUInt32BE(offset + 8 + length)
    const actual = crc32(Buffer.concat([Buffer.from(type, 'latin1'), data]))
    if (actual !== expected) throw new Error('bad PNG CRC in chunk ' + type)
    chunks.push({ type, data })
    offset += 12 + length
    if (type === 'IEND') break
  }
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')
  if (!ihdr) throw new Error('PNG has no IHDR')
  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType: ihdr.data[9],
    interlace: ihdr.data[12],
    chunks,
  }
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

/** Un-filter the raw scanlines produced by inflate(IDAT). */
function unfilterScanlines(raw, width, height, bitDepth, channels) {
  const bitsPerPixel = bitDepth * channels
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8)
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8))
  const stride = rowBytes + 1
  if (raw.length < stride * height) throw new Error('PNG image data is truncated')
  const pixels = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * stride]
    const rowStart = y * rowBytes
    const previousStart = (y - 1) * rowBytes
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[y * stride + 1 + x]
      const left = x >= bpp ? pixels[rowStart + x - bpp] : 0
      const up = y > 0 ? pixels[previousStart + x] : 0
      const upLeft = y > 0 && x >= bpp ? pixels[previousStart + x - bpp] : 0
      let out
      if (filter === 0) out = value
      else if (filter === 1) out = value + left
      else if (filter === 2) out = value + up
      else if (filter === 3) out = value + ((left + up) >> 1)
      else if (filter === 4) out = value + paeth(left, up, upLeft)
      else throw new Error('unsupported PNG filter type ' + filter)
      pixels[rowStart + x] = out & 0xff
    }
  }
  return { pixels, rowBytes }
}

/**
 * Decode the PNG formats this pipeline uses: 8-bit RGBA (colorType 6) and
 * indexed (colorType 3, bitDepth 1/2/4/8, optional tRNS). Returns plain RGBA
 * pixels so a re-encoded frame can be compared with the source byte for byte.
 */
export function decodePng(buffer) {
  const png = parsePng(buffer)
  if (png.interlace !== 0) throw new Error('interlaced PNG is not supported')
  const idat = Buffer.concat(png.chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data))
  const raw = inflateSync(idat)
  const channels = png.colorType === 6 ? 4 : png.colorType === 3 ? 1 : 0
  if (channels === 0) throw new Error('unsupported PNG color type ' + png.colorType)
  const { pixels, rowBytes } = unfilterScanlines(raw, png.width, png.height, png.bitDepth, channels)
  const rgba = new Uint8Array(png.width * png.height * 4)
  if (png.colorType === 6) {
    if (png.bitDepth !== 8) throw new Error('only 8-bit RGBA is supported')
    rgba.set(pixels.subarray(0, rgba.length))
  } else {
    const palette = png.chunks.find((chunk) => chunk.type === 'PLTE')
    const transparency = png.chunks.find((chunk) => chunk.type === 'tRNS')
    if (!palette) throw new Error('indexed PNG has no PLTE')
    const colors = palette.data
    const alphas = transparency ? transparency.data : null
    const maxIndex = colors.length / 3 - 1
    const bits = png.bitDepth
    const mask = (1 << bits) - 1
    const perByte = 8 / bits
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const bitOffset = x * bits
        const byte = pixels[y * rowBytes + (bitOffset >> 3)]
        const shift = 8 - bits - (bitOffset & 7)
        const index = (byte >> shift) & mask
        if (index > maxIndex) throw new Error('palette index out of range')
        const target = (y * png.width + x) * 4
        rgba[target] = colors[index * 3]
        rgba[target + 1] = colors[index * 3 + 1]
        rgba[target + 2] = colors[index * 3 + 2]
        rgba[target + 3] = alphas !== null && index < alphas.length ? alphas[index] : 255
      }
    }
  }
  return { width: png.width, height: png.height, bitDepth: png.bitDepth, colorType: png.colorType, rgba }
}

/**
 * Lossless pixel-art re-encoder: indexed palette + smallest legal bit depth.
 * Alpha stays exact through tRNS (hard alpha; no anti-aliasing is introduced).
 * Returns null when the frame needs more than 256 colors.
 */
export function encodeIndexedPng(width, height, rgba) {
  const palette = []
  const lookup = new Map()
  const indices = new Uint16Array(width * height)
  for (let i = 0; i < width * height; i += 1) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    const a = rgba[i * 4 + 3]
    const key = ((r * 256 + g) * 256 + b) * 256 + a
    let index = lookup.get(key)
    if (index === undefined) {
      index = palette.length
      if (index >= 256) return null
      palette.push([r, g, b, a])
      lookup.set(key, index)
    }
    indices[i] = index
  }
  const bitDepth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8
  const rowBytes = Math.ceil((width * bitDepth) / 8)
  const raw = Buffer.alloc((rowBytes + 1) * height)
  const perByte = 8 / bitDepth
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const shift = (perByte - 1 - (x % perByte)) * bitDepth
      raw[rowStart + 1 + (x * bitDepth >> 3)] |= indices[y * width + x] << shift
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = bitDepth
  ihdr[9] = 3
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const plte = Buffer.alloc(palette.length * 3)
  let transparencyLength = 0
  for (let i = 0; i < palette.length; i += 1) {
    plte[i * 3] = palette[i][0]
    plte[i * 3 + 1] = palette[i][1]
    plte[i * 3 + 2] = palette[i][2]
    if (palette[i][3] !== 255) transparencyLength = i + 1
  }
  const chunks = [pngChunk('IHDR', ihdr), pngChunk('PLTE', plte)]
  if (transparencyLength > 0) {
    const trns = Buffer.alloc(transparencyLength)
    for (let i = 0; i < transparencyLength; i += 1) trns[i] = palette[i][3]
    chunks.push(pngChunk('tRNS', trns))
  }
  chunks.push(pngChunk('IDAT', deflateSync(raw, { level: 9 })))
  chunks.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([PNG_SIGNATURE, ...chunks])
}

function samePixels(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

/** Re-encode one source frame; falls back to the source bytes when unsafe. */
export function optimizeFrame(buffer) {
  const source = decodePng(buffer)
  if (source.colorType !== 6 || source.bitDepth !== 8) return { data: buffer, optimized: false, reason: 'source is not 8-bit RGBA' }
  const encoded = encodeIndexedPng(source.width, source.height, source.rgba)
  if (encoded === null) return { data: buffer, optimized: false, reason: 'more than 256 colors' }
  if (encoded.length >= buffer.length) return { data: buffer, optimized: false, reason: 'not smaller' }
  const roundtrip = decodePng(encoded)
  if (roundtrip.width !== source.width || roundtrip.height !== source.height || !samePixels(roundtrip.rgba, source.rgba)) {
    throw new Error('indexed re-encode changed pixels; refusing to embed')
  }
  return { data: encoded, optimized: true }
}

export function parseArgs(argv) {
  const options = { mode: 'embed', assetsRoot: null, charactersRoot: null, qa: false, optimize: true, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') options.mode = 'check'
    else if (arg === '--qa') options.qa = true
    else if (arg === '--no-optimize') options.optimize = false
    else if (arg === '--src') {
      const value = argv[i + 1]
      if (!value) throw new Error('--src requires a directory')
      options.assetsRoot = resolve(value)
      i += 1
    } else if (arg === '--characters') {
      const value = argv[i + 1]
      if (!value) throw new Error('--characters requires a directory')
      options.charactersRoot = resolve(value)
      i += 1
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('unknown argument: ' + arg)
  }
  return options
}

export function resolveAssetsRoot(option) {
  const candidates = [option, process.env.FAMLING_ANIM_DIR, DEFAULT_ASSETS_ROOT].filter((value) => typeof value === 'string' && value !== '')
  for (const candidate of candidates) if (existsSync(join(candidate, 'human', 'manifest.json'))) return resolve(candidate)
  return null
}

/** Locate the public/characters root that holds all three regions.json files. */
export function resolveCharactersRoot(option) {
  const candidates = [option, process.env.FAMLING_CHARACTERS_DIR, DEFAULT_CHARACTERS_ROOT].filter((value) => typeof value === 'string' && value !== '')
  for (const candidate of candidates) {
    const complete = Object.values(REGION_CHARACTER_DIRS).every((dir) => existsSync(join(candidate, dir, 'regions.json')))
    if (complete) return resolve(candidate)
  }
  return null
}

function regionFail(kind, message) {
  throw new Error(kind + ' regions.json: ' + message)
}

function asRegionRecord(kind, value, what) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) regionFail(kind, what + ' must be an object')
  return value
}

function asRegionString(kind, value, what, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) regionFail(kind, what + ' must be a non-empty string <= ' + max + ' chars')
  return value
}

/**
 * Random bubble lines: 2..MAX_SAYS strings. Two is the minimum that lets a
 * repeated tap/action pick a different line (the client never repeats the
 * previous line for one key), so a one-line array is a data bug, not a dialog.
 */
function asRegionSays(kind, value, what) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_SAYS) {
    regionFail(kind, what + ' must be an array of 2..' + MAX_SAYS + ' random lines')
  }
  return value.map((line, index) => asRegionString(kind, line, what + '[' + index + ']', MAX_SAY))
}

function asRegionFinite(kind, value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) regionFail(kind, what + ' must be a finite number')
  return value
}

function asRegionRect(kind, value, what) {
  if (!Array.isArray(value) || value.length !== 4) regionFail(kind, what + ' must be [x,y,width,height]')
  const rect = value.map((part, index) => asRegionFinite(kind, part, what + '[' + index + ']'))
  if (rect[2] <= 0 || rect[3] <= 0) regionFail(kind, what + ' width/height must be > 0')
  return rect
}

/**
 * Read + validate one character's regions.json (the famling hero tap-region
 * contract: version/canvas/regions/gestures, art pixels, data-driven reactions).
 * Unknown fields are dropped so the embedded data is a strict, stable subset
 * and `--check` can compare it deterministically.
 */
export function loadRegionConfig(charactersRoot, kind) {
  const dir = REGION_CHARACTER_DIRS[kind]
  if (!dir) throw new Error('no regions.json character dir for ' + kind)
  if (!charactersRoot) throw new Error(kind + ': character regions root is not available')
  const regionsPath = join(charactersRoot, dir, 'regions.json')
  if (!existsSync(regionsPath)) regionFail(kind, 'missing file ' + regionsPath)
  let raw
  try {
    raw = JSON.parse(readFileSync(regionsPath, 'utf8'))
  } catch (error) {
    regionFail(kind, 'cannot parse ' + regionsPath + ': ' + error.message)
  }
  if (raw.version !== 1) regionFail(kind, 'version must be 1')
  if (!Array.isArray(raw.canvas) || raw.canvas.length !== 2) regionFail(kind, 'canvas must be [width,height]')
  const canvas = raw.canvas.map((part, index) => asRegionFinite(kind, part, 'canvas[' + index + ']'))
  if (canvas[0] < 16 || canvas[1] < 16 || canvas[0] > 1024 || canvas[1] > 1024) regionFail(kind, 'canvas must be 16..1024 art px')
  if (!Array.isArray(raw.regions) || raw.regions.length === 0 || raw.regions.length > MAX_REGIONS) regionFail(kind, 'regions must be a non-empty array (<= ' + MAX_REGIONS + ')')
  const ids = new Set()
  const regions = raw.regions.map((entry, index) => {
    const region = asRegionRecord(kind, entry, 'regions[' + index + ']')
    const id = asRegionString(kind, region.id, 'regions[' + index + '].id', 64)
    if (!REGION_ID_RE.test(id)) regionFail(kind, 'regions[' + index + '].id "' + id + '" is not a safe id')
    if (ids.has(id)) regionFail(kind, 'duplicate region id "' + id + '"')
    ids.add(id)
    const rect = asRegionRect(kind, region.rect, 'regions[' + index + '].rect')
    if (rect[0] < 0 || rect[1] < 0 || rect[0] + rect[2] > canvas[0] || rect[1] + rect[3] > canvas[1]) {
      regionFail(kind, 'regions[' + index + '].rect must stay inside the ' + canvas[0] + 'x' + canvas[1] + ' canvas')
    }
    const label = region.label === undefined ? undefined : asRegionString(kind, region.label, 'regions[' + index + '].label', 32)
    const priority = region.priority === undefined ? undefined : asRegionFinite(kind, region.priority, 'regions[' + index + '].priority')
    return { id, ...(label !== undefined ? { label } : {}), rect, ...(priority !== undefined ? { priority } : {}) }
  })
  if (!Array.isArray(raw.gestures) || raw.gestures.length > MAX_GESTURES) regionFail(kind, 'gestures must be an array (<= ' + MAX_GESTURES + ')')
  const gestures = raw.gestures.map((entry, index) => {
    const rule = asRegionRecord(kind, entry, 'gestures[' + index + ']')
    const region = asRegionString(kind, rule.region, 'gestures[' + index + '].region', 64)
    if (!ids.has(region)) regionFail(kind, 'gestures[' + index + '].region "' + region + '" is not declared')
    const event = asRegionString(kind, rule.event, 'gestures[' + index + '].event', 64)
    if (!REGION_EVENT_RE.test(event)) regionFail(kind, 'gestures[' + index + '].event "' + event + '" is not a safe event name')
    if (!REGION_EVENTS.includes(event)) regionFail(kind, 'gestures[' + index + '].event "' + event + '" has no client clip mapping')
    const gesture = rule.gesture === undefined ? undefined : asRegionString(kind, rule.gesture, 'gestures[' + index + '].gesture', 24)
    let states
    if (rule.states !== undefined) {
      if (!Array.isArray(rule.states) || rule.states.length === 0 || rule.states.length > MAX_STATES) {
        regionFail(kind, 'gestures[' + index + '].states must be a non-empty array (<= ' + MAX_STATES + ')')
      }
      states = rule.states.map((state, stateIndex) => {
        const value = asRegionString(kind, state, 'gestures[' + index + '].states[' + stateIndex + ']', 64)
        if (!REGION_ID_RE.test(value)) regionFail(kind, 'gestures[' + index + '].states[' + stateIndex + '] "' + value + '" is not a safe state name')
        return value
      })
    }
    // Random bubble lines. The legacy single-string say field from the
    // first region contract is normalized to a one-line says array.
    const legacySay = typeof rule.say === 'string' ? [rule.say] : undefined
    let says
    if (rule.says !== undefined) says = asRegionSays(kind, rule.says, 'gestures[' + index + '].says')
    else if (legacySay !== undefined) says = asRegionSays(kind, legacySay, 'gestures[' + index + '].say')
    else regionFail(kind, 'gestures[' + index + '] must define says (or the legacy say string)')
    return { region, ...(states !== undefined ? { states } : {}), ...(gesture !== undefined ? { gesture } : {}), event, says }
  })
  let actions
  if (raw.actions !== undefined) {
    if (!Array.isArray(raw.actions) || raw.actions.length === 0 || raw.actions.length > MAX_ACTIONS) {
      regionFail(kind, 'actions must be a non-empty array (<= ' + MAX_ACTIONS + ')')
    }
    const actionIds = new Set()
    actions = raw.actions.map((entry, index) => {
      const action = asRegionRecord(kind, entry, 'actions[' + index + ']')
      const id = asRegionString(kind, action.id, 'actions[' + index + '].id', 64)
      if (!REGION_ID_RE.test(id)) regionFail(kind, 'actions[' + index + '].id "' + id + '" is not a safe id')
      if (actionIds.has(id)) regionFail(kind, 'duplicate action id "' + id + '"')
      actionIds.add(id)
      const label = asRegionString(kind, action.label, 'actions[' + index + '].label', 32)
      const event = asRegionString(kind, action.event, 'actions[' + index + '].event', 64)
      if (!REGION_EVENT_RE.test(event)) regionFail(kind, 'actions[' + index + '].event "' + event + '" is not a safe event name')
      if (!ACTION_EVENTS.includes(event)) regionFail(kind, 'actions[' + index + '].event "' + event + '" has no client clip mapping')
      let followUpEvent
      if (action.followUpEvent !== undefined) {
        followUpEvent = asRegionString(kind, action.followUpEvent, 'actions[' + index + '].followUpEvent', 64)
        if (!REGION_EVENT_RE.test(followUpEvent)) regionFail(kind, 'actions[' + index + '].followUpEvent "' + followUpEvent + '" is not a safe event name')
        if (!ACTION_EVENTS.includes(followUpEvent)) regionFail(kind, 'actions[' + index + '].followUpEvent "' + followUpEvent + '" has no client clip mapping')
        if (followUpEvent === event) regionFail(kind, 'actions[' + index + '].followUpEvent must differ from event')
      }
      let followUpMs
      if (action.followUpMs !== undefined) {
        followUpMs = asRegionFinite(kind, action.followUpMs, 'actions[' + index + '].followUpMs')
        if (followUpMs < 0 || followUpMs > 5000) regionFail(kind, 'actions[' + index + '].followUpMs must be 0..5000')
        if (followUpEvent === undefined) regionFail(kind, 'actions[' + index + '].followUpMs requires followUpEvent')
      }
      const says = asRegionSays(kind, action.says, 'actions[' + index + '].says')
      return { id, label, event, ...(followUpEvent !== undefined ? { followUpEvent } : {}), ...(followUpMs !== undefined ? { followUpMs } : {}), says }
    })
  }
  return { version: 1, canvas: [canvas[0], canvas[1]], regions, gestures, ...(actions !== undefined ? { actions } : {}) }
}

function loadPack(assetsRoot, kind) {
  const manifestPath = join(assetsRoot, kind, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const anim = manifest.anim
  if (!anim || anim.contract !== 'famling.pet-anim/0.1') throw new Error(kind + ': unsupported anim contract')
  if (!Array.isArray(manifest.canvas) || manifest.canvas[0] !== 96 || manifest.canvas[1] !== 96) throw new Error(kind + ': canvas is not 96x96')
  const clips = anim.clips
  if (!clips || typeof clips !== 'object') throw new Error(kind + ': manifest has no anim.clips')
  const frames = []
  let total = 0
  for (const [clipId, clip] of Object.entries(clips)) {
    if (!Number.isInteger(clip.frames) || clip.frames < 1) throw new Error(kind + '/' + clipId + ': invalid frame count')
    if (!Number.isInteger(clip.fps) || clip.fps < 1 || clip.fps > 240) throw new Error(kind + '/' + clipId + ': invalid fps')
    if (clip.holdMs !== undefined) {
      if (!Array.isArray(clip.holdMs) || clip.holdMs.length !== clip.frames) {
        throw new Error(kind + '/' + clipId + ': holdMs must have exactly one duration per frame')
      }
      for (const value of clip.holdMs) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 30 || value > 60_000) {
          throw new Error(kind + '/' + clipId + ': holdMs entries must be finite 30..60000 ms')
        }
      }
    }
    if (clip.durationMs !== undefined) {
      if (typeof clip.durationMs !== 'number' || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) {
        throw new Error(kind + '/' + clipId + ': durationMs must be a positive finite number')
      }
      if (Array.isArray(clip.holdMs)) {
        const held = clip.holdMs.reduce((sum, value) => sum + value, 0)
        if (Math.abs(held - clip.durationMs) > 1) {
          throw new Error(kind + '/' + clipId + ': durationMs ' + clip.durationMs + ' does not match the sum of holdMs ' + held)
        }
      }
    }
    for (let index = 0; index < clip.frames; index += 1) {
      const relativePath = clipId + '/' + clipId + '_' + String(index).padStart(2, '0') + '.png'
      const absolutePath = join(assetsRoot, kind, relativePath)
      if (!existsSync(absolutePath)) throw new Error(kind + ': missing frame ' + relativePath)
      frames.push({ clipId, index, relativePath, absolutePath, spriteKey: kind + '/' + clipId + '/' + index })
      total += 1
    }
  }
  if (Array.isArray(manifest.assets)) {
    const declared = new Set(manifest.assets)
    for (const frame of frames) if (!declared.has(frame.relativePath)) throw new Error(kind + ': manifest.assets misses ' + frame.relativePath)
    if (manifest.assets.length !== total) throw new Error(kind + ': manifest.assets count does not match frame count')
  }
  return { manifest, clips, frames }
}

/**
 * Load + cross-validate the three packs against the shared anim contract.
 *
 * Frame counts are deliberately NOT hardcoded: every clip's frame count comes
 * from its own manifest (dog/human 68 total today, cat 72 after the 10-frame
 * stand_wag), and a clip's fps/holdMs may differ per species. Only the clip-ID
 * set is shared, because the plugin's hand-written EVENT_CLIPS/menu mapping
 * addresses clips by id.
 */
export function loadPacks(assetsRoot) {
  const packs = {}
  for (const kind of CHARACTERS) packs[kind] = loadPack(assetsRoot, kind)
  const reference = packs[CHARACTERS[0]].clips
  const referenceIds = Object.keys(reference).sort()
  if (referenceIds.length === 0) throw new Error(CHARACTERS[0] + ': manifest has no clips')
  for (const kind of CHARACTERS) {
    const ids = Object.keys(packs[kind].clips).sort()
    if (ids.join(',') !== referenceIds.join(',')) throw new Error(kind + ': clip ids differ from ' + CHARACTERS[0])
  }
  return packs
}

function validatePolicies(anims) {
  const expected = { human: { canTts: true, bubble: 'speech' }, cat: { canTts: false, bubble: 'thought' }, dog: { canTts: false, bubble: 'thought' } }
  for (const kind of CHARACTERS) {
    const data = anims[kind]
    const want = expected[kind]
    if (data.canTts !== want.canTts || data.bubble !== want.bubble) {
      throw new Error(kind + ': bubble/TTS policy must be ' + JSON.stringify(want) + ', got ' + JSON.stringify({ canTts: data.canTts, bubble: data.bubble }))
    }
  }
}

/** Build the in-memory { anims, sprites } payload from the asset pack. */
export function buildAnimationData(assetsRoot, options = {}) {
  const optimize = options.optimize !== false
  const packs = loadPacks(assetsRoot)
  const charactersRoot = resolveCharactersRoot(Object.prototype.hasOwnProperty.call(options, 'charactersRoot') ? options.charactersRoot : undefined)
  if (!charactersRoot) throw new Error('character tap regions not found; pass --characters DIR or set FAMLING_CHARACTERS_DIR')
  const anims = {}
  const sprites = {}
  const sourceFrames = {}
  const hash = createHash('sha256')
  const stats = []
  for (const kind of CHARACTERS) {
    const pack = packs[kind]
    const regions = loadRegionConfig(charactersRoot, kind)
    const canvas = pack.manifest.canvas
    if (regions.canvas[0] !== canvas[0] || regions.canvas[1] !== canvas[1]) {
      throw new Error(kind + ': regions.json canvas ' + regions.canvas.join('x') + ' differs from the animation canvas ' + canvas.join('x'))
    }
    hash.update('regions/' + kind + ':')
    hash.update(JSON.stringify(regions))
    // Clip metadata (fps/loop/holdMs/durationMs) is part of the source hash too:
    // a timing-only manifest change must invalidate --check as well.
    hash.update('clips/' + kind + ':')
    hash.update(JSON.stringify(pack.clips))
    const clips = {}
    for (const [clipId, clip] of Object.entries(pack.clips)) {
      clips[clipId] = { frames: [], fps: clip.fps, loop: clip.loop === true, layer: clip.layer || 'base', category: clip.category || '', priority: Number(clip.priority) || 0 }
      if (Array.isArray(clip.holdMs)) clips[clipId].holdMs = clip.holdMs.slice()
      if (Number.isFinite(clip.durationMs) && clip.durationMs > 0) clips[clipId].durationMs = clip.durationMs
    }
    let sourceBytes = 0
    let embeddedBytes = 0
    let base64Chars = 0
    let optimizedFrames = 0
    const sourceFrameSha256 = {}
    for (const frame of pack.frames) {
      const buffer = readFileSync(frame.absolutePath)
      hash.update(kind + '/' + frame.relativePath + ':')
      hash.update(buffer)
      sourceFrameSha256[frame.relativePath] = createHash('sha256').update(buffer).digest('hex')
      const result = optimize ? optimizeFrame(buffer) : { data: buffer, optimized: false }
      const base64 = result.data.toString('base64')
      sprites[frame.spriteKey] = base64
      clips[frame.clipId].frames.push(frame.spriteKey)
      sourceBytes += buffer.length
      embeddedBytes += result.data.length
      base64Chars += base64.length
      if (result.optimized) optimizedFrames += 1
    }
    const voice = pack.manifest.anim.voice || {}
    const microActions = (pack.manifest.anim.randomMicroActions || []).filter((clipId) => clips[clipId] && clipId !== 'idle' && clipId !== 'idle_blink')
    anims[kind] = {
      clips,
      regions,
      // Species-specific menu actions (dog fetch/retrieve, cat stretch/wash,
      // human paper/wave/tidy/talk), rendered data-driven by the client.
      actions: regions.actions,
      bubble: voice.bubble === 'thought' ? 'thought' : 'speech',
      canTts: voice.canTts === true,
      voiceMode: typeof voice.mode === 'string' ? voice.mode : 'none',
      microActions,
      license: typeof pack.manifest.license === 'string' ? pack.manifest.license : '',
    }
    sourceFrames[kind] = sourceFrameSha256
    stats.push({ kind, frames: pack.frames.length, sourceBytes, embeddedBytes, base64Chars, optimizedFrames })
  }
  validatePolicies(anims)
  return { anims, sprites, stats, sourceFrames, sourceSha256: hash.digest('hex'), charactersRoot }
}

/**
 * Render the generated first-screen metadata block, including both marker lines.
 * @param data - buildAnimationData() output
 * @param chunkContents - renderChunks() output; hashed into the header so a
 *   chunk-only rebuild still changes client.js (and therefore the DSH row
 *   revision that versions the chunk URL)
 */
export function renderBlock(data, chunkContents = {}) {
  const totalFrames = data.stats.reduce((sum, item) => sum + item.frames, 0)
  const totalBase64 = data.stats.reduce((sum, item) => sum + item.base64Chars, 0)
  const clipCount = Object.keys(data.anims[CHARACTERS[0]].clips).length
  const policy = {}
  const chunks = {}
  const chunkSummary = []
  for (const kind of CHARACTERS) {
    policy[kind] = { canTts: data.anims[kind].canTts === true, bubble: data.anims[kind].bubble }
    chunks[kind] = './' + CHUNK_NAMES[kind]
    const stat = data.stats.find((item) => item.kind === kind)
    chunkSummary.push(CHUNK_NAMES[kind] + ' (' + stat.frames + ' frames / ' + stat.base64Chars + ' base64 chars)')
  }
  const lines = []
  lines.push('    ' + BEGIN_MARKER)
  lines.push('    // @generated by scripts/embed-anims.mjs - do not edit this block by hand.')
  lines.push('    // source: ../../desktop-games/public/assets/pet/anim (96x96 RGBA PNG; losslessly re-encoded indexed PNG, hard alpha kept)')
  lines.push('    // regions: ../../desktop-games/public/characters/{pet-tinglan-anim,pet-cat,pet-dog}/regions.json (head/body/tail tap zones, random says, species actions, idle gating)')
  lines.push('    // source-sha256: ' + data.sourceSha256)
  lines.push('    // characters: human/cat/dog - ' + clipCount + ' clips - ' + totalFrames + ' frames - base64 chars: ' + totalBase64)
  lines.push('    // sprite payload is not embedded here: one lazily loaded package-local chunk per character - ' + chunkSummary.join(', '))
  // Hash every lazy chunk into the entry: a chunk-only rebuild changes client.js
  // too, so the DSH row revision (and the ?rev= that versions the chunk URL)
  // advances and a browser never keeps an immutable stale chunk.
  const chunkHashes = CHARACTERS.map((kind) => kind + '=' + createHash('sha256').update(chunkContents[kind] || '').digest('hex'))
  lines.push('    // chunk-sha256: ' + chunkHashes.join(' '))
  lines.push('    const ANIMS = {}')
  lines.push('    const SPRITES = {}')
  lines.push('    const CHARACTER_POLICY = ' + JSON.stringify(policy))
  lines.push('    const CHARACTER_CHUNKS = ' + JSON.stringify(chunks))
  lines.push('    ' + END_MARKER)
  return lines.join('\n') + '\n'
}

/**
 * Render one lazily loaded character chunk. The chunk is a package-local DSH
 * client chunk: it registers itself in the page module table and exports that
 * character's { anims, sprites }. client.js loads it with require.async only
 * when the character becomes visible, so a session that never switches character
 * never downloads the other two payloads.
 */
export function renderChunk(data, kind) {
  const anim = data.anims[kind]
  const sprites = {}
  let frames = 0
  let base64Chars = 0
  for (const clip of Object.values(anim.clips)) {
    for (const frameKey of clip.frames) {
      const base64 = data.sprites[frameKey]
      if (typeof base64 !== 'string' || base64.length === 0) throw new Error(kind + ': missing sprite ' + frameKey)
      sprites[frameKey] = base64
      frames += 1
      base64Chars += base64.length
    }
  }
  const lines = []
  lines.push('/* <dsh-famling:anims:chunk ' + kind + '> @generated by scripts/embed-anims.mjs - do not edit this chunk by hand.')
  lines.push(' * source-sha256: ' + data.sourceSha256)
  lines.push(' * character: ' + kind + ' - ' + frames + ' frames - base64 chars: ' + base64Chars)
  lines.push(' * Package-local DSH chunk: the local DSH host serves it from this package directory.')
  lines.push(' * Loaded on demand by client.js through require.async, never fetched from a network/CDN. */')
  lines.push('window.__ModuleLoader__.load({')
  lines.push('  id: ' + JSON.stringify(CLIENT_MODULE_ID) + ',')
  lines.push('  chunk: ' + JSON.stringify(CHUNK_NAMES[kind]) + ',')
  lines.push('  factory(require) {')
  lines.push('    return {')
  lines.push('      anims: ' + JSON.stringify(anim) + ',')
  lines.push('      sprites: {')
  const entries = Object.entries(sprites)
  for (let index = 0; index < entries.length; index += 1) {
    const [key, value] = entries[index]
    lines.push('        ' + JSON.stringify(key) + ': ' + JSON.stringify(value) + (index === entries.length - 1 ? '' : ','))
  }
  lines.push('      },')
  lines.push('    }')
  lines.push('  },')
  lines.push('})')
  return lines.join('\n') + '\n'
}

/** Render every character chunk keyed by kind. */
export function renderChunks(data) {
  /** @type {Record<string, string>} */
  const chunks = {}
  for (const kind of CHARACTERS) chunks[kind] = renderChunk(data, kind)
  return chunks
}

/** Split client.js into lines and locate the two marker lines. */
export function locateBlock(source) {
  const lines = source.split('\n')
  const begin = lines.findIndex((line) => line.trim() === BEGIN_MARKER)
  const end = lines.findIndex((line) => line.trim() === END_MARKER)
  if (begin === -1 || end === -1) throw new Error('client.js is missing the ' + BEGIN_MARKER + ' / ' + END_MARKER + ' markers')
  if (end <= begin) throw new Error('client.js animation markers are out of order')
  return { lines, begin, end }
}

export function extractBlock(source) {
  const { lines, begin, end } = locateBlock(source)
  return lines.slice(begin, end + 1).join('\n') + '\n'
}

export function injectBlock(source, block) {
  const { lines, begin, end } = locateBlock(source)
  const blockLines = block.split('\n')
  if (blockLines[blockLines.length - 1] === '') blockLines.pop()
  return [...lines.slice(0, begin), ...blockLines, ...lines.slice(end + 1)].join('\n')
}

export function writeQaData(data) {
  const payload = { sourceSha256: data.sourceSha256, anims: data.anims, sprites: data.sprites }
  const body = '// @generated by scripts/embed-anims.mjs - open scripts/qa/index.html over file:// or a static server.\nwindow.__FAMLING_ANIM_DATA__ = ' + JSON.stringify(payload) + '\n'
  mkdirSync(dirname(QA_DATA_PATH), { recursive: true })
  writeFileSync(QA_DATA_PATH, body)
  return QA_DATA_PATH
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  return (bytes / 1024).toFixed(1) + ' KiB'
}

function printSummary(data, assetsRoot, extra = {}) {
  console.log('[embed-anims] assets: ' + assetsRoot)
  if (data.charactersRoot) console.log('[embed-anims] regions: ' + data.charactersRoot)
  console.log('[embed-anims] source sha256: ' + data.sourceSha256.slice(0, 16) + '...')
  for (const item of data.stats) {
    console.log('[embed-anims] ' + item.kind.padEnd(5) + ' frames=' + item.frames + ' raw=' + formatBytes(item.sourceBytes) + ' embedded=' + formatBytes(item.embeddedBytes) + ' base64=' + formatBytes(item.base64Chars) + ' reencoded=' + item.optimizedFrames + '/' + item.frames)
  }
  const totalFrames = data.stats.reduce((sum, item) => sum + item.frames, 0)
  const totalSource = data.stats.reduce((sum, item) => sum + item.sourceBytes, 0)
  const totalEmbedded = data.stats.reduce((sum, item) => sum + item.embeddedBytes, 0)
  const totalBase64 = data.stats.reduce((sum, item) => sum + item.base64Chars, 0)
  console.log('[embed-anims] total frames=' + totalFrames + ' raw=' + formatBytes(totalSource) + ' embedded=' + formatBytes(totalEmbedded) + ' base64=' + formatBytes(totalBase64))
  if (extra.clientBefore !== undefined) {
    console.log('[embed-anims] client.js ' + formatBytes(extra.clientBefore) + ' -> ' + formatBytes(extra.clientAfter) + (extra.changed ? ' (updated)' : ' (unchanged)'))
  }
  if (Array.isArray(extra.chunks)) {
    for (const chunk of extra.chunks) {
      console.log('[embed-anims] lazy chunk ' + chunk.fileName + ' ' + formatBytes(chunk.bytes) + (chunk.changed ? ' (updated)' : ' (unchanged)'))
    }
    const entryBytes = extra.clientAfter
    const firstPaint = entryBytes + (extra.chunks.find((chunk) => chunk.kind === 'human')?.bytes ?? 0)
    console.log('[embed-anims] first-screen payload: client.js ' + formatBytes(entryBytes) + '; + default character chunk ' + formatBytes(firstPaint) + ' (only when used)')
  }
  if (extra.qaPath) console.log('[embed-anims] qa data: ' + extra.qaPath)
  if (extra.specPath) {
    console.log('[embed-anims] vendored spec ' + extra.specPath + ' ' + formatBytes(extra.specBytes) + (extra.specChanged ? ' (updated)' : ' (unchanged)'))
    console.log('[embed-anims] vendored ' + animationSpecSummary(extra.spec))
  }
}

/** Read a file as UTF-8, or null when it is absent. */
function readFileIfExists(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function generate(options = {}) {
  const pluginRoot = options.pluginRoot || PLUGIN_ROOT
  const clientPath = options.clientPath || CLIENT_PATH
  const assetsRoot = resolveAssetsRoot(options.assetsRoot)
  if (!assetsRoot) throw new Error('animation assets not found; pass --src DIR or set FAMLING_ANIM_DIR')
  const data = buildAnimationData(assetsRoot, { optimize: options.optimize !== false, charactersRoot: options.charactersRoot })
  const chunkContents = renderChunks(data)
  const block = renderBlock(data, chunkContents)
  const source = readFileSync(clientPath, 'utf8')
  const next = injectBlock(source, block)
  const chunks = CHARACTERS.map((kind) => {
    const path = chunkPath(pluginRoot, kind)
    return { kind, path, fileName: CHUNK_NAMES[kind], content: chunkContents[kind], previous: readFileIfExists(path) }
  })
  // Vendored spec/LOCK (MB-004): the semantic contract + SHA-256 locks that a
  // clean plugin-only checkout validates against when the private art checkout
  // is absent. It is refreshed together with the chunks so it cannot drift.
  const spec = buildAnimationSpec({ data, chunkContents })
  const specText = renderAnimationSpec(spec)
  const specPath = specPathFor(pluginRoot)
  return {
    data,
    block,
    source,
    next,
    chunks,
    spec,
    specText,
    specPath,
    specPrevious: readFileIfExists(specPath),
    assetsRoot,
    pluginRoot,
    clientPath,
    charactersRoot: data.charactersRoot,
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error('[embed-anims] ' + error.message)
    process.exitCode = 1
    return
  }
  if (options.help) {
    console.log('usage: node scripts/embed-anims.mjs [--check] [--qa] [--no-optimize] [--src DIR] [--characters DIR]')
    console.log('  standalone (no private checkout): --check validates the committed chunks against ' + SPEC_RELATIVE_PATH)
    return
  }
  // Standalone mode (MB-004): no private art checkout. --check stays a real
  // gate: the committed client.js + lazy chunks must match the vendored
  // semantic spec/LOCK. A missing or tampered spec fails; it never skips.
  if (options.mode === 'check' && resolveAssetsRoot(options.assetsRoot) === null) {
    try {
      const { path, spec } = readAnimationSpec(PLUGIN_ROOT)
      const checked = validateEmbeddedAgainstSpec({ pluginRoot: PLUGIN_ROOT, spec })
      if (!checked.ok) {
        console.error('[embed-anims] committed animation artifacts do not match the vendored spec (' + path + '):')
        for (const problem of checked.errors) console.error('[embed-anims]   - ' + problem)
        process.exitCode = 1
        return
      }
      console.log('[embed-anims] standalone spec mode: private animation assets not present (no skip)')
      console.log('[embed-anims] vendored ' + animationSpecSummary(spec))
      console.log('[embed-anims] check ok: client.js + ' + checked.stats.characters + ' lazy character chunks match the vendored spec (' + checked.stats.frames + ' frames)')
      return
    } catch (error) {
      console.error('[embed-anims] ' + error.message)
      process.exitCode = 1
      return
    }
  }
  try {
    const result = generate(options)
    const base = {
      clientBefore: Buffer.byteLength(result.source),
      clientAfter: Buffer.byteLength(result.next),
      changed: result.next !== result.source,
      chunks: result.chunks.map((chunk) => ({
        kind: chunk.kind,
        fileName: chunk.fileName,
        bytes: Buffer.byteLength(chunk.content),
        changed: chunk.previous !== chunk.content,
      })),
      specPath: result.specPath,
      specChanged: result.specPrevious !== result.specText,
      specBytes: Buffer.byteLength(result.specText),
      spec: result.spec,
    }
    const stale = [
      ...(base.changed ? [result.clientPath] : []),
      ...result.chunks.filter((chunk) => chunk.previous !== chunk.content).map((chunk) => chunk.path),
      ...(base.specChanged ? [result.specPath] : []),
    ]
    if (options.mode === 'check') {
      if (stale.length > 0) {
        console.error('[embed-anims] generated animation artifacts are stale - run npm run embed:anims')
        for (const path of stale) console.error('[embed-anims]   stale: ' + path)
        process.exitCode = 1
        return
      }
      const checked = validateEmbeddedAgainstSpec({ pluginRoot: result.pluginRoot, spec: result.spec })
      if (!checked.ok) {
        console.error('[embed-anims] committed animation artifacts do not match the vendored spec:')
        for (const problem of checked.errors) console.error('[embed-anims]   - ' + problem)
        process.exitCode = 1
        return
      }
      if (options.qa) base.qaPath = writeQaData(result.data)
      printSummary(result.data, result.assetsRoot, base)
      console.log('[embed-anims] check ok: client.js + ' + result.chunks.length + ' lazy character chunks match the asset pack and the vendored spec')
      return
    }
    // Write the lazy chunks first so the client entry never references a missing file.
    for (const chunk of result.chunks) if (chunk.previous !== chunk.content) writeFileSync(chunk.path, chunk.content)
    if (base.changed) writeFileSync(result.clientPath, result.next)
    if (base.specChanged) {
      mkdirSync(dirname(result.specPath), { recursive: true })
      writeFileSync(result.specPath, result.specText)
    }
    if (options.qa) base.qaPath = writeQaData(result.data)
    printSummary(result.data, result.assetsRoot, base)
  } catch (error) {
    console.error('[embed-anims] ' + error.message)
    process.exitCode = 1
  }
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) await main()
