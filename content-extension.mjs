/**
 * dsh-famling content extension points (reserved, schema version 3).
 *
 * The content center ships built-in role bundles (a role IS the theme bundle:
 * character + voice policy + dialogue mode + theme + background + font). This
 * module is the public, pure-data contract for a future local/remote content
 * pack. It defines the pack/entry schema and a validator; nothing here touches
 * the network, the DOM, the file system or any host API - callers own
 * transport, storage and UI.
 *
 * Hard constraints (enforced by validateContentPack):
 *   - every v3 pack must carry a usageDeclaration: researchOnly=true plus all
 *     six prohibited-use tokens (emotional companionship / virtual partner /
 *     professional advice / minor intimacy / impersonation / illegal use);
 *   - pure data: functions, symbols, bigints, undefined, non-finite numbers and
 *     non-plain objects are rejected;
 *   - length limits: pack <= 64 KiB of JSON, entries <= 32 (<= 16 per kind),
 *     ids <= 64 chars, names <= 64, descriptions <= 240, text <= 280;
 *   - enums: kind/source/permission/preview/dialogue-mode values are closed
 *     sets; unknown fields are rejected in packs, entries, previews and apply;
 *   - path limits: image preview paths are relative, at most 3 segments, no
 *     '..', no absolute paths, no scheme, no backslashes, <= 160 chars, and
 *     must end in .png/.webp/.jpg; asset-pack paths are relative, at most 6
 *     segments, safe chars, <= 160 chars, and carry a sha256 hash;
 *   - CSS limits: theme variables must be named --dsh-famling-* and their
 *     values must be safe colors (hex / rgb()/hsl() / keyword) - no url(),
 *     @import, expression(), markup or control characters;
 *   - backgrounds: only { kind: 'transparent' } or solid safe colors, never
 *     images/gradients/URLs;
 *   - fonts: 1..8 unquoted local family names (letters/digits/space/dot/_/-),
 *     bounded size (10..24) / lineHeight (1..2.5); no quotes, url(), var(),
 *     semicolons or at-rules;
 *   - prototype-pollution guard: __proto__ / constructor / prototype keys are
 *     rejected anywhere in the tree;
 *   - remote packs stay disabled unless a future network-enabled host passes
 *     { allowRemote: true } explicitly. This package never fetches a pack URL,
 *     never loads an asset archive and never executes pack output. The
 *     remoteCatalog field is metadata only and is reserved for a future host
 *     catalog; the loader/UI is not implemented in this package.
 *
 * Import (Node / tooling):
 *   import { CONTENT_EXTENSION_POINTS, validateContentPack } from 'dsh-famling/content-extension'
 */

/** Schema version of the pack document itself. */
export const CONTENT_PACK_SCHEMA_VERSION = 3

/** Closed entry-kind set shared with the bundled content center. Role is the
 * bundle kind added by v3: its apply payload carries the six role components. */
export const CONTENT_KINDS = ['role', 'character', 'voice', 'dialogue', 'theme', 'background', 'font']
/** Entry sources. "remote" is reserved and rejected by default (see validator). */
export const CONTENT_SOURCES = ['bundled', 'local', 'remote']
/** Dialogue modes implemented by the bundled content center. */
export const DIALOGUE_MODE_IDS = ['standard', 'brief', 'quiet']
/** Local theme ids implemented by the bundled content center. */
export const THEME_IDS = ['default', 'paper', 'night']
/** Built-in character/role bundle ids; origami is reserved until its art pack lands. */
export const CHARACTER_IDS = ['human', 'cat', 'dog', 'origami']
export const ROLE_BUNDLE_IDS = ['human', 'cat', 'dog', 'origami']
/** Asset-pack container formats reserved by v3; they are never opened here. */
export const ASSET_FORMATS = ['zip', 'folder']

/**
 * The six prohibited-use tokens every v3 pack must declare. A pack may order
 * them freely, but it must list each token exactly once and may not add others.
 */
