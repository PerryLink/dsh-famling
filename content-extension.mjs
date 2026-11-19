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
 *   - compliance metadata is additive in v3 (0.10.9): packs/entries may declare
 *     license {spdx, attribution, url?, file?}, aiProvenance {generated,
 *     disclosure, tools?} and a pack-level compatibility plugin-version range;
 *     they are validated fail-closed when present, reported as warnings when
 *     absent (backward compatible with pre-0.10.9 v3 packs), and become required
 *     only when a host passes { requireCompliance: true }. A declared canonical
 *     usage statement/ref/SHA must equal the shared anchors;
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
 * v3 compatibility (0.10.7): CONTENT_EXTENSION_VERSION stays 3 in the 0.10.x
 * line. CONTENT_EXTENSION_COMPATIBILITY / isContentExtensionCompatible expose the
 * single-version policy and the bridge hello/probe handshake reports the same
 * revision through CONTENT_EXTENSION_POINTS.version, so wire and schema cannot
 * drift independently.
 *
 * v3 compliance (0.10.9, MB-032/033): the contract stays v3 (no v4) and gains
 * the compliance fields as additive optional fields, so a pre-0.10.9 v3 pack
 * keeps validating and an old host keeps reading the same wire contract. The
 * canonical usage statement/ref/SHA, license and AI-provenance anchors are
 * exported here and frozen in the client content block
 * (SHARED_CONTENT_SEMANTICS); the parity tests check both ends and the
 * vendored v2 pack shapes without merging the two schemas.
 *
 * Import (Node / tooling):
 *   import { CONTENT_EXTENSION_POINTS, validateContentPack } from 'dsh-famling/content-extension'
 */

/** Schema version of the pack document itself. */
export const CONTENT_PACK_SCHEMA_VERSION = 3

/**
 * Contract revision of this extension-point document (the wire contract the
 * bridge hello/probe handshake reports). v3 is the current version in the
 * 0.10.x line: there is no v4 in this release, and v3 stays backward compatible
 * for older pack authors by only accepting additive optional fields.
 */
export const CONTENT_EXTENSION_VERSION = 3

/**
 * Version compatibility policy for external pack tooling. The v3 contract is
 * single-version (no multi-major loader ships in this package): exactly the
 * published v3 schema is accepted; additive optional fields may appear inside
 * v3, while a breaking change requires a documented major bump first.
 * `hello` / `probe` report CONTENT_EXTENSION_VERSION so a stale cached client
 * can detect a contract mismatch instead of silently reading packs with the
 * wrong semantics.
 */
export const CONTENT_EXTENSION_COMPATIBILITY = Object.freeze({
  current: CONTENT_EXTENSION_VERSION,
  supportedPackSchemaVersions: Object.freeze([CONTENT_PACK_SCHEMA_VERSION]),
  policy: 'additive-within-major',
  breakingChange: 'requires a documented major bump and a migration note',
})

/**
 * Whether a caller speaks this package's current content-extension contract.
 * Unknown/non-integer versions are incompatible (fail closed, never guess).
 * @param {unknown} version Candidate contract revision (e.g. from a hello reply).
 * @returns {boolean}
 */
export function isContentExtensionCompatible(version) {
  return Number.isInteger(version) && version === CONTENT_EXTENSION_VERSION
}

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
/** Role bundle ids exposed by the v3 contract (origami is reserved data). */
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
/** Minimal declaration shape every v3 pack must provide (research-only + six tokens). */
export const USAGE_DECLARATION_TEMPLATE = Object.freeze({
  researchOnly: true,
  prohibitedUses: PROHIBITED_USES,
})

/**
 * Canonical research-only statement shared with famling
 * docs/legal/USE-RESTRICTIONS-2026-11-19.md and with the client content block
 * (SHARED_CONTENT_SEMANTICS.usageStatement). A v3 usageDeclaration may restate
 * it with optional statement / statementRef / statementSha256 fields; when any
 * of them is present it must match these anchors exactly (fail closed). Strict
 * mode requires statement + statementRef, while a plain pre-0.10.9 declaration
 * (researchOnly + six tokens only) stays valid.
 */
