#!/usr/bin/env node
/**
 * Embed the three 96x96 pet animation packs (human / cat / dog) into client.js.
 *
 * Source of truth:
 *   ../../desktop-games/public/assets/pet/anim/{human,cat,dog}/
 *     manifest.json + <clip>/<clip>_NN.png   (12 clips / 68 frames each, 96x96 RGBA)
 *
 * What it does:
 *   1. reads the three manifests and validates the shared anim contract;
 *   2. reads every PNG and (by default) re-encodes it losslessly as an indexed
 *      PNG with the smallest bit depth - pixel-identical, roughly half the bytes;
 *   3. renders a generated JS block with `const ANIMS` (per-character clip table
 *      + bubble/TTS policy) and `const SPRITES` (base64 PNG data, one key per
 *      frame) and injects it between the two marker comments in client.js.
 *
 * The block is generated data: never hand-edit it. Re-run this script instead.
 *
 * Usage:
 *   node scripts/embed-anims.mjs                 # inject / refresh client.js
 *   node scripts/embed-anims.mjs --check         # fail if client.js is stale
 *   node scripts/embed-anims.mjs --qa            # also write scripts/qa/anim-data.js
 *   node scripts/embed-anims.mjs --no-optimize   # embed source PNG bytes verbatim
 *   node scripts/embed-anims.mjs --src DIR       # explicit anim asset root
 *
 * The asset root defaults to FAMLING_ANIM_DIR, else the sibling private repo
 * checkout ../../desktop-games/public/assets/pet/anim. No network, no deps.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = resolve(HERE, '..')
export const CLIENT_PATH = join(PLUGIN_ROOT, 'client.js')
export const QA_DATA_PATH = join(PLUGIN_ROOT, 'scripts', 'qa', 'anim-data.js')
export const CHARACTERS = ['human', 'cat', 'dog']
export const BEGIN_MARKER = '// <dsh-famling:anims:begin>'
export const END_MARKER = '// <dsh-famling:anims:end>'
export const DEFAULT_ASSETS_ROOT = resolve(PLUGIN_ROOT, '..', '..', 'desktop-games', 'public', 'assets', 'pet', 'anim')

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
  const options = { mode: 'embed', assetsRoot: null, qa: false, optimize: true, help: false }
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

/** Load + cross-validate the three packs against the shared anim contract. */
export function loadPacks(assetsRoot) {
  const packs = {}
  for (const kind of CHARACTERS) packs[kind] = loadPack(assetsRoot, kind)
  const reference = packs[CHARACTERS[0]].clips
  const referenceIds = Object.keys(reference)
  if (referenceIds.length !== 12) throw new Error('expected 12 clips, got ' + referenceIds.length)
  for (const kind of CHARACTERS) {
    const clips = packs[kind].clips
    const ids = Object.keys(clips)
    if (ids.join(',') !== referenceIds.join(',')) throw new Error(kind + ': clip ids differ from ' + CHARACTERS[0])
    for (const clipId of referenceIds) {
      const expected = reference[clipId]
      const actual = clips[clipId]
      if (actual.frames !== expected.frames || actual.fps !== expected.fps || Boolean(actual.loop) !== Boolean(expected.loop)) {
        throw new Error(kind + '/' + clipId + ': frame count/fps/loop differs from ' + CHARACTERS[0])
      }
    }
    const totalFrames = packs[kind].frames.length
    if (totalFrames !== 68) throw new Error(kind + ': expected 68 frames, got ' + totalFrames)
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
  const anims = {}
  const sprites = {}
  const hash = createHash('sha256')
  const stats = []
  for (const kind of CHARACTERS) {
    const pack = packs[kind]
    const clips = {}
    for (const [clipId, clip] of Object.entries(pack.clips)) {
      clips[clipId] = { frames: [], fps: clip.fps, loop: clip.loop === true, layer: clip.layer || 'base', category: clip.category || '', priority: Number(clip.priority) || 0 }
      if (Array.isArray(clip.holdMs)) clips[clipId].holdMs = clip.holdMs.slice()
    }
    let sourceBytes = 0
    let embeddedBytes = 0
    let base64Chars = 0
    let optimizedFrames = 0
    for (const frame of pack.frames) {
      const buffer = readFileSync(frame.absolutePath)
      hash.update(kind + '/' + frame.relativePath + ':')
      hash.update(buffer)
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
      bubble: voice.bubble === 'thought' ? 'thought' : 'speech',
      canTts: voice.canTts === true,
      voiceMode: typeof voice.mode === 'string' ? voice.mode : 'none',
      microActions,
      license: typeof pack.manifest.license === 'string' ? pack.manifest.license : '',
    }
    stats.push({ kind, frames: pack.frames.length, sourceBytes, embeddedBytes, base64Chars, optimizedFrames })
  }
  validatePolicies(anims)
  return { anims, sprites, stats, sourceSha256: hash.digest('hex') }
}

/** Render the generated block, including both marker lines. */
export function renderBlock(data) {
  const totalFrames = data.stats.reduce((sum, item) => sum + item.frames, 0)
  const totalBase64 = data.stats.reduce((sum, item) => sum + item.base64Chars, 0)
  const lines = []
  lines.push('    ' + BEGIN_MARKER)
  lines.push('    // @generated by scripts/embed-anims.mjs - do not edit this block by hand.')
  lines.push('    // source: ../../desktop-games/public/assets/pet/anim (96x96 RGBA PNG; losslessly re-encoded indexed PNG, hard alpha kept)')
  lines.push('    // source-sha256: ' + data.sourceSha256)
  lines.push('    // characters: human/cat/dog - 12 clips - ' + totalFrames + ' frames - base64 chars: ' + totalBase64)
  lines.push('    const ANIMS = ' + JSON.stringify(data.anims, null, 2).split('\n').join('\n    '))
  lines.push('    const SPRITES = {')
  const entries = Object.entries(data.sprites)
  for (let index = 0; index < entries.length; index += 1) {
    const [key, value] = entries[index]
    lines.push('      ' + JSON.stringify(key) + ': ' + JSON.stringify(value) + (index === entries.length - 1 ? '' : ','))
  }
  lines.push('    }')
  lines.push('    ' + END_MARKER)
  return lines.join('\n') + '\n'
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
  if (extra.qaPath) console.log('[embed-anims] qa data: ' + extra.qaPath)
}

export function generate(options = {}) {
  const assetsRoot = resolveAssetsRoot(options.assetsRoot)
  if (!assetsRoot) throw new Error('animation assets not found; pass --src DIR or set FAMLING_ANIM_DIR')
  const data = buildAnimationData(assetsRoot, { optimize: options.optimize !== false })
  const block = renderBlock(data)
  const source = readFileSync(CLIENT_PATH, 'utf8')
  const next = injectBlock(source, block)
  return { data, block, source, next, assetsRoot }
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
    console.log('usage: node scripts/embed-anims.mjs [--check] [--qa] [--no-optimize] [--src DIR]')
    return
  }
  try {
    const result = generate(options)
    const changed = result.next !== result.source
    const base = { clientBefore: Buffer.byteLength(result.source), clientAfter: Buffer.byteLength(result.next), changed }
    if (options.mode === 'check') {
      if (changed) {
        console.error('[embed-anims] client.js animation block is stale - run npm run embed:anims')
        process.exitCode = 1
        return
      }
      if (options.qa) base.qaPath = writeQaData(result.data)
      printSummary(result.data, result.assetsRoot, base)
      console.log('[embed-anims] check ok: client.js matches the asset pack')
      return
    }
    if (changed) writeFileSync(CLIENT_PATH, result.next)
    if (options.qa) base.qaPath = writeQaData(result.data)
    printSummary(result.data, result.assetsRoot, base)
  } catch (error) {
    console.error('[embed-anims] ' + error.message)
    process.exitCode = 1
  }
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) await main()
