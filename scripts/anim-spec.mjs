#!/usr/bin/env node
/**
 * Vendored animation spec/lock (MB-004 / E2-T1) for the standalone plugin.
 *
 * The plugin is a separate package from the private famling app checkout: the
 * generated lazy chunks already contain every animation frame the plugin needs,
 * but `embed-anims --check` used to require the private art checkout to
 * regenerate them. A clean plugin-only checkout therefore could not run
 * `npm run check` at all, and `verify-anims` silently skipped its byte-level
 * cross-check.
 *
 * This module is the vendored semantic spec + LOCK that closes that gap. The
 * spec is generated from the private animation source (see
 * `scripts/embed-anims.mjs`), committed to the plugin repository as
 * `scripts/spec/anim-spec.json`, and contains:
 *
 *   - the shared contract data (per-clip fps/loop/holdMs/durationMs/frames),
 *   - each character's tap-region/actions document (head/body/tail, says),
 *   - a SHA-256 lock per source frame file (public manifest of the private art;
 *     the art bytes themselves are not published by this file),
 *   - a SHA-256 lock per embedded frame byte and per generated lazy chunk,
 *   - the aggregate `source-sha256` already printed in client.js,
 *   - a self-digest `specSha256` over the canonical (sorted-key) spec body.
 *
 * `embed-anims --check` and `verify-anims` validate the committed client.js +
 * lazy chunks against this spec when the private asset checkout is absent, so a
 * clean plugin-only checkout has no private-repository dependency. A missing or
 * tampered spec is a hard failure, never a skip: if someone edits a frame or a
 * clip in the checked-in chunks without regenerating, the chunk/frame SHA no
 * longer matches the vendored lock.
 *
 * The spec is data only; it is not shipped in the npm tarball (scripts/ is not
 * in the package `files` allowlist) and it never contains PNG/base64 art bytes.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import vm from 'node:vm'

/** Spec schema identifier; a breaking shape change bumps this. */
export const SPEC_SCHEMA = 'dsh-famling/anim-spec'
/** Spec schema version (integer); consumers must reject unknown versions. */
export const SPEC_VERSION = 1
/** Producer recorded in the spec so a mirror can trace how it was built. */
export const SPEC_GENERATOR = 'scripts/embed-anims.mjs'
/** Package-relative spec location (vendored into the plugin repository). */
export const SPEC_RELATIVE_PATH = 'scripts/spec/anim-spec.json'
/** The three animation packs this plugin ships. */
export const SPEC_CHARACTERS = Object.freeze(['human', 'cat', 'dog'])
/** Generated chunk file name pattern; the spec may only name these files. */
const CHUNK_FILE_RE = /^client\.anims\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/
/** A sprite key as emitted by embed-anims: `<kind>/<clipId>/<index>`. */
const SPRITE_KEY_RE = /^[a-z][a-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*\/\d{1,3}$/

/**
 * Hash helper.
 * @param {Buffer|string} value Bytes (or utf8 text) to hash.
 * @returns {string} Lowercase SHA-256 hex digest.
 */
export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Canonical JSON string: object keys recursively sorted, arrays keep order.
 * Used for the spec self-digest and for deterministic equality checks, so a
 * key-order-only rewrite of a generated chunk does not count as drift.
 * @param {any} value JSON-compatible value.
 * @returns {string} Canonical string.
 */
export function stableStringify(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((item) => stableStringify(item)).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}'
}

/**
 * Recursively sort object keys so the written spec file is deterministic.
 * @param {any} value JSON-compatible value.
 * @returns {any} Copy with sorted object keys.
 */
export function sortKeysDeep(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => sortKeysDeep(item))
  const sorted = {}
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key])
  return sorted
}

/**
 * Compute the canonical spec digest over the spec body without `specSha256`.
 * @param {any} spec Parsed spec object.
 * @returns {string} SHA-256 hex digest.
 */
export function animationSpecSha256(spec) {
  const body = {}
  for (const key of Object.keys(spec)) if (key !== 'specSha256') body[key] = spec[key]
  return sha256Hex(stableStringify(body))
}

/**
 * Build the vendored spec from a fresh embed-anims generation.
 * @param {{ data: any, chunkContents: Record<string, string> }} input
 *   embed-anims output: buildAnimationData() data plus rendered chunk contents.
 * @returns {any} Spec object with `specSha256`.
 */
