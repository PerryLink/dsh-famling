/**
 * dsh-famling content extension points (reserved, schema version 2).
 *
 * The content center ships bundled characters, browser voices, dialogue modes,
 * local CSS-variable themes, plain-CSS backgrounds and local font stacks. This
 * module is the public contract for a future local/remote content pack: it defines the entry schema for each kind and a
 * pure-data validator. Nothing here touches the network, the DOM, the file
 * system or any host API - callers own transport, storage and UI.
 *
 * Hard constraints (enforced by validateContentPack):
 *   - pure data: functions, symbols, bigints, undefined, non-finite numbers and
 *     non-plain objects are rejected;
 *   - length limits: pack <= 64 KiB of JSON, entries <= 32 (<= 16 per kind),
 *     ids <= 64 chars, names <= 64, descriptions <= 240, text <= 280;
 *   - enums: kind/source/permission/preview/dialogue-mode values are closed
 *     sets; unknown fields are rejected in packs, entries, previews and apply;
 *   - path limits: image preview paths are relative, at most 3 segments, no
 *     "..", no absolute paths, no scheme, no backslashes, <= 160 chars, and
 *     must end in .png/.webp/.jpg;
 *   - CSS limits: theme variables must be named --dsh-famling-* and their
 *     values must be safe colors (hex / rgb()/hsl() / keyword) - no url(),
 *     @import, expression(), markup or control characters;
 *   - backgrounds: only { kind: "transparent" } or solid safe colors, never
 *     images/gradients/URLs;
 *   - fonts: 1..8 unquoted local family names (letters/digits/space/dot/_/-),
 *     bounded size (10..24) / lineHeight (1..2.5); no quotes, url(), var(),
 *     semicolons or at-rules;
 *   - prototype-pollution guard: __proto__ / constructor / prototype keys are
 *     rejected anywhere in the tree;
 *   - remote packs stay disabled unless a future network-enabled host passes
 *     { allowRemote: true } explicitly. This package never fetches a pack URL.
 *
 * Applying a valid entry is always a data-only operation in the host UI: the
 * contract has no callbacks, no code strings and no HTML. A future loader must
 * resolve an entry's data itself and must not evaluate pack output.
 *
 * Import (Node / tooling):
 *   import { CONTENT_EXTENSION_POINTS, validateContentPack } from 'dsh-famling/content-extension'
 */

/** Schema version of the pack document itself. */
export const CONTENT_PACK_SCHEMA_VERSION = 2

/** Closed entry-kind set shared with the bundled content center. */
export const CONTENT_KINDS = ['character', 'voice', 'dialogue', 'theme', 'background', 'font']
/** Entry sources. "remote" is reserved and rejected by default (see validator). */
export const CONTENT_SOURCES = ['bundled', 'local', 'remote']
/** Dialogue modes implemented by the bundled content center. */
export const DIALOGUE_MODE_IDS = ['standard', 'brief', 'quiet']
/** Local theme ids implemented by the bundled content center. */
export const THEME_IDS = ['default', 'paper', 'night']
/** Built-in character ids a character entry may select in this version. */
export const CHARACTER_IDS = ['human', 'cat', 'dog']

/** Permission tokens a pack/entry may declare. */
export const CONTENT_PERMISSIONS = {
  character: 'select:character',
  voice: 'select:voice',
  dialogue: 'select:dialogue',
  theme: 'apply:theme',
  background: 'apply:background',
  font: 'apply:font',
}
export const CONTENT_ENTRY_PERMISSIONS = [
  'select:character',
  'select:voice',
  'select:dialogue',
  'apply:theme',
  'apply:background',
  'apply:font',
  'store:selection',
]