export const CONTENT_USAGE_STATEMENT =
  '本项目及其全部代码、美术、音频、文案、角色素材和衍生物仅用于技术研究与原型验证，不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途。'
/** Repository-relative canonical legal anchor for the shared usage statement. */
export const CONTENT_USAGE_STATEMENT_REF = 'docs/legal/USE-RESTRICTIONS-2026-11-19.md'
/** SHA-256 of CONTENT_USAGE_STATEMENT (hex, recomputed by the parity tests). */
export const CONTENT_USAGE_STATEMENT_SHA256 = '0353536cefd702014b12a8365c4a486f19848d049652e9692027216adb80c743'

/**
 * Frozen first-party compliance anchors (0.10.9, MB-033). These are the values
 * the bundled project declares and the client block freezes; a third-party pack
 * declares its own licence and AI provenance (structurally validated), it is
 * not forced onto these first-party values.
 */
export const CONTENT_LICENSE_TEMPLATE = Object.freeze({
  spdx: 'LicenseRef-PolyForm-Noncommercial-1.0.0',
  attribution: 'Famling maintainers; placeholder art under LICENSE-ART (CC BY-NC-SA 4.0)',
})
/** First-party AI provenance anchor (deterministic placeholder art, no generative AI). */
export const CONTENT_AI_PROVENANCE_TEMPLATE = Object.freeze({
  generated: false,
  disclosure: '内置占位像素帧由确定性脚本生成，未使用生成式 AI；最终美术替换后须更新本声明。',
  tools: Object.freeze(['deterministic-python-renderer']),
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
/** Closed permission-token set accepted for packs/entries (schema-level allowlist). */
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
  maxSpdxChars: 64,
  maxLicenseAttributionChars: 200,
  maxAiDisclosureChars: 280,
  maxAiTools: 8,
  maxAiToolChars: 48,
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
const SPDX_RE = /^[A-Za-z0-9][A-Za-z0-9.+-]{1,63}$/
const AI_TOOL_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/

/**
 * The extension-point document. Treat it as read-only: it is frozen at every
 * level that a pack author needs to introspect (version, transport flags, pack
 * schema, entry schema, validation rules, reserved remote catalog).
 */
export const CONTENT_EXTENSION_POINTS = Object.freeze({
  /** Contract revision; bump only with a documented migration. */
  version: CONTENT_EXTENSION_VERSION,
  /** "reserved" = schema published, no pack loader ships in this package yet. */
  status: 'reserved',
  /** v3 compatibility policy reported by hello/probe and usable by pack tooling. */
  compatibility: CONTENT_EXTENSION_COMPATIBILITY,
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
  /**
   * v3 compliance metadata (0.10.9, MB-032/033): additive optional fields that
   * mirror the famling.content-pack/0.2 licence / AI provenance / compatibility
   * semantics without merging the two schemas. Validated fail closed when
   * present; missing values are warnings by default and errors only with
   * { requireCompliance: true }.
   */
  compliance: Object.freeze({
    additive: true,
    backwardCompatible: 'a pre-0.10.9 v3 pack without these fields still validates (warnings only)',
    strictOption: 'requireCompliance',
    strictRequires: ['pack.license', 'pack.aiProvenance', 'pack.compatibility', 'pack.usageDeclaration.statement', 'pack.usageDeclaration.statementRef'],
    packFields: ['license', 'aiProvenance', 'compatibility'],
    entryOptionalFields: ['license', 'aiProvenance'],
    license: Object.freeze({
      fields: ['spdx', 'attribution'],
      optionalFields: ['url', 'file'],
      spdxPattern: SPDX_RE.source,
      spdxExample: 'CC-BY-4.0',
      attributionMaxChars: CONTENT_LIMITS.maxLicenseAttributionChars,
      urlPolicy: 'https only, <= ' + CONTENT_LIMITS.maxCatalogUrlChars + ' chars, metadata only; never fetched',
      filePolicy: 'relative file path (at most 6 segments, file extension, no ".."/scheme/absolute path), never opened',
    }),
    aiProvenance: Object.freeze({
      fields: ['generated', 'disclosure'],
      optionalFields: ['tools'],
      disclosureMaxChars: CONTENT_LIMITS.maxAiDisclosureChars,
      toolsPolicy: '1..' + CONTENT_LIMITS.maxAiTools + ' lowercase tool ids (a-z0-9._-, <= ' + CONTENT_LIMITS.maxAiToolChars + ' chars), metadata only; never executed',
      note: 'generated=true needs a real disclosure; honest for deterministic or human-made content too',
    }),
    compatibility: Object.freeze({
      fields: ['minPluginVersion'],
      optionalFields: ['maxPluginVersion'],
      versionPattern: VERSION_RE.source,
      option: 'pluginVersion',
      note: 'host plugin version range; checked structurally always and against options.pluginVersion when provided (fail closed)',
    }),
    usageDeclaration: Object.freeze({
      optionalFields: ['statement', 'statementRef', 'statementSha256'],
      statement: CONTENT_USAGE_STATEMENT,
      statementRef: CONTENT_USAGE_STATEMENT_REF,
      statementSha256: CONTENT_USAGE_STATEMENT_SHA256,
      note: 'when restated these must equal the canonical shared anchors; strict mode requires statement + statementRef',
    }),
    anchors: Object.freeze({
      license: CONTENT_LICENSE_TEMPLATE,
      aiProvenance: CONTENT_AI_PROVENANCE_TEMPLATE,
      note: 'frozen first-party anchors shared with the client SHARED_CONTENT_SEMANTICS; third-party packs declare their own values',
    }),
  }),
  pack: Object.freeze({
    schemaVersion: CONTENT_PACK_SCHEMA_VERSION,
    fields: ['schemaVersion', 'id', 'name', 'version', 'source', 'usageDeclaration', 'entries'],
    optionalFields: ['permissions', 'assets', 'remoteCatalog', 'license', 'aiProvenance', 'compatibility'],
    sources: CONTENT_SOURCES,
    limits: CONTENT_LIMITS,
    idPattern: PACK_ID_RE.source,
    versionPattern: VERSION_RE.source,
    idExample: 'com.example.warm-pack',
    usageDeclaration: Object.freeze({
      required: true,
      researchOnly: true,
      prohibitedUses: PROHIBITED_USES,
      note: 'every pack (bundled/local/remote) must declare researchOnly=true and all six prohibited uses; a missing or mutated declaration is rejected. Since 0.10.9 an optional canonical statement/statementRef/statementSha256 may be restated and must equal the shared anchors (strict mode requires statement + statementRef)',
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
    /** kind, id, name, preview, apply, source, permissions and version are required; description / license / aiProvenance are optional; role entries also require compatibility. */
    fields: ['kind', 'id', 'name', 'description', 'preview', 'apply', 'source', 'permissions', 'version'],
    optionalFields: ['description', 'license', 'aiProvenance'],
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
    returns: Object.freeze({
      ok: 'boolean',
      errors: 'string[] (fail closed)',
      warnings: 'string[] (missing optional compliance metadata; never flips ok by itself)',
    }),
    options: Object.freeze({
      allowRemote: 'boolean (default false): reserved remote sources need an explicit future-host opt-in',
      requireCompliance: 'boolean (default false): require pack.license/aiProvenance/compatibility and the canonical usage statement/ref',
      pluginVersion: 'x.y.z (optional): compatibility ranges must admit this host version',
    }),
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
      'invalid licence / AI provenance / compatibility metadata',
      'mutated canonical usage statement/ref/SHA when declared',
      'compatibility ranges that exclude the provided options.pluginVersion',
    ],
  }),
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.prototype.toString.call(value) === '[object Object]'
}

function isBoundedText(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !BAD_TEXT_RE.test(value)
}

/**
 * Relative image path: no traversal, no scheme, bounded segments/extension. 
 * @param {unknown} value Candidate preview path from a pack.
 * @returns {boolean} True when safe to store/display as a relative image path.
 */
export function isSafeContentPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > CONTENT_LIMITS.maxPathChars) return false
  if (!PATH_RE.test(value) || value.startsWith('/') || value.includes('..') || value.includes('\\') || value.includes(':')) return false
  if (value.split('/').length > 3) return false
  return IMAGE_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension))
}