export function buildAnimationSpec({ data, chunkContents }) {
  const characters = {}
  for (const kind of Object.keys(data.anims)) {
    const anim = data.anims[kind]
    const spriteKeys = Object.values(anim.clips).flatMap((clip) => clip.frames)
    const embeddedFrameSha256 = spriteKeys.map((key) => {
      const base64 = data.sprites[key]
      if (typeof base64 !== 'string' || base64.length === 0) throw new Error(kind + ': missing embedded sprite ' + key)
      return sha256Hex(Buffer.from(base64, 'base64'))
    })
    const chunkText = chunkContents[kind]
    if (typeof chunkText !== 'string' || chunkText.length === 0) throw new Error(kind + ': missing rendered chunk content')
    characters[kind] = {
      chunkFile: basename('client.anims.' + kind + '.js'),
      chunkSha256: sha256Hex(chunkText),
      frames: spriteKeys.length,
      base64Chars: spriteKeys.reduce((sum, key) => sum + data.sprites[key].length, 0),
      clips: anim.clips,
      regions: anim.regions,
      embeddedFrameSha256,
    }
  }
  const spec = {
    schema: SPEC_SCHEMA,
    specVersion: SPEC_VERSION,
    generator: SPEC_GENERATOR,
    sharedContract: 'famling.pet-anim/0.1 (96x96 RGBA, 12 shared clip ids per character)',
    sourceRoots: {
      frames: 'famling public/assets/pet/anim/{human,cat,dog}',
      regions: 'famling public/characters/{pet-tinglan-anim,pet-cat,pet-dog}/regions.json',
    },
    sourceSha256: data.sourceSha256,
    characters,
    sourceFrames: data.sourceFrames,
  }
  spec.specSha256 = animationSpecSha256(spec)
  return spec
}

/**
 * Render the spec file text deterministically (sorted keys, trailing newline).
 * @param {any} spec Spec object.
 * @returns {string} File text.
 */
export function renderAnimationSpec(spec) {
  return JSON.stringify(sortKeysDeep(spec), null, 2) + '\n'
}

/**
 * Resolve the package-local spec path.
 * @param {string} pluginRoot Absolute plugin package root.
 * @returns {string} Absolute spec path.
 */
export function specPathFor(pluginRoot) {
  return join(pluginRoot, SPEC_RELATIVE_PATH)
}

/**
 * Read + integrity-check the vendored spec. A missing or tampered spec throws a
 * clear error: callers must fail, never fall back to a skip.
 * @param {string} pluginRoot Absolute plugin package root.
 * @returns {{ spec: any, path: string, text: string }} Parsed spec and raw file.
 */
export function readAnimationSpec(pluginRoot) {
  const path = specPathFor(pluginRoot)
  if (!existsSync(path)) {
    throw new Error('vendored animation spec is missing (' + SPEC_RELATIVE_PATH + '); regenerate it with `npm run embed:anims` in the private workspace and commit it - never skip the private-asset gate')
  }
  const text = readFileSync(path, 'utf8')
  let spec
  try {
    spec = JSON.parse(text)
  } catch (error) {
    throw new Error('vendored animation spec is not valid JSON: ' + error.message)
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('vendored animation spec must be a JSON object')
  if (spec.schema !== SPEC_SCHEMA) throw new Error('vendored animation spec schema must be ' + JSON.stringify(SPEC_SCHEMA) + ', got ' + JSON.stringify(spec.schema))
  if (spec.specVersion !== SPEC_VERSION) throw new Error('vendored animation spec version must be ' + SPEC_VERSION + ', got ' + JSON.stringify(spec.specVersion))
  if (typeof spec.specSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(spec.specSha256)) throw new Error('vendored animation spec is missing its specSha256 self-digest')
  const expected = animationSpecSha256(spec)
  if (expected !== spec.specSha256) throw new Error('vendored animation spec integrity check failed: specSha256 says ' + spec.specSha256 + ', canonical body hashes to ' + expected)
  const kinds = Object.keys(spec.characters ?? {}).sort()
  if (kinds.join(',') !== [...SPEC_CHARACTERS].sort().join(',')) throw new Error('vendored animation spec must describe exactly ' + SPEC_CHARACTERS.join('/') + ', got ' + (kinds.join('/') || '<none>'))
  if (spec.sourceFrames === null || typeof spec.sourceFrames !== 'object') throw new Error('vendored animation spec is missing the source frame lock')
  return { spec, path, text }
}

/**
 * Evaluate one generated lazy chunk with a stub module loader.
 * @param {string} filePath Absolute chunk path.
 * @returns {{ registration: any, exports: any }} Registration + factory result.
 */
function loadChunkModule(filePath) {
  const code = readFileSync(filePath, 'utf8')
  /** @type {any} */
  let registration = null
  const sandbox = { window: { __ModuleLoader__: { load(value) { registration = value } } } }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: filePath })
  if (!registration || typeof registration.factory !== 'function') throw new Error('chunk did not register a module factory: ' + filePath)
  return { registration, exports: registration.factory(() => { throw new Error('chunk factory must not require modules') }) }
}