/** Hard limits referenced by the schema and enforced by the validator. */
export const CONTENT_LIMITS = Object.freeze({
  maxBytes: 65536,
  maxEntries: 32,
  maxEntriesPerKind: 16,
  maxDepth: 8,
  maxIdChars: 64,
  maxNameChars: 64,
  maxDescriptionChars: 240,
  maxTextChars: 280,
  maxPathChars: 160,
  maxPermissions: 8,
  maxVars: 24,
  maxVarValueChars: 80,
  maxArrayItems: 64,
  maxObjectKeys: 32,
  maxErrors: 32,
})

const PACK_ID_RE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,3}$/
const ENTRY_ID_RE = /^[a-z][a-z0-9_.-]{0,63}$/
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/
const BAD_TEXT_RE = /[<>\u0000-\u001f\u007f]/
const VAR_KEY_RE = /^--dsh-famling-[a-z0-9-]{1,32}$/
const COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,\/-]{1,48}\)|[a-zA-Z]{2,24})$/
const PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.\/-]{0,158}$/
const IMAGE_EXTENSIONS = ['.png', '.webp', '.jpg']

/**
 * The extension-point document. Treat it as read-only: it is frozen at every
 * level that a pack author needs to introspect (version, transport flags, pack
 * schema, entry schema, validation rules).
 */
export const CONTENT_EXTENSION_POINTS = Object.freeze({
  /** Contract revision; bump only with a documented migration. */
  version: 2,
  /** "reserved" = schema published, no pack loader ships in this package yet. */
  status: 'reserved',
  /** What the runtime guarantees. All flags are false by design. */
  transport: Object.freeze({ network: false, execute: false, innerHTML: false, worker: false }),
  pack: Object.freeze({
    schemaVersion: CONTENT_PACK_SCHEMA_VERSION,
    fields: ['schemaVersion', 'id', 'name', 'version', 'source', 'permissions', 'entries'],
    sources: CONTENT_SOURCES,
    limits: CONTENT_LIMITS,
    idPattern: PACK_ID_RE.source,
    versionPattern: VERSION_RE.source,
    idExample: 'com.example.warm-pack',
  }),
  entry: Object.freeze({
    kinds: CONTENT_KINDS,
    /** kind, id, name, preview, apply, source, permissions and version are required; description is optional. */
    fields: ['kind', 'id', 'name', 'description', 'preview', 'apply', 'source', 'permissions', 'version'],
    idPattern: ENTRY_ID_RE.source,
    versionPattern: VERSION_RE.source,
    preview: Object.freeze({
      kinds: ['glyph', 'text', 'color', 'image'],
      imageExtensions: IMAGE_EXTENSIONS,
      pathPolicy: 'relative only: at most 3 segments, no "..", no leading "/", no scheme, <= ' + CONTENT_LIMITS.maxPathChars + ' chars',
    }),
    permissions: CONTENT_ENTRY_PERMISSIONS,
    /** Per-kind data-only apply payloads. */
    schemas: Object.freeze({
      character: Object.freeze({ apply: Object.freeze({ character: CHARACTER_IDS }) }),
      voice: Object.freeze({ apply: Object.freeze({ voiceURI: '1..240 plain chars' }) }),
      dialogue: Object.freeze({
        apply: Object.freeze({ mode: DIALOGUE_MODE_IDS, optional: ['maxChars', 'bubbleChance'] }),
      }),
      theme: Object.freeze({
        apply: Object.freeze({
          variables: '1..' + CONTENT_LIMITS.maxVars + ' entries, keys --dsh-famling-*, safe CSS color values',
        }),
      }),
      background: Object.freeze({
        apply: Object.freeze({ kind: ['transparent', 'color'], value: 'safe CSS color required for kind=color' }),
      }),
      font: Object.freeze({
        apply: Object.freeze({
          family: 'local font stack: 1..8 unquoted family names, no quotes/url()/var()/semicolons',
          optional: ['size', 'lineHeight'],
        }),
      }),
    }),
  }),
  validation: Object.freeze({
    function: 'validateContentPack',
    pureData: true,
    allowRemoteByDefault: false,
    rejects: [
      'functions / symbols / bigints / undefined',
      'non-finite numbers',
      'unknown fields, kinds or permissions',
      'overlong strings, arrays or packs',
      'prototype keys (__proto__ / constructor / prototype)',
      'path traversal, absolute paths and URLs',
      'markup and control characters',
      'unsafe CSS values (url()/expression()/@import/...)',
      'remote sources without an explicit future opt-in',
      'duplicate entry ids',
    ],
  }),
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.prototype.toString.call(value) === '[object Object]'
}

function isBoundedText(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !BAD_TEXT_RE.test(value)
}

/** Relative image path: no traversal, no scheme, bounded segments/extension. */
export function isSafeContentPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > CONTENT_LIMITS.maxPathChars) return false
  if (!PATH_RE.test(value) || value.startsWith('/') || value.includes('..') || value.includes('\\') || value.includes(':')) return false
  if (value.split('/').length > 3) return false
  return IMAGE_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension))
}