/**
 * Relative asset-pack path: data only, broader than an image preview.
 * @param {unknown} value Candidate asset path from a pack.
 * @returns {boolean} True when safe as a data-only relative path.
 */
export function isSafeAssetPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > CONTENT_LIMITS.maxAssetPathChars) return false
  if (!PATH_RE.test(value) || value.startsWith('/') || value.includes('..') || value.includes('\\') || value.includes(':')) return false
  const segments = value.split('/')
  if (segments.length > 6) return false
  return ASSET_FILE_RE.test(segments[segments.length - 1])
}

/**
 * Relative licence/NOTICE file path: the same data-only relative-path policy as
 * an asset file (bounded segments, file extension, no traversal/scheme/absolute
 * path). The file is listed as metadata only and is never opened by this
 * package.
 * @param {unknown} value Candidate licence/NOTICE file path from a pack.
 * @returns {boolean} True when the path follows the data-only asset policy.
 */
export function isSafeLicenseFile(value) {
  return isSafeAssetPath(value)
}

/**
 * Reserved remote-catalog URL: absolute https only, metadata only, never fetched.
 * @param {unknown} value Candidate catalog URL from a pack.
 * @returns {boolean} True when it is an absolute credential-free https URL.
 */
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
 * @param {unknown} value Candidate local font stack from a pack.
 * @returns {boolean} True when the stack is a bounded local-family list.
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