/**
 * Extract the generated contract header from client.js: aggregate source hash
 * and the per-character chunk hashes printed by embed-anims.
 * @param {string} source client.js source text.
 * @returns {{ sourceSha256: string|null, chunkSha256: Record<string, string> }} Header values.
 */
export function parseClientSpecHeader(source) {
  const sourceMatch = source.match(/^\s*\/\/ source-sha256: ([0-9a-f]{64})$/m)
  const chunkMatch = source.match(/^\s*\/\/ chunk-sha256: ([^\n]+)$/m)
  /** @type {Record<string, string>} */
  const chunkSha256 = {}
  if (chunkMatch) {
    for (const part of chunkMatch[1].trim().split(/\s+/)) {
      const [kind, hash] = part.split('=')
      if (kind && hash) chunkSha256[kind] = hash
    }
  }
  return { sourceSha256: sourceMatch ? sourceMatch[1] : null, chunkSha256 }
}

/**
 * Validate the committed client.js + lazy chunks against the vendored spec.
 * Pure local verification: no private checkout, no network. Returns errors
 * instead of throwing so callers can aggregate them into their own gate output.
 * @param {{ pluginRoot: string, spec: any }} input Plugin root and parsed spec.
 * @returns {{ ok: boolean, errors: string[], stats: { characters: number, frames: number, base64Chars: number, specSha256: string, sourceSha256: string } }} Validation result.
 */