/**
 * Local font stacks only: 1..8 comma-separated unquoted family names made of
 * letters/digits/spaces/dots/underscores/hyphens. No quotes, url(), var(),
 * braces, semicolons or @ rules, so a pack cannot inject CSS declarations.
 */
export function isSafeFontStack(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false
  const families = value.split(',').map((family) => family.trim())
  if (families.length === 0 || families.length > 8) return false
  return families.every((family) => /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/.test(family))
}

/** Walk a value: reject non-JSON values, oversize strings/arrays/objects, prototype keys. */
function scanData(value, depth, where, errors) {
  if (errors.length >= CONTENT_LIMITS.maxErrors) return
  if (depth > CONTENT_LIMITS.maxDepth) {
    errors.push(where + ': nested deeper than ' + CONTENT_LIMITS.maxDepth)
    return
  }
  if (value === null) return
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || typeof value === 'undefined') {
    errors.push(where + ': non-JSON value (' + typeof value + ')')
    return
  }
  if (typeof value === 'string') {
    if (value.length > CONTENT_LIMITS.maxTextChars) errors.push(where + ': string longer than ' + CONTENT_LIMITS.maxTextChars)
    else if (BAD_TEXT_RE.test(value)) errors.push(where + ': markup/control characters are not allowed')
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(where + ': non-finite number')
    return
  }
  if (Array.isArray(value)) {
    if (value.length > CONTENT_LIMITS.maxArrayItems) errors.push(where + ': array longer than ' + CONTENT_LIMITS.maxArrayItems)
    value.forEach((item, index) => scanData(item, depth + 1, where + '[' + index + ']', errors))
    return
  }
  if (!isPlainObject(value)) {
    errors.push(where + ': not a plain object')
    return
  }
  const keys = Object.keys(value)
  if (keys.length > CONTENT_LIMITS.maxObjectKeys) errors.push(where + ': object has too many keys')
  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      errors.push(where + ': forbidden key "' + key + '"')
      continue
    }
    if (key.length > CONTENT_LIMITS.maxTextChars) {
      errors.push(where + ': key too long')
      continue
    }
    scanData(value[key], depth + 1, where + '.' + key, errors)
  }
}

function exactKeys(value, required, optional, where, errors) {
  const known = required.concat(optional)
  for (const key of Object.keys(value)) if (!known.includes(key)) errors.push(where + ': unknown field "' + key + '"')
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(where + ': missing field "' + key + '"')
}