/**
 * Whether a v3 compatibility range (minPluginVersion + optional
 * maxPluginVersion) admits a concrete plugin version. Malformed ranges/versions
 * fail closed; a range without a host version cannot be decided.
 * @param {unknown} compatibility Candidate compatibility object.
 * @param {unknown} pluginVersion Concrete host/plugin version (x.y.z).
 * @returns {boolean}
 */
export function isPackCompatibleWithPlugin(compatibility, pluginVersion) {
  if (!isPlainObject(compatibility)) return false
  if (typeof pluginVersion !== 'string' || !VERSION_RE.test(pluginVersion)) return false
  const plugin = versionTuple(pluginVersion)
  const min = typeof compatibility.minPluginVersion === 'string' && VERSION_RE.test(compatibility.minPluginVersion) ? versionTuple(compatibility.minPluginVersion) : null
  const max = compatibility.maxPluginVersion === undefined ? null : (typeof compatibility.maxPluginVersion === 'string' && VERSION_RE.test(compatibility.maxPluginVersion) ? versionTuple(compatibility.maxPluginVersion) : undefined)
  if (!plugin || !min || max === undefined) return false
  return versionLessOrEqual(min, plugin) && (max === null || versionLessOrEqual(plugin, max))
}

/**
 * v3 pack-wide declaration: researchOnly plus every prohibited-use token. The
 * optional canonical statement/ref/SHA (0.10.9) must match the shared anchors
 * when declared. Strict mode (options.requireCompliance) additionally requires
 * statement + statementRef; a pre-0.10.9 declaration without them stays valid.
 */