export const PROHIBITED_USES = Object.freeze([
  'emotional-companionship',
  'virtual-partner',
  'professional-advice',
  'minor-intimacy',
  'impersonation',
  'illegal-use',
])
export const USAGE_DECLARATION_TEMPLATE = Object.freeze({
  researchOnly: true,
  prohibitedUses: PROHIBITED_USES,
})

/** Permission tokens a pack/entry may declare. */
export const CONTENT_PERMISSIONS = {
  role: 'apply:role',
  character: 'select:character',
  voice: 'select:voice',
  dialogue: 'select:dialogue',
  theme: 'apply:theme',
  background: 'apply:background',
  font: 'apply:font',
}
export const CONTENT_ENTRY_PERMISSIONS = [
  'apply:role',
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
  maxAssetPathChars: 160,
  maxAssetFiles: 32,
  maxAssetTotalBytes: 268435456,
  maxCatalogUrlChars: 240,
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
const SHA256_RE = /^[0-9a-f]{64}$/
const ASSET_FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}\.[A-Za-z0-9]{1,8}$/
const IMAGE_EXTENSIONS = ['.png', '.webp', '.jpg']

/**
 * The extension-point document. Treat it as read-only: it is frozen at every
 * level that a pack author needs to introspect (version, transport flags, pack
 * schema, entry schema, validation rules, reserved remote catalog).
 */