/** Validate the data-only apply payload of one entry kind. */
function validateApply(kind, apply, where, errors) {
  if (kind === 'character') {
    exactKeys(apply, ['character'], [], where, errors)
    if (!CHARACTER_IDS.includes(apply.character)) errors.push(where + '.character: must be one of ' + CHARACTER_IDS.join('/'))
  } else if (kind === 'voice') {
    exactKeys(apply, ['voiceURI'], [], where, errors)
    if (!isBoundedText(apply.voiceURI, 240)) errors.push(where + '.voiceURI: 1..240 plain chars')
  } else if (kind === 'dialogue') {
    exactKeys(apply, ['mode'], ['maxChars', 'bubbleChance'], where, errors)
    if (!DIALOGUE_MODE_IDS.includes(apply.mode)) errors.push(where + '.mode: must be one of ' + DIALOGUE_MODE_IDS.join('/'))
    if (apply.maxChars !== undefined && (!Number.isInteger(apply.maxChars) || apply.maxChars < 0 || apply.maxChars > 240)) {
      errors.push(where + '.maxChars: integer 0..240')
    }
    if (apply.bubbleChance !== undefined && (typeof apply.bubbleChance !== 'number' || !Number.isFinite(apply.bubbleChance) || apply.bubbleChance < 0 || apply.bubbleChance > 1)) {
      errors.push(where + '.bubbleChance: number 0..1')
    }
  } else if (kind === 'theme') {
    exactKeys(apply, ['variables'], [], where, errors)
    const variables = apply.variables
    if (!isPlainObject(variables)) {
      errors.push(where + '.variables: must be a plain object')
      return
    }
    const keys = Object.keys(variables)
    if (keys.length === 0 || keys.length > CONTENT_LIMITS.maxVars) errors.push(where + '.variables: 1..' + CONTENT_LIMITS.maxVars + ' entries')
    for (const key of keys) {
      if (!VAR_KEY_RE.test(key)) errors.push(where + '.variables: key must match --dsh-famling-*: "' + key + '"')
      const value = variables[key]
      if (typeof value !== 'string' || value.length === 0 || value.length > CONTENT_LIMITS.maxVarValueChars || !COLOR_RE.test(value)) {
        errors.push(where + '.variables["' + key + '"]: safe CSS color <= ' + CONTENT_LIMITS.maxVarValueChars + ' chars')
      }
    }
  } else if (kind === 'background') {
    exactKeys(apply, ['kind'], ['value'], where, errors)
    if (!['transparent', 'color'].includes(apply.kind)) {
      errors.push(where + '.kind: must be transparent/color')
    } else if (apply.kind === 'color') {
      if (typeof apply.value !== 'string' || !COLOR_RE.test(apply.value)) errors.push(where + '.value: safe CSS color required for color backgrounds')
    } else if (apply.value !== undefined) {
      errors.push(where + '.value: only allowed for kind=color')
    }
  } else {
    exactKeys(apply, ['family'], ['size', 'lineHeight'], where, errors)
    if (!isSafeFontStack(apply.family)) errors.push(where + '.family: local font stack (1..8 unquoted families, no quotes/url()/var()/semicolons)')
    if (apply.size !== undefined && (!Number.isInteger(apply.size) || apply.size < 10 || apply.size > 24)) errors.push(where + '.size: integer 10..24')
    if (apply.lineHeight !== undefined && (typeof apply.lineHeight !== 'number' || !Number.isFinite(apply.lineHeight) || apply.lineHeight < 1 || apply.lineHeight > 2.5)) errors.push(where + '.lineHeight: number 1..2.5')
  }
}