function validateUsageDeclaration(value, where, errors, strict = false) {
  if (!isPlainObject(value)) {
    errors.push(where + ': must be a plain object')
    return
  }
  exactKeys(value, ['researchOnly', 'prohibitedUses'], ['statement', 'statementRef', 'statementSha256'], where, errors)
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
  if (value.statement !== undefined && value.statement !== CONTENT_USAGE_STATEMENT) {
    errors.push(where + '.statement: must equal the canonical shared research-only statement')
  }
  if (value.statementRef !== undefined && value.statementRef !== CONTENT_USAGE_STATEMENT_REF) {
    errors.push(where + '.statementRef: must equal ' + CONTENT_USAGE_STATEMENT_REF)
  }
  if (value.statementSha256 !== undefined && value.statementSha256 !== CONTENT_USAGE_STATEMENT_SHA256) {
    errors.push(where + '.statementSha256: must equal the canonical statement SHA-256')
  }
  if (strict) {
    if (value.statement === undefined) errors.push(where + '.statement: required when options.requireCompliance is true')
    if (value.statementRef === undefined) errors.push(where + '.statementRef: required when options.requireCompliance is true')
  }
}

/**
 * v3 compliance metadata (0.10.9): pack/entry licence. Pure metadata: the
 * optional HTTPS url is never fetched and the optional relative file is never
 * opened.
 */
function validateLicense(value, where, errors) {
  if (!isPlainObject(value)) {
    errors.push(where + ': must be a plain object')
    return
  }
  exactKeys(value, ['spdx', 'attribution'], ['url', 'file'], where, errors)
  if (typeof value.spdx !== 'string' || value.spdx.length > CONTENT_LIMITS.maxSpdxChars || !SPDX_RE.test(value.spdx)) {
    errors.push(where + '.spdx: SPDX-style licence id 2..' + CONTENT_LIMITS.maxSpdxChars + ' chars (e.g. CC-BY-4.0 or LicenseRef-...)')
  }
  if (!isBoundedText(value.attribution, CONTENT_LIMITS.maxLicenseAttributionChars)) {
    errors.push(where + '.attribution: 1..' + CONTENT_LIMITS.maxLicenseAttributionChars + ' plain chars')
  }
  if (value.url !== undefined && !isSafeHttpsUrl(value.url)) {
    errors.push(where + '.url: absolute https URL, metadata only (never fetched)')
  }
  if (value.file !== undefined && !isSafeLicenseFile(value.file)) {
    errors.push(where + '.file: relative licence file path with a file extension, no traversal/scheme/absolute path')
  }
}

/**
 * v3 compliance metadata (0.10.9): AI/automation provenance. Honest either way;
 * tools are metadata only and never executed.
 */