export const CONTENT_EXTENSION_POINTS = Object.freeze({
  /** Contract revision; bump only with a documented migration. */
  version: 3,
  /** "reserved" = schema published, no pack loader ships in this package yet. */
  status: 'reserved',
  /** What the runtime guarantees. Every flag is false by design. */
  transport: Object.freeze({ network: false, execute: false, innerHTML: false, worker: false, assets: false }),
  /** Built-in role bundle ids; origami is reserved until its art pack lands. */
  roleBundles: ROLE_BUNDLE_IDS,
  /** Top-level alias of pack.remoteCatalog: reserved metadata, never fetched. */
  remoteCatalog: Object.freeze({
    status: 'reserved',
    fetched: false,
    fields: ['status', 'url?'],
    configKeys: ['dsh-famling/market/catalog', 'dsh-famling.market.catalogUrl'],
  }),
  pack: Object.freeze({
    schemaVersion: CONTENT_PACK_SCHEMA_VERSION,
    fields: ['schemaVersion', 'id', 'name', 'version', 'source', 'usageDeclaration', 'entries'],
    optionalFields: ['permissions', 'assets', 'remoteCatalog'],
    sources: CONTENT_SOURCES,
    limits: CONTENT_LIMITS,
    idPattern: PACK_ID_RE.source,
    versionPattern: VERSION_RE.source,
    idExample: 'com.example.warm-pack',
    usageDeclaration: Object.freeze({
      required: true,
      researchOnly: true,
      prohibitedUses: PROHIBITED_USES,
      note: 'every pack (bundled/local/remote) must declare researchOnly=true and all six prohibited uses; a missing or mutated declaration is rejected',
    }),
    assets: Object.freeze({
      supported: true,
      loaded: false,
      formats: ASSET_FORMATS,
      fields: ['format', 'files', 'totalBytes?'],
      fileFields: ['path', 'sha256', 'bytes?'],
      hash: 'lower-case sha256 hex (64 chars)',
      pathPolicy: 'relative only: at most 6 segments, no "..", no leading "/", no scheme/colon/backslash, <= ' + CONTENT_LIMITS.maxAssetPathChars + ' chars, file extension required',
      note: 'asset archives are listed as data only; this package never opens, copies or executes them',
    }),
    remoteCatalog: Object.freeze({
      status: 'reserved',
      fetched: false,
      fields: ['status', 'url?'],
      statusValues: ['reserved'],
      urlPolicy: 'https only, <= ' + CONTENT_LIMITS.maxCatalogUrlChars + ' chars, metadata only; never fetched by this package',
      configKeys: ['dsh-famling/market/catalog', 'dsh-famling.market.catalogUrl'],
    }),
  }),
  entry: Object.freeze({
    kinds: CONTENT_KINDS,
    /** kind, id, name, preview, apply, source, permissions and version are required; description is optional; role entries also require compatibility. */
    fields: ['kind', 'id', 'name', 'description', 'preview', 'apply', 'source', 'permissions', 'version'],
    roleFields: ['compatibility'],
    optionalRoleFields: ['usageDeclaration'],
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
      role: Object.freeze({
        apply: Object.freeze({
          character: CHARACTER_IDS,
          voicePolicy: Object.freeze({ canTts: 'boolean', mode: ['speech', 'thought'], optional: ['sound', 'voiceURI'] }),
          dialogue: Object.freeze({ mode: DIALOGUE_MODE_IDS, optional: ['maxChars', 'bubbleChance'] }),
          theme: '1..' + CONTENT_LIMITS.maxVars + ' safe --dsh-famling-* CSS color variables',
          background: 'transparent or a safe solid color',
          font: 'local font stack plus optional size 10..24 / lineHeight 1..2.5',
        }),
        compatibility: Object.freeze({ minPluginVersion: 'x.y.z', optional: ['maxPluginVersion'] }),
        bundle: 'one role bundle = character + voicePolicy + dialogue + theme + background + font, applied atomically by the UI',
        usageDeclaration: 'required at pack level; an optional per-role restatement is validated when present',
      }),
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
    loadsAssets: false,
    fetchesCatalog: false,
    rejects: [
      'missing/mutated usageDeclaration (researchOnly must be true; all six prohibited uses required)',
      'functions / symbols / bigints / undefined',
      'non-finite numbers',
      'unknown fields, kinds or permissions',
      'overlong strings, arrays or packs',
      'prototype keys (__proto__ / constructor / prototype)',
      'path traversal, absolute paths and URLs in previews/assets',
      'markup and control characters',
      'unsafe CSS values (url()/expression()/@import/...)',
      'remote sources without an explicit future opt-in',
      'duplicate entry ids or asset paths',
      'invalid role bundles (missing component, mismatched voice policy, bad compatibility)',
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

/** Relative asset-pack path: data only, broader than an image preview. */
export function isSafeAssetPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > CONTENT_LIMITS.maxAssetPathChars) return false
  if (!PATH_RE.test(value) || value.startsWith('/') || value.includes('..') || value.includes('\\') || value.includes(':')) return false
  const segments = value.split('/')
  if (segments.length > 6) return false
  return ASSET_FILE_RE.test(segments[segments.length - 1])
}

/** Reserved remote-catalog URL: absolute https only, metadata only, never fetched. */
export function isSafeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length < 9 || value.length > CONTENT_LIMITS.maxCatalogUrlChars || BAD_TEXT_RE.test(value)) return false
  if (!value.startsWith('https://')) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hostname.includes('.')
  } catch { return false }
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
  if (typeof value === 'boolean') return
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

function versionTuple(value) {
  const parts = value.split('.').map((part) => Number(part))
  return parts.length === 3 && parts.every((part) => Number.isInteger(part)) ? parts : null
}

function versionLessOrEqual(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index]
  }
  return true
}