export function validateEmbeddedAgainstSpec({ pluginRoot, spec }) {
  const errors = []
  const stats = { characters: 0, frames: 0, base64Chars: 0, specSha256: spec.specSha256, sourceSha256: spec.sourceSha256 }
  const clientPath = join(pluginRoot, 'client.js')
  let clientSource = ''
  try {
    clientSource = readFileSync(clientPath, 'utf8')
  } catch (error) {
    errors.push('cannot read client.js: ' + error.message)
    return { ok: false, errors, stats }
  }
  const header = parseClientSpecHeader(clientSource)
  if (!header.sourceSha256) errors.push('client.js is missing the generated // source-sha256 header line')
  else if (header.sourceSha256 !== spec.sourceSha256) errors.push('client.js source-sha256 ' + header.sourceSha256 + ' != vendored spec sourceSha256 ' + spec.sourceSha256)
  if (Object.keys(header.chunkSha256).length === 0) errors.push('client.js is missing the generated // chunk-sha256 header line')
  for (const kind of SPEC_CHARACTERS) {
    const char = spec.characters?.[kind]
    if (char === null || typeof char !== 'object') {
      errors.push(kind + ': vendored spec has no character entry')
      continue
    }
    if (typeof char.chunkFile !== 'string' || !CHUNK_FILE_RE.test(char.chunkFile) || basename(char.chunkFile) !== char.chunkFile) {
      errors.push(kind + ': vendored spec chunkFile is not a safe generated chunk name')
      continue
    }
    if (typeof char.chunkSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(char.chunkSha256)) {
      errors.push(kind + ': vendored spec chunkSha256 is malformed')
      continue
    }
    const chunkPath = join(pluginRoot, char.chunkFile)
    let chunkText
    try {
      chunkText = readFileSync(chunkPath, 'utf8')
    } catch (error) {
      errors.push(kind + ': cannot read generated chunk ' + char.chunkFile + ': ' + error.message)
      continue
    }
    const actualChunkSha = sha256Hex(chunkText)
    if (actualChunkSha !== char.chunkSha256) errors.push(kind + ': chunk ' + char.chunkFile + ' sha256 ' + actualChunkSha.slice(0, 16) + '... != vendored spec ' + char.chunkSha256.slice(0, 16) + '... (chunk edited without npm run embed:anims?)')
    if (header.chunkSha256[kind] !== char.chunkSha256) errors.push(kind + ': client.js chunk-sha256 ' + String(header.chunkSha256[kind]).slice(0, 16) + '... != vendored spec ' + char.chunkSha256.slice(0, 16) + '...')
    let exports
    try {
      exports = loadChunkModule(chunkPath).exports
    } catch (error) {
      errors.push(kind + ': cannot evaluate generated chunk: ' + error.message)
      continue
    }
    const anims = exports?.anims
    const sprites = exports?.sprites
    if (anims === null || typeof anims !== 'object' || sprites === null || typeof sprites !== 'object') {
      errors.push(kind + ': chunk factory must export { anims, sprites }')
      continue
    }
    if (stableStringify(anims.clips) !== stableStringify(char.clips)) errors.push(kind + ': embedded clips/fps/holdMs metadata differs from the vendored spec')
    if (stableStringify(anims.regions) !== stableStringify(char.regions)) errors.push(kind + ': embedded tap regions/actions differ from the vendored spec')
    const spriteKeys = Object.values(anims.clips ?? {}).flatMap((clip) => Array.isArray(clip.frames) ? clip.frames : [])
    if (spriteKeys.length !== char.frames) errors.push(kind + ': embedded frame count ' + spriteKeys.length + ' != vendored spec ' + char.frames)
    if (!Array.isArray(char.embeddedFrameSha256) || char.embeddedFrameSha256.length !== char.frames) {
      errors.push(kind + ': vendored spec embeddedFrameSha256 must list one hash per frame')
    }
    let base64Chars = 0
    let frameMismatch = false
    for (let index = 0; index < spriteKeys.length; index += 1) {
      const key = spriteKeys[index]
      if (typeof key !== 'string' || !SPRITE_KEY_RE.test(key) || !key.startsWith(kind + '/')) {
        errors.push(kind + ': invalid embedded sprite key ' + JSON.stringify(key))
        frameMismatch = true
        continue
      }
      const base64 = sprites[key]
      if (typeof base64 !== 'string' || base64.length === 0) {
        errors.push(kind + ': missing embedded sprite ' + key)
        frameMismatch = true
        continue
      }
      base64Chars += base64.length
      if (Array.isArray(char.embeddedFrameSha256)) {
        const frameSha = sha256Hex(Buffer.from(base64, 'base64'))
        if (char.embeddedFrameSha256[index] !== frameSha) {
          errors.push(kind + ': frame ' + key + ' sha256 ' + frameSha.slice(0, 16) + '... != vendored spec ' + String(char.embeddedFrameSha256[index]).slice(0, 16) + '...')
          frameMismatch = true
        }
      }
    }
    if (base64Chars !== char.base64Chars) errors.push(kind + ': embedded base64 length ' + base64Chars + ' != vendored spec ' + char.base64Chars)
    // The source frame lock is a public, byte-free manifest: one SHA per source
    // PNG, keyed exactly like the private pack layout.
    const expectedSourceFiles = {}
    for (const [clipId, clip] of Object.entries(anims.clips ?? {})) {
      for (let index = 0; index < (clip.frames ?? []).length; index += 1) {
        expectedSourceFiles[clipId + '/' + clipId + '_' + String(index).padStart(2, '0') + '.png'] = true
      }
    }
    const sourceFrames = spec.sourceFrames?.[kind]
    if (sourceFrames === null || typeof sourceFrames !== 'object') {
      errors.push(kind + ': vendored spec sourceFrames is missing')
    } else {
      const actualFiles = Object.keys(sourceFrames).sort()
      const expectedFiles = Object.keys(expectedSourceFiles).sort()
      if (actualFiles.join(',') !== expectedFiles.join(',')) errors.push(kind + ': vendored spec source frame list does not match the clip frame layout')
      for (const [file, hash] of Object.entries(sourceFrames)) {
        if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) errors.push(kind + ': source frame ' + file + ' hash is malformed')
      }
    }
    if (!frameMismatch) {
      stats.characters += 1
      stats.frames += spriteKeys.length
      stats.base64Chars += base64Chars
    }
  }
  return { ok: errors.length === 0, errors, stats }
}

/**
 * One-line summary used by the check gates.
 * @param {any} spec Parsed spec.
 * @returns {string} Human-readable summary.
 */
export function animationSpecSummary(spec) {
  const chars = SPEC_CHARACTERS.map((kind) => {
    const char = spec.characters?.[kind]
    return kind + '=' + (char?.frames ?? '?') + 'f'
  })
  return 'spec v' + spec.specVersion + ' sha256:' + String(spec.specSha256).slice(0, 16) + '... source:' + String(spec.sourceSha256).slice(0, 16) + '... ' + chars.join(' ')
}