function validateAiProvenance(value, where, errors) {
  if (!isPlainObject(value)) {
    errors.push(where + ': must be a plain object')
    return
  }
  exactKeys(value, ['generated', 'disclosure'], ['tools'], where, errors)
  if (typeof value.generated !== 'boolean') errors.push(where + '.generated: boolean')
  if (!isBoundedText(value.disclosure, CONTENT_LIMITS.maxAiDisclosureChars)) {
    errors.push(where + '.disclosure: 1..' + CONTENT_LIMITS.maxAiDisclosureChars + ' plain chars')
  } else if (value.generated === true && value.disclosure.trim().length < 4) {
    errors.push(where + '.disclosure: AI-generated content needs a real disclosure')
  }
  if (value.tools !== undefined) {
    const tools = value.tools
    if (!Array.isArray(tools) || tools.length === 0 || tools.length > CONTENT_LIMITS.maxAiTools) {
      errors.push(where + '.tools: array of 1..' + CONTENT_LIMITS.maxAiTools + ' tool ids')
      return
    }
    const seen = new Set()
    for (const tool of tools) {
      if (typeof tool !== 'string' || tool.length > CONTENT_LIMITS.maxAiToolChars || !AI_TOOL_RE.test(tool)) {
        errors.push(where + '.tools: lowercase tool id <= ' + CONTENT_LIMITS.maxAiToolChars + ' chars (a-z0-9._-)')
        continue
      }
      if (seen.has(tool)) errors.push(where + '.tools: duplicate tool id "' + tool + '"')
      seen.add(tool)
    }
  }
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

/**
 * Compatibility range (0.10.9): used by role entries (required) and by the
 * optional pack-level compatibility field. Structural validation always runs;
 * when options.pluginVersion is a concrete x.y.z it must fall inside the range
 * (fail closed). This is the v3 side of the v2 pack compatibility metadata:
 * same min/max host-version semantics, plugin-owned version instead of app.
 */
function validateCompatibility(value, where, errors, pluginVersion) {
  if (!isPlainObject(value)) {
    errors.push(where + ': must be a plain object')
    return
  }
  const before = errors.length
  exactKeys(value, ['minPluginVersion'], ['maxPluginVersion'], where, errors)
  const min = typeof value.minPluginVersion === 'string' && VERSION_RE.test(value.minPluginVersion) ? versionTuple(value.minPluginVersion) : null
  const max = value.maxPluginVersion === undefined ? null : (typeof value.maxPluginVersion === 'string' && VERSION_RE.test(value.maxPluginVersion) ? versionTuple(value.maxPluginVersion) : undefined)
  if (min === null) errors.push(where + '.minPluginVersion: semver x.y.z')
  if (max === undefined || (value.maxPluginVersion !== undefined && max === null)) errors.push(where + '.maxPluginVersion: semver x.y.z')
  if (min && max && !versionLessOrEqual(min, max)) errors.push(where + ': minPluginVersion must be <= maxPluginVersion')
  if (pluginVersion !== undefined && errors.length === before) {
    if (!isPackCompatibleWithPlugin(value, pluginVersion)) {
      errors.push(where + ': excludes the current plugin version ' + pluginVersion + ' (minPluginVersion/maxPluginVersion)')
    }
  }
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

/** Validate one entry (schema fields + per-kind apply payload + compliance). */
function validateEntry(entry, index, packSource, errors, pluginVersion) {
  const where = 'entries[' + index + ']'
  if (!isPlainObject(entry)) {
    errors.push(where + ': must be a plain object')
    return
  }
  const required = ['kind', 'id', 'name', 'preview', 'apply', 'source', 'permissions', 'version']
  const optional = ['description', 'license', 'aiProvenance']
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
    validateCompatibility(entry.compatibility, where + '.compatibility', errors, pluginVersion)
    if (entry.usageDeclaration !== undefined) validateUsageDeclaration(entry.usageDeclaration, where + '.usageDeclaration', errors)
  }
  if (entry.license !== undefined) validateLicense(entry.license, where + '.license', errors)
  if (entry.aiProvenance !== undefined) validateAiProvenance(entry.aiProvenance, where + '.aiProvenance', errors)
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
 * Compliance is backward compatible: license / aiProvenance / compatibility and
 * the canonical usage statement are optional in v3 (missing ones are reported
 * in `warnings`), and a host that loads untrusted packs can opt into fail-closed
 * validation with { requireCompliance: true }. A concrete host version can be
 * supplied as { pluginVersion: 'x.y.z' } to check the declared compatibility
 * ranges.
 *
 * @param {unknown} pack Candidate pack document (see CONTENT_EXTENSION_POINTS.pack).
 * @param {{ allowRemote?: boolean, requireCompliance?: boolean, pluginVersion?: string }} [options]
 *   Remote sources are rejected by default; requireCompliance makes the
 *   compliance metadata mandatory (fail closed); pluginVersion checks the
 *   compatibility ranges against a concrete host.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateContentPack(pack, options = {}) {
  const errors = []
  const warnings = []
  scanData(pack, 0, 'pack', errors)
  if (!isPlainObject(pack)) {
    return { ok: false, errors: errors.length > 0 ? errors : ['pack: must be a plain object'], warnings: [] }
  }
  const requireCompliance = options.requireCompliance === true
  const pluginVersion = typeof options.pluginVersion === 'string' && VERSION_RE.test(options.pluginVersion) ? options.pluginVersion : undefined
  if (options.pluginVersion !== undefined && pluginVersion === undefined) {
    errors.push('options.pluginVersion: semver x.y.z (compatibility ranges cannot be checked)')
  }
  exactKeys(pack, ['schemaVersion', 'id', 'name', 'version', 'source', 'usageDeclaration', 'entries'], ['permissions', 'assets', 'remoteCatalog', 'license', 'aiProvenance', 'compatibility'], 'pack', errors)
  if (pack.schemaVersion !== CONTENT_PACK_SCHEMA_VERSION) errors.push('pack.schemaVersion: must be ' + CONTENT_PACK_SCHEMA_VERSION)
  if (typeof pack.id !== 'string' || !PACK_ID_RE.test(pack.id)) errors.push('pack.id: must match the pack id pattern')
  if (!isBoundedText(pack.name, CONTENT_LIMITS.maxNameChars)) errors.push('pack.name: 1..' + CONTENT_LIMITS.maxNameChars + ' plain chars')
  if (typeof pack.version !== 'string' || !VERSION_RE.test(pack.version)) errors.push('pack.version: semver x.y.z')
  if (!CONTENT_SOURCES.includes(pack.source)) errors.push('pack.source: must be one of ' + CONTENT_SOURCES.join('/'))
  else if (pack.source === 'remote' && options.allowRemote !== true) errors.push('pack.source: remote packs are reserved; a future host must opt in with { allowRemote: true }')
  validateUsageDeclaration(pack.usageDeclaration, 'pack.usageDeclaration', errors, requireCompliance)
  if (pack.license !== undefined) validateLicense(pack.license, 'pack.license', errors)
  if (pack.aiProvenance !== undefined) validateAiProvenance(pack.aiProvenance, 'pack.aiProvenance', errors)
  if (pack.compatibility !== undefined) validateCompatibility(pack.compatibility, 'pack.compatibility', errors, pluginVersion)
  for (const field of ['license', 'aiProvenance', 'compatibility']) {
    if (pack[field] !== undefined) continue
    if (requireCompliance) errors.push('pack.' + field + ': required when options.requireCompliance is true')
    else warnings.push('pack.' + field + ': missing optional compliance metadata (backward compatible; required by options.requireCompliance)')
  }
  if (!requireCompliance && isPlainObject(pack.usageDeclaration) && (pack.usageDeclaration.statement === undefined || pack.usageDeclaration.statementRef === undefined)) {
    warnings.push('pack.usageDeclaration.statement: canonical statement/ref not restated (recommended; required by options.requireCompliance)')
  }
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
    validateEntry(entry, index, pack.source, errors, pluginVersion)
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
  return {
    ok: errors.length === 0,
    errors: errors.slice(0, CONTENT_LIMITS.maxErrors),
    warnings: warnings.slice(0, CONTENT_LIMITS.maxErrors),
  }
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
  usageDeclaration: Object.freeze({
    researchOnly: true,
    prohibitedUses: PROHIBITED_USES,
    statement: CONTENT_USAGE_STATEMENT,
    statementRef: CONTENT_USAGE_STATEMENT_REF,
    statementSha256: CONTENT_USAGE_STATEMENT_SHA256,
  }),
  license: Object.freeze({ spdx: 'CC-BY-4.0', attribution: 'Example pack authors' }),
  aiProvenance: Object.freeze({
    generated: false,
    disclosure: 'Example content is written by hand; no generative AI was used.',
    tools: Object.freeze(['deterministic-python-renderer']),
  }),
  compatibility: Object.freeze({ minPluginVersion: '0.10.0' }),
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
      usageDeclaration: {
        researchOnly: true,
        prohibitedUses: PROHIBITED_USES,
        statement: CONTENT_USAGE_STATEMENT,
        statementRef: CONTENT_USAGE_STATEMENT_REF,
        statementSha256: CONTENT_USAGE_STATEMENT_SHA256,
      },
      license: { spdx: 'CC-BY-4.0', attribution: 'Example pack authors' },
      aiProvenance: { generated: false, disclosure: 'Example role bundle is written by hand; no generative AI was used.' },
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