/** v3 pack-wide declaration: researchOnly plus every prohibited-use token. */
function validateUsageDeclaration(value, where, errors) {
  if (!isPlainObject(value)) {
    errors.push(where + ': must be a plain object')
    return
  }
  exactKeys(value, ['researchOnly', 'prohibitedUses'], [], where, errors)
  if (value.researchOnly !== true) errors.push(where + '.researchOnly: must be true (research/prototype use only)')
  const uses = value.prohibitedUses
  if (!Array.isArray(uses) || uses.length !== PROHIBITED_USES.length) {
    errors.push(where + '.prohibitedUses: must list all ' + PROHIBITED_USES.length + ' prohibited uses exactly once')
    return
  }
  const seen = new Set()
  for (const token of uses) {
    if (typeof token !== 'string' || !PROHIBITED_USES.includes(token)) {
      errors.push(where + '.prohibitedUses: unknown token "' + String(token) + '"')
      continue
    }
    if (seen.has(token)) errors.push(where + '.prohibitedUses: duplicate token "' + token + '"')
    seen.add(token)
  }
  for (const token of PROHIBITED_USES) if (!seen.has(token)) errors.push(where + '.prohibitedUses: missing "' + token + '"')
}

/** Optional asset-pack manifest: listed and hashed, never opened by this package. */
function validateAssets(value, where, errors) {
  if (!isPlainObject(value)) {
    errors.push(where + ': must be a plain object')
    return
  }
  exactKeys(value, ['format', 'files'], ['totalBytes'], where, errors)
  if (!ASSET_FORMATS.includes(value.format)) errors.push(where + '.format: must be one of ' + ASSET_FORMATS.join('/'))
  if (value.totalBytes !== undefined && (!Number.isInteger(value.totalBytes) || value.totalBytes < 0 || value.totalBytes > CONTENT_LIMITS.maxAssetTotalBytes)) {
    errors.push(where + '.totalBytes: integer 0..' + CONTENT_LIMITS.maxAssetTotalBytes)
  }
  const files = value.files
  if (!Array.isArray(files) || files.length === 0 || files.length > CONTENT_LIMITS.maxAssetFiles) {
    errors.push(where + '.files: 1..' + CONTENT_LIMITS.maxAssetFiles + ' files')
    return
  }
  const seen = new Set()
  let sum = 0
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const fileWhere = where + '.files[' + index + ']'
    if (!isPlainObject(file)) {
      errors.push(fileWhere + ': must be a plain object')
      continue
    }
    exactKeys(file, ['path', 'sha256'], ['bytes'], fileWhere, errors)
    if (!isSafeAssetPath(file.path)) errors.push(fileWhere + '.path: relative asset path with a file extension, no traversal/scheme/absolute path')
    else if (seen.has(file.path)) errors.push(fileWhere + '.path: duplicate asset path "' + file.path + '"')
    else seen.add(file.path)
    if (typeof file.sha256 !== 'string' || !SHA256_RE.test(file.sha256)) errors.push(fileWhere + '.sha256: lower-case sha256 hex (64 chars)')
    if (file.bytes !== undefined) {
      if (!Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > CONTENT_LIMITS.maxAssetTotalBytes) errors.push(fileWhere + '.bytes: integer 0..' + CONTENT_LIMITS.maxAssetTotalBytes)
      else sum += file.bytes
    }
  }
  if (value.totalBytes !== undefined && sum > value.totalBytes) errors.push(where + '.totalBytes: smaller than the sum of file bytes')
}

/** Reserved remote catalog metadata. URLs are stored/validated, never fetched. */
function validateRemoteCatalog(value, where, errors) {
  if (!isPlainObject(value)) {
    errors.push(where + ': must be a plain object')
    return
  }
  exactKeys(value, ['status'], ['url'], where, errors)
  if (value.status !== 'reserved') errors.push(where + '.status: must be "reserved" in this version')
  if (value.url !== undefined && !isSafeHttpsUrl(value.url)) errors.push(where + '.url: absolute https URL, metadata only (never fetched)')
}