/** Validate one entry (schema fields + per-kind apply payload). */
function validateEntry(entry, index, packSource, errors) {
  const where = 'entries[' + index + ']'
  if (!isPlainObject(entry)) {
    errors.push(where + ': must be a plain object')
    return
  }
  exactKeys(entry, ['kind', 'id', 'name', 'preview', 'apply', 'source', 'permissions', 'version'], ['description'], where, errors)
  const kind = entry.kind
  if (!CONTENT_KINDS.includes(kind)) {
    errors.push(where + '.kind: must be one of ' + CONTENT_KINDS.join('/'))
    return
  }
  if (typeof entry.id !== 'string' || !ENTRY_ID_RE.test(entry.id)) errors.push(where + '.id: must match the entry id pattern')
  if (!isBoundedText(entry.name, CONTENT_LIMITS.maxNameChars)) errors.push(where + '.name: 1..' + CONTENT_LIMITS.maxNameChars + ' plain chars')
  if (entry.description !== undefined && (typeof entry.description !== 'string' || entry.description.length > CONTENT_LIMITS.maxDescriptionChars || BAD_TEXT_RE.test(entry.description))) {
    errors.push(where + '.description: <= ' + CONTENT_LIMITS.maxDescriptionChars + ' plain chars')
  }
  if (typeof entry.version !== 'string' || !VERSION_RE.test(entry.version)) errors.push(where + '.version: semver x.y.z')
  if (!CONTENT_SOURCES.includes(entry.source)) errors.push(where + '.source: must be one of ' + CONTENT_SOURCES.join('/'))
  else if (entry.source !== packSource) errors.push(where + '.source: must match pack.source ("' + packSource + '")')
  if (!Array.isArray(entry.permissions) || entry.permissions.length === 0 || entry.permissions.length > CONTENT_LIMITS.maxPermissions) {
    errors.push(where + '.permissions: 1..' + CONTENT_LIMITS.maxPermissions + ' entries')
  } else {
    if (!entry.permissions.includes(CONTENT_PERMISSIONS[kind])) errors.push(where + '.permissions: must include "' + CONTENT_PERMISSIONS[kind] + '"')
    for (const permission of entry.permissions) {
      if (!CONTENT_ENTRY_PERMISSIONS.includes(permission)) errors.push(where + '.permissions: unknown permission "' + String(permission) + '"')
    }
  }
  const preview = entry.preview
  if (!isPlainObject(preview)) errors.push(where + '.preview: must be a plain object')
  else if (!['glyph', 'text', 'color', 'image'].includes(preview.kind)) errors.push(where + '.preview.kind: unsupported preview kind')
  else if (preview.kind === 'image') {
    exactKeys(preview, ['kind', 'path'], [], where + '.preview', errors)
    if (!isSafeContentPath(preview.path)) errors.push(where + '.preview.path: relative image path (.png/.webp/.jpg), no traversal/scheme/absolute path')
  } else {
    exactKeys(preview, ['kind', 'value'], [], where + '.preview', errors)
    const limit = preview.kind === 'text' ? 120 : 24
    if (typeof preview.value !== 'string' || preview.value.length === 0 || preview.value.length > limit || BAD_TEXT_RE.test(preview.value)) {
      errors.push(where + '.preview.value: bounded plain text')
    }
    if (preview.kind === 'color' && (typeof preview.value !== 'string' || !COLOR_RE.test(preview.value))) errors.push(where + '.preview.value: safe color value')
  }
  const apply = entry.apply
  if (!isPlainObject(apply)) {
    errors.push(where + '.apply: must be a plain object')
    return
  }
  validateApply(kind, apply, where + '.apply', errors)
}

