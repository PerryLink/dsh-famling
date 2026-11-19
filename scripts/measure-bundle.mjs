#!/usr/bin/env node
/**
 * Quantify the dsh-famling first-screen byte cost after the lazy-chunk split.
 *
 * Before 0.8.6, client.js embedded all three characters' 208 base64 PNG frames
 * (229,360 base64 chars) and package.json declared dsh.client.immediately, so
 * every DSH GUI boot paid ~314 KiB for animations the footer might never show.
 * 0.8.6 keeps client.js as code + metadata and moves each character's sprite set
 * into a package-local lazy chunk, loaded through the DSH client module table's
 * require.async only when that character is displayed.
 *
 * This script prints raw/gzip/brotli bytes for the entry and every chunk plus the
 * payload shapes that matter:
 *   - initial:    client.js alone (what boot downloads before any pet render);
 *   - first paint: client.js + the default character chunk (usually human);
 *   - all lazy:   client.js + all three character chunks;
 *   - content UI: client.content.js (role/customize/packs/market panel, only on open).
 *
 * Usage:
 *   node scripts/measure-bundle.mjs
 *   node scripts/measure-bundle.mjs --json
 *   node scripts/measure-bundle.mjs --baseline 315647 --character cat
 */
import { readFileSync } from 'node:fs'
import { constants as zlibConstants, brotliCompressSync, gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { CHARACTERS, CHUNK_NAMES, PLUGIN_ROOT } from './embed-anims.mjs'

/** PET-PERFORMANCE-AUDIT-2026-11-18 P1-2 measurement snapshot of the pre-split client.js. */
export const AUDIT_BASELINE_BYTES = 314_762

/**
 * Compress one buffer the way a static server would.
 * @param {Buffer} buffer
 * @returns {{ raw: number, gzip: number, brotli: number }}
 */
export function measureBytes(buffer) {
  return {
    raw: buffer.length,
    gzip: gzipSync(buffer, { level: 9 }).length,
    brotli: brotliCompressSync(buffer, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  }
}

/**
 * Measure the entry plus every lazy chunk of one installed plugin directory.
 * @param {string} [pluginRoot]
 * @param {string} [defaultCharacter]
 */
export function measureBundle(pluginRoot = PLUGIN_ROOT, defaultCharacter = 'human') {
  const entryPath = join(pluginRoot, 'client.js')
  const entry = measureBytes(readFileSync(entryPath))
  const chunks = {}
  for (const kind of CHARACTERS) {
    const path = join(pluginRoot, CHUNK_NAMES[kind])
    chunks[kind] = { file: CHUNK_NAMES[kind], ...measureBytes(readFileSync(path)) }
  }
  const defaultChunk = chunks[defaultCharacter] || chunks[CHARACTERS[0]]
  const sum = (key) => entry[key] + CHARACTERS.reduce((total, kind) => total + chunks[kind][key], 0)
  let content = null
  try { content = { file: 'client.content.js', ...measureBytes(readFileSync(join(pluginRoot, 'client.content.js'))) } } catch {}
  return {
    pluginRoot,
    defaultCharacter,
    entry,
    contentChunk: content,
    chunks,
    initial: entry,
    firstPaint: {
      raw: entry.raw + defaultChunk.raw,
      gzip: entry.gzip + defaultChunk.gzip,
      brotli: entry.brotli + defaultChunk.brotli,
    },
    allLazy: { raw: sum('raw'), gzip: sum('gzip'), brotli: sum('brotli') },
  }
}

function formatKib(bytes) {
  return (bytes / 1024).toFixed(1) + ' KiB'
}

function formatSavings(current, baseline) {
  if (!(baseline > 0)) return ''
  const percent = ((current - baseline) / baseline) * 100
  return ' (' + (percent >= 0 ? '+' : '') + percent.toFixed(1) + '% vs baseline)'
}

function row(label, value) {
  return '[measure-bundle] ' + label.padEnd(42) + formatKib(value.raw).padStart(10) + ' raw / ' + formatKib(value.gzip).padStart(9) + ' gzip / ' + formatKib(value.brotli).padStart(9) + ' brotli'
}

function parseArgs(argv) {
  const options = { json: false, baseline: AUDIT_BASELINE_BYTES, character: 'human', pluginRoot: PLUGIN_ROOT }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--baseline') {
      const value = Number(argv[index + 1])
      if (!Number.isFinite(value) || value <= 0) throw new Error('--baseline requires a positive byte count')
      options.baseline = Math.round(value)
      index += 1
    } else if (arg === '--character') {
      const value = argv[index + 1]
      if (!CHARACTERS.includes(value)) throw new Error('--character must be one of ' + CHARACTERS.join('/'))
      options.character = value
      index += 1
    } else if (arg === '--root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--root requires a plugin directory')
      options.pluginRoot = resolve(value)
      index += 1
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('unknown argument: ' + arg)
  }
  return options
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log('usage: node scripts/measure-bundle.mjs [--json] [--baseline BYTES] [--character human|cat|dog] [--root DIR]')
    return 0
  }
  const measured = measureBundle(options.pluginRoot, options.character)
  const baseline = options.baseline
  if (options.json) {
    console.log(JSON.stringify({ baseline, ...measured }, null, 2))
    return 0
  }
  console.log('[measure-bundle] plugin: ' + measured.pluginRoot)
  console.log('[measure-bundle] pre-split baseline: ' + baseline.toLocaleString('en-US') + ' B (audit P1-2 snapshot)')
  console.log(row('client.js entry (initial payload)', measured.entry) + formatSavings(measured.entry.raw, baseline))
  for (const kind of CHARACTERS) console.log(row('lazy chunk ' + CHUNK_NAMES[kind], measured.chunks[kind]))
  if (measured.contentChunk) console.log(row('lazy content UI chunk (on first open)', measured.contentChunk))
  console.log(row('first paint (+' + measured.defaultCharacter + ' chunk)', measured.firstPaint) + formatSavings(measured.firstPaint.raw, baseline))
  console.log(row('all three chunks loaded', measured.allLazy) + formatSavings(measured.allLazy.raw, baseline))
  console.log('[measure-bundle] chunk bytes are downloaded only when that character is shown; the entry no longer carries any base64 sprite payload')
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error('[measure-bundle] ' + error.message)
    process.exitCode = 1
  }
}