/** Role bundle compatibility metadata (v0.10 role kind). */
function validateCompatibility(value, where, errors) {
  if (!isPlainObject(value)) {
    errors.push(where + ': must be a plain object')
    return
  }
  exactKeys(value, ['minPluginVersion'], ['maxPluginVersion'], where, errors)
  const min = typeof value.minPluginVersion === 'string' && VERSION_RE.test(value.minPluginVersion) ? versionTuple(value.minPluginVersion) : null
  const max = value.maxPluginVersion === undefined ? null : (typeof value.maxPluginVersion === 'string' && VERSION_RE.test(value.maxPluginVersion) ? versionTuple(value.maxPluginVersion) : undefined)
  if (min === null) errors.push(where + '.minPluginVersion: semver x.y.z')
  if (max === undefined || (value.maxPluginVersion !== undefined && max === null)) errors.push(where + '.maxPluginVersion: semver x.y.z')
  if (min && max && !versionLessOrEqual(min, max)) errors.push(where + ': minPluginVersion must be <= maxPluginVersion')
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

/** Role kind: one atomic bundle = character + voicePolicy + dialogue + theme + background + font. */
function validateRoleApply(apply, where, errors) {
  exactKeys(apply, ['character', 'voicePolicy', 'dialogue', 'theme', 'background', 'font'], [], where, errors)
  if (!CHARACTER_IDS.includes(apply.character)) errors.push(where + '.character: must be one of ' + CHARACTER_IDS.join('/'))
  const voice = apply.voicePolicy
  if (!isPlainObject(voice)) {
    errors.push(where + '.voicePolicy: must be a plain object')
  } else {
    exactKeys(voice, ['canTts', 'mode'], ['sound', 'voiceURI'], where + '.voicePolicy', errors)
    if (typeof voice.canTts !== 'boolean') errors.push(where + '.voicePolicy.canTts: boolean')
    if (!['speech', 'thought'].includes(voice.mode)) errors.push(where + '.voicePolicy.mode: speech/thought')
    if (typeof voice.canTts === 'boolean' && ['speech', 'thought'].includes(voice.mode) && voice.canTts !== (voice.mode === 'speech')) {
      errors.push(where + '.voicePolicy: canTts must match mode (speech => true, thought => false)')
    }
    if (voice.sound !== undefined && typeof voice.sound !== 'boolean') errors.push(where + '.voicePolicy.sound: boolean')
    if (voice.sound === true && voice.canTts !== true) errors.push(where + '.voicePolicy.sound: only allowed when canTts=true')
    if (voice.voiceURI !== undefined && !isBoundedText(voice.voiceURI, 240)) errors.push(where + '.voicePolicy.voiceURI: 1..240 plain chars')
  }
  const dialogue = apply.dialogue
  if (!isPlainObject(dialogue)) errors.push(where + '.dialogue: must be a plain object')
  else validateApply('dialogue', dialogue, where + '.dialogue', errors)
  const theme = apply.theme
  if (!isPlainObject(theme)) errors.push(where + '.theme: must be a plain object')
  else validateApply('theme', theme, where + '.theme', errors)
  const background = apply.background
  if (!isPlainObject(background)) errors.push(where + '.background: must be a plain object')
  else validateApply('background', background, where + '.background', errors)
  const font = apply.font
  if (!isPlainObject(font)) errors.push(where + '.font: must be a plain object')
  else validateApply('font', font, where + '.font', errors)
}

/** Validate one entry (schema fields + per-kind apply payload). */
function validateEntry(entry, index, packSource, errors) {
  const where = 'entries[' + index + ']'
  if (!isPlainObject(entry)) {
    errors.push(where + ': must be a plain object')
    return
  }
  const required = ['kind', 'id', 'name', 'preview', 'apply', 'source', 'permissions', 'version']
  const optional = ['description']
  if (entry.kind === 'role') {
    required.push('compatibility')
    optional.push('usageDeclaration')
  }
  exactKeys(entry, required, optional, where, errors)
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
  if (kind === 'role') {
    validateCompatibility(entry.compatibility, where + '.compatibility', errors)
    if (entry.usageDeclaration !== undefined) validateUsageDeclaration(entry.usageDeclaration, where + '.usageDeclaration', errors)
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
  if (kind === 'role') validateRoleApply(apply, where + '.apply', errors)
  else validateApply(kind, apply, where + '.apply', errors)
}

/**
 * Validate a future content pack. Pure data in, error list out - never throws
 * for malformed input, never executes or resolves anything, never fetches the
 * remote catalog and never opens an asset archive.
 *
 * @param {unknown} pack Candidate pack document (see CONTENT_EXTENSION_POINTS.pack).
 * @param {{ allowRemote?: boolean }} [options] Remote sources are rejected by default.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateContentPack(pack, options = {}) {
  const errors = []
  scanData(pack, 0, 'pack', errors)
  if (!isPlainObject(pack)) return { ok: false, errors: errors.length > 0 ? errors : ['pack: must be a plain object'] }
  exactKeys(pack, ['schemaVersion', 'id', 'name', 'version', 'source', 'usageDeclaration', 'entries'], ['permissions', 'assets', 'remoteCatalog'], 'pack', errors)
  if (pack.schemaVersion !== CONTENT_PACK_SCHEMA_VERSION) errors.push('pack.schemaVersion: must be ' + CONTENT_PACK_SCHEMA_VERSION)
  if (typeof pack.id !== 'string' || !PACK_ID_RE.test(pack.id)) errors.push('pack.id: must match the pack id pattern')
  if (!isBoundedText(pack.name, CONTENT_LIMITS.maxNameChars)) errors.push('pack.name: 1..' + CONTENT_LIMITS.maxNameChars + ' plain chars')
  if (typeof pack.version !== 'string' || !VERSION_RE.test(pack.version)) errors.push('pack.version: semver x.y.z')
  if (!CONTENT_SOURCES.includes(pack.source)) errors.push('pack.source: must be one of ' + CONTENT_SOURCES.join('/'))
  else if (pack.source === 'remote' && options.allowRemote !== true) errors.push('pack.source: remote packs are reserved; a future host must opt in with { allowRemote: true }')
  validateUsageDeclaration(pack.usageDeclaration, 'pack.usageDeclaration', errors)
  if (pack.assets !== undefined) validateAssets(pack.assets, 'pack.assets', errors)
  if (pack.remoteCatalog !== undefined) validateRemoteCatalog(pack.remoteCatalog, 'pack.remoteCatalog', errors)
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
 * A valid minimal v3 pack (useful for docs/tests and as a starting point for a
 * future local pack). It declares one role bundle and one theme entry, a
 * complete usageDeclaration, and never gets auto-loaded.
 */
export const CONTENT_PACK_EXAMPLE = Object.freeze({
  schemaVersion: CONTENT_PACK_SCHEMA_VERSION,
  id: 'com.example.warm-pack',
  name: 'Warm Example',
  version: '1.0.0',
  source: 'local',
  usageDeclaration: Object.freeze({ researchOnly: true, prohibitedUses: PROHIBITED_USES }),
  permissions: ['apply:role', 'apply:theme', 'store:selection'],
  entries: [
    {
      kind: 'role',
      id: 'warm-human',
      name: 'Warm Human',
      description: 'Example role bundle: six components applied atomically',
      version: '1.0.0',
      source: 'local',
      preview: { kind: 'glyph', value: '🧑' },
      permissions: ['apply:role', 'store:selection'],
      compatibility: { minPluginVersion: '0.10.0' },
      usageDeclaration: { researchOnly: true, prohibitedUses: PROHIBITED_USES },
      apply: {
        character: 'human',
        voicePolicy: { canTts: true, mode: 'speech', sound: true },
        dialogue: { mode: 'standard' },
        theme: { variables: { '--dsh-famling-bubble-bg': '#fff3cd', '--dsh-famling-bubble-text': '#3b2f24' } },
        background: { kind: 'transparent' },
        font: { family: 'system-ui, sans-serif', size: 12, lineHeight: 1.5 },
      },
    },
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