/**
 * Validate a future content pack. Pure data in, error list out - never throws
 * for malformed input, never executes or resolves anything.
 *
 * @param {unknown} pack Candidate pack document (see CONTENT_EXTENSION_POINTS.pack).
 * @param {{ allowRemote?: boolean }} [options] Remote sources are rejected by default.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateContentPack(pack, options = {}) {
  const errors = []
  scanData(pack, 0, 'pack', errors)
  if (!isPlainObject(pack)) return { ok: false, errors: errors.length > 0 ? errors : ['pack: must be a plain object'] }
  exactKeys(pack, ['schemaVersion', 'id', 'name', 'version', 'source', 'entries'], ['permissions'], 'pack', errors)
  if (pack.schemaVersion !== CONTENT_PACK_SCHEMA_VERSION) errors.push('pack.schemaVersion: must be ' + CONTENT_PACK_SCHEMA_VERSION)
  if (typeof pack.id !== 'string' || !PACK_ID_RE.test(pack.id)) errors.push('pack.id: must match the pack id pattern')
  if (!isBoundedText(pack.name, CONTENT_LIMITS.maxNameChars)) errors.push('pack.name: 1..' + CONTENT_LIMITS.maxNameChars + ' plain chars')
  if (typeof pack.version !== 'string' || !VERSION_RE.test(pack.version)) errors.push('pack.version: semver x.y.z')
  if (!CONTENT_SOURCES.includes(pack.source)) errors.push('pack.source: must be one of ' + CONTENT_SOURCES.join('/'))
  else if (pack.source === 'remote' && options.allowRemote !== true) errors.push('pack.source: remote packs are reserved; a future host must opt in with { allowRemote: true }')
  if (pack.permissions !== undefined) {
    if (!Array.isArray(pack.permissions) || pack.permissions.length > CONTENT_LIMITS.maxPermissions) errors.push('pack.permissions: array of at most ' + CONTENT_LIMITS.maxPermissions)
    else for (const permission of pack.permissions) if (!CONTENT_ENTRY_PERMISSIONS.includes(permission)) errors.push('pack.permissions: unknown permission "' + String(permission) + '"')
  }
  if (!Array.isArray(pack.entries)) return { ok: false, errors: errors.concat('pack.entries: must be an array') }
  if (pack.entries.length > CONTENT_LIMITS.maxEntries) errors.push('pack.entries: more than ' + CONTENT_LIMITS.maxEntries + ' entries')
  const seen = new Set()
  const perKind = {}
  for (let index = 0; index < pack.entries.length; index += 1) {
    const entry = pack.entries[index]
    validateEntry(entry, index, pack.source, errors)
    if (isPlainObject(entry) && typeof entry.kind === 'string' && CONTENT_KINDS.includes(entry.kind) && typeof entry.id === 'string') {
      perKind[entry.kind] = (perKind[entry.kind] || 0) + 1
      if (perKind[entry.kind] > CONTENT_LIMITS.maxEntriesPerKind) errors.push('entries[' + index + ']: more than ' + CONTENT_LIMITS.maxEntriesPerKind + ' ' + entry.kind + ' entries')
      const key = entry.kind + ':' + entry.id
      if (seen.has(key)) errors.push('entries[' + index + ']: duplicate ' + key)
      seen.add(key)
    }
  }
  let bytes = 0
  try {
    bytes = JSON.stringify(pack).length
  } catch {
    errors.push('pack: cannot serialize (cyclic or non-JSON)')
  }
  if (bytes > CONTENT_LIMITS.maxBytes) errors.push('pack: JSON size ' + bytes + ' exceeds ' + CONTENT_LIMITS.maxBytes + ' bytes')
  return { ok: errors.length === 0, errors: errors.slice(0, CONTENT_LIMITS.maxErrors) }
}

/**
 * A valid minimal pack (useful for docs/tests and as a starting point for a
 * future local pack). It declares one theme entry and never gets auto-loaded.
 */
export const CONTENT_PACK_EXAMPLE = Object.freeze({
  schemaVersion: CONTENT_PACK_SCHEMA_VERSION,
  id: 'com.example.warm-pack',
  name: 'Warm Example',
  version: '1.0.0',
  source: 'local',
  permissions: ['apply:theme', 'store:selection'],
  entries: [
    {
      kind: 'theme',
      id: 'warm',
      name: 'Warm',
      description: 'Example theme entry',
      version: '1.0.0',
      source: 'local',
      preview: { kind: 'color', value: '#ffcc00' },
      permissions: ['apply:theme', 'store:selection'],
      apply: { variables: { '--dsh-famling-bubble-bg': '#fff3cd', '--dsh-famling-bubble-text': '#3b2f24' } },
    },
  ],
})

export default CONTENT_EXTENSION_POINTS
