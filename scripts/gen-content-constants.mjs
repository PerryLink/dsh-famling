#!/usr/bin/env node
/**
 * Generate the plugin's shared content + interaction constants from famling.
 *
 * MB-107 (E3): the plugin cannot import the famling checkout at runtime, so the
 * shared catalog and the event->clip table are generated into client.js from the
 * authoritative famling files. Two generated marker pairs live inside the
 * existing hand-written feature blocks:
 *
 *   - CONTENT constants (inside <dsh-famling:content:*>): dialogue modes, theme
 *     ids, backgrounds, fonts, role bundles, SHARED_CONTENT_SEMANTICS and
 *     USAGE_DECLARATION;
 *   - ACTIONS constants (inside <dsh-famling:actions:*>): EVENT_CLIPS and
 *     MICRO_LINES.
 *
 * Sources of truth (sibling private famling checkout):
 *   - public/content/library.json                 roles / dialogue / appearance / usage
 *   - public/characters/<dir>/behavior.json       slots/states/rules/ambient choices
 *   - public/characters/<dir>/regions.json        tap regions and gesture/action events
 *   - public/assets/pet/anim/<kind>/manifest.json clip ids (valid event targets)
 *   - docs/legal/USE-RESTRICTIONS-2026-11-19.md   canonical usage statement (hashed)
 *
 * Declared plugin-only deltas are applied deterministically, never silently:
 * D1 plugin character id space, D2 origami unavailable (library products),
 * D3 high-contrast theme -> night, D4 widget palette/background fg, and
 * sound = canTts && available. See docs/CONTENT-CONSTANTS-2026-11-20.md and
 * famling docs/plan/SHARED-CONTENT-SEMANTICS-2026-11-19.md section 3.
 *
 * Usage:
 *   node scripts/gen-content-constants.mjs                  # inject / refresh
 *   node scripts/gen-content-constants.mjs --check          # fail when stale
 *   node scripts/gen-content-constants.mjs --famling DIR    # explicit checkout
 *   node scripts/gen-content-constants.mjs --root DIR       # explicit plugin root
 *
 * No network, no dependencies: Node builtins plus this package's own
 * embed-anims.mjs event whitelist.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ACTION_EVENTS } from './embed-anims.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Absolute plugin package root (the directory that contains client.js). */
export const PLUGIN_ROOT = resolve(HERE, '..')
/** Absolute path of the plugin first-screen entry that receives the blocks. */
export const CLIENT_PATH = join(PLUGIN_ROOT, 'client.js')
/** Default sibling famling checkout; override with --famling / FAMLING_REPO_DIR. */
export const DEFAULT_FAMLING_ROOT = resolve(PLUGIN_ROOT, '..', '..', 'desktop-games')
/** Marker pair that brackets the generated content catalog constants. */
export const CONTENT_BEGIN = '// <dsh-famling:content-constants:begin>'
/** Closing marker of the generated content catalog constants. */
export const CONTENT_END = '// <dsh-famling:content-constants:end>'
/** Marker pair that brackets the generated event->clip / micro-line constants. */
export const ACTIONS_BEGIN = '// <dsh-famling:event-clips:begin>'
/** Closing marker of the generated event->clip / micro-line constants. */
export const ACTIONS_END = '// <dsh-famling:event-clips:end>'

/** Plugin character kind -> famling character directory (shared with embed-anims). */
export const CHARACTER_DIRS = Object.freeze({ human: 'pet-tinglan-anim', cat: 'pet-cat', dog: 'pet-dog' })

/** Canonical character order for deriving EVENT_CLIPS (deterministic output). */
const CHARACTER_ORDER = Object.freeze(['dog', 'cat', 'human'])
/** Canonical character order for deriving MICRO_LINES (human first, as in client.js). */
const MICRO_ORDER = Object.freeze(['human', 'cat', 'dog'])
/** Declared theme ids the plugin does not implement, with their fallback (D3). */
const PLUGIN_THEME_FALLBACK = Object.freeze({ 'high-contrast': 'night' })
/** Plugin-owned widget foreground per shared background id (D4 projection). */
const BACKGROUND_FG = Object.freeze({ transparent: 'inherit', paper: '#2b2620', dark: '#e8eaf0' })
/** Plugin locale keys for each character's non-idle ambient micro action. */
const MICRO_LINE_KEYS = Object.freeze({
  human: Object.freeze({ paw_face: 'coverFaceLine', scratch: 'stretchLine', stand_wag: 'waveLine', chase_tail: 'lookBackLine' }),
  cat: Object.freeze({ paw_face: 'catWashLine', scratch: 'catScratchLine', stand_wag: 'catStandLine', chase_tail: 'catTailLine' }),
  dog: Object.freeze({ paw_face: 'dogLickLine', scratch: 'dogScratchLine', stand_wag: 'dogWagLine', chase_tail: 'dogTailLine' }),
})
/** Plugin font preset size/line height added to the shared font family (D4). */
const FONT_SIZE = 12
/** Plugin font preset line height added to the shared font family (D4). */
const FONT_LINE_HEIGHT = 1.5
/** Canonical legal anchor that must contain the shared usage statement + SHA. */
const LEGAL_ANCHOR_PATH = 'docs/legal/USE-RESTRICTIONS-2026-11-19.md'
/** Every famling file hashed into the generated-block source digest. */
const CONTENT_SOURCE_PATHS = Object.freeze([
  LEGAL_ANCHOR_PATH,
  'public/assets/pet/anim/cat/manifest.json',
  'public/assets/pet/anim/dog/manifest.json',
  'public/assets/pet/anim/human/manifest.json',
  'public/characters/pet-cat/behavior.json',
  'public/characters/pet-cat/regions.json',
  'public/characters/pet-dog/behavior.json',
  'public/characters/pet-dog/regions.json',
  'public/characters/pet-tinglan-anim/behavior.json',
  'public/characters/pet-tinglan-anim/regions.json',
  'public/content/library.json',
])

/**
 * Throw a generator error with a stable prefix and a readable cause.
 * @param {unknown} condition Truthy when the invariant holds.
 * @param {string} message Human-readable invariant description.
 * @returns {void}
 */
function ensure(condition, message) {
  if (!condition) throw new Error('[gen-content-constants] ' + message)
}

/**
 * Read one famling input file as UTF-8 with a clear missing-file error.
 * @param {string} famlingRoot Absolute famling checkout root.
 * @param {string} relativePath Repository-relative input path.
 * @returns {string} File contents.
 */
function readText(famlingRoot, relativePath) {
  const absolute = join(famlingRoot, relativePath)
  ensure(existsSync(absolute), 'missing famling source file: ' + relativePath)
  return readFileSync(absolute, 'utf8')
}

/**
 * Read one famling input file and parse it as JSON.
 * @param {string} famlingRoot Absolute famling checkout root.
 * @param {string} relativePath Repository-relative input path.
 * @returns {any} Parsed JSON document.
 */
function readJson(famlingRoot, relativePath) {
  const text = readText(famlingRoot, relativePath)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('[gen-content-constants] invalid JSON in ' + relativePath + ': ' + (error && error.message))
  }
}

/**
 * Resolve the famling checkout root, or null when the checkout is absent.
 * Explicit argument wins over FAMLING_REPO_DIR; the sibling default matches
 * embed-anims.mjs. A path without public/content/library.json counts as absent.
 * @param {string} [explicit] Optional --famling value (absolute or relative).
 * @returns {string | null} Absolute checkout root or null.
 */
export function resolveFamlingRoot(explicit) {
  const candidate = explicit || process.env.FAMLING_REPO_DIR || DEFAULT_FAMLING_ROOT
  if (!candidate) return null
  const root = resolve(candidate)
  return existsSync(join(root, 'public', 'content', 'library.json')) ? root : null
}

/**
 * Hash every authoritative input into one deterministic source digest. The same
 * digest is written into both generated banners so a stale block is detectable
 * from client.js alone, without the famling checkout.
 * @param {string} famlingRoot Absolute famling checkout root.
 * @returns {string} Lowercase hex SHA-256 over (relative path, bytes) pairs.
 */
function digestSources(famlingRoot) {
  const hash = createHash('sha256')
  for (const relativePath of CONTENT_SOURCE_PATHS) {
    ensure(existsSync(join(famlingRoot, relativePath)), 'missing famling source file: ' + relativePath)
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readFileSync(join(famlingRoot, relativePath)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Format a JS string literal deterministically using the style already present in
 * client.js: single quotes unless the value itself contains a single quote.
 * @param {string} value String value to quote.
 * @returns {string} JavaScript literal.
 */
function quote(value) {
  ensure(typeof value === 'string', 'cannot quote a non-string value')
  if (value.includes("'")) return JSON.stringify(value)
  return "'" + value + "'"
}

/**
 * Render one array of strings as a single-line JS array literal.
 * @param {string[]} values String values in order.
 * @returns {string} JavaScript array literal.
 */
function renderStringArray(values) {
  return '[' + values.map(quote).join(', ') + ']'
}

/**
 * Render one flat object of CSS custom properties as an inline JS object.
 * @param {Record<string, string>} vars CSS variable name -> value.
 * @returns {string} JavaScript object literal.
 */
function renderVars(vars) {
  return '{ ' + Object.keys(vars).map((key) => quote(key) + ': ' + quote(vars[key])).join(', ') + ' }'
}

/**
 * Derive the plugin catalog constants from famling public/content/library.json.
 * Validates every referenced id exists and applies only the declared deltas.
 * @param {any} library Parsed famling library.json document.
 * @param {string} famlingRoot Absolute famling checkout root (legal anchor).
 * @returns {any} Catalog model consumed by renderContentBlock().
 */
function deriveCatalog(library, famlingRoot) {
  ensure(library && typeof library === 'object', 'library.json is not an object')
  ensure(Array.isArray(library.rolePresets) && library.rolePresets.length > 0, 'library.json has no rolePresets')
  const dialogue = Array.isArray(library.dialoguePacks) ? library.dialoguePacks : []
  const dialogueModeIds = dialogue.map((pack) => pack.id)
  /** @type {Record<string, { maxChars: number, bubbleChance: number }>} */
  const dialogueModes = {}
  for (const pack of dialogue) {
    ensure(typeof pack.maxChars === 'number' && typeof pack.bubbleChance === 'number', 'dialogue pack ' + pack.id + ' has no maxChars/bubbleChance')
    dialogueModes[pack.id] = { maxChars: pack.maxChars, bubbleChance: pack.bubbleChance }
  }
  ensure(dialogueModeIds.length > 0, 'library.json has no dialoguePacks')
  const libraryThemes = Array.isArray(library.themes) ? library.themes : []
  const themeIds = libraryThemes.map((theme) => theme.id).filter((id) => !Object.prototype.hasOwnProperty.call(PLUGIN_THEME_FALLBACK, id))
  ensure(themeIds.length > 0, 'library.json has no plugin-implemented themes')
  const backgrounds = Array.isArray(library.backgrounds) ? library.backgrounds : []
  const backgroundIds = backgrounds.map((background) => background.id)
  /** @type {Record<string, Record<string, string>>} */
  const backgroundVars = {}
  for (const background of backgrounds) {
    ensure(typeof background.value === 'string' && background.value.length > 0, 'background ' + background.id + ' has no value')
    ensure(Object.prototype.hasOwnProperty.call(BACKGROUND_FG, background.id), 'background "' + background.id + '" has no declared plugin widget-fg; update BACKGROUND_FG first')
    backgroundVars[background.id] = { '--dsh-famling-widget-bg': background.value, '--dsh-famling-widget-fg': BACKGROUND_FG[background.id] }
  }
  ensure(backgroundIds.length > 0, 'library.json has no backgrounds')
  const fonts = Array.isArray(library.fonts) ? library.fonts : []
  const fontIds = fonts.map((font) => font.id)
  /** @type {Record<string, { family: string }>} */
  const fontFamilies = {}
  for (const font of fonts) {
    ensure(typeof font.family === 'string' && font.family.length > 0, 'font ' + font.id + ' has no family stack')
    fontFamilies[font.id] = { family: font.family }
  }
  ensure(fontIds.length > 0, 'library.json has no fonts')
  const characterById = new Map((Array.isArray(library.characters) ? library.characters : []).map((character) => [character.id, character]))
  /** @type {Record<string, any>} */
  const roleBundles = {}
  /** @type {string[]} */
  const roleIds = []
  for (const preset of library.rolePresets) {
    const character = characterById.get(preset.characterId)
    ensure(character, 'role preset "' + preset.id + '": character "' + preset.characterId + '" is missing from library.characters')
    ensure(Object.prototype.hasOwnProperty.call(dialogueModes, preset.dialoguePackId), 'role preset "' + preset.id + '": unknown dialoguePackId "' + preset.dialoguePackId + '"')
    const available = Array.isArray(character.products) && character.products.includes('dsh-famling')
    const canTts = typeof preset.voiceId === 'string' && preset.voiceId !== 'none'
    const appearance = preset.appearance || {}
    const implementationTheme = themeIds.includes(appearance.themeId) ? appearance.themeId : PLUGIN_THEME_FALLBACK[appearance.themeId]
    ensure(themeIds.includes(implementationTheme), 'role preset "' + preset.id + '": theme "' + appearance.themeId + '" is neither implemented nor declared in PLUGIN_THEME_FALLBACK')
    ensure(backgroundIds.includes(appearance.backgroundId), 'role preset "' + preset.id + '": unknown backgroundId "' + appearance.backgroundId + '"')
    ensure(fontIds.includes(appearance.fontId), 'role preset "' + preset.id + '": unknown fontId "' + appearance.fontId + '"')
    roleBundles[preset.id] = {
      character: preset.id,
      voicePolicy: { canTts, mode: canTts ? 'speech' : 'thought', sound: canTts && available },
      dialogue: preset.dialoguePackId,
      theme: implementationTheme,
      background: appearance.backgroundId,
      font: { family: appearance.fontId, size: FONT_SIZE, lineHeight: FONT_LINE_HEIGHT },
      available,
    }
    if (available) roleIds.push(preset.id)
  }
  ensure(roleIds.length > 0, 'no library.rolePresets are available to dsh-famling')
  ensure(Object.prototype.hasOwnProperty.call(roleBundles, library.defaultRoleTheme) && roleBundles[library.defaultRoleTheme].available, 'defaultRoleTheme "' + library.defaultRoleTheme + '" is not an available plugin role')
  const declarations = library.rolePresets.map((preset) => preset.usageDeclaration)
  for (const declaration of declarations) {
    ensure(declaration && typeof declaration === 'object', 'role preset usageDeclaration is missing')
    ensure(declaration.researchOnly === true, 'usageDeclaration.researchOnly must be true')
    ensure(typeof declaration.statement === 'string', 'usageDeclaration.statement is missing')
    ensure(typeof declaration.statementRef === 'string', 'usageDeclaration.statementRef is missing')
    ensure(Array.isArray(declaration.prohibitedUses), 'usageDeclaration.prohibitedUses is missing')
  }
  const referenceDeclaration = declarations[0]
  for (const declaration of declarations) {
    ensure(declaration.statement === referenceDeclaration.statement, 'rolePresets disagree on usageDeclaration.statement')
    ensure(declaration.statementRef === referenceDeclaration.statementRef, 'rolePresets disagree on usageDeclaration.statementRef')
    ensure(JSON.stringify(declaration.prohibitedUses) === JSON.stringify(referenceDeclaration.prohibitedUses), 'rolePresets disagree on usageDeclaration.prohibitedUses')
  }
  const licenseJson = JSON.stringify(library.rolePresets[0].license)
  const aiJson = JSON.stringify(library.rolePresets[0].aiProvenance)
  for (const preset of library.rolePresets) ensure(JSON.stringify(preset.license) === licenseJson, 'rolePresets disagree on license')
  for (const preset of library.rolePresets) ensure(JSON.stringify(preset.aiProvenance) === aiJson, 'rolePresets disagree on aiProvenance')
  const usageStatementSha256 = createHash('sha256').update(referenceDeclaration.statement, 'utf8').digest('hex')
  const legalSource = readText(famlingRoot, LEGAL_ANCHOR_PATH)
  ensure(legalSource.includes(referenceDeclaration.statement), 'legal anchor does not contain the canonical usage statement')
  ensure(legalSource.includes(usageStatementSha256), 'legal anchor does not contain the canonical usage statement SHA-256')
  return {
    dialogueModeIds,
    dialogueModes,
    themeIds,
    backgroundIds: backgroundIds,
    backgrounds: backgroundVars,
    fontIds,
    fonts: fontFamilies,
    roleIds,
    roleBundles,
    sharedContentSemantics: {
      schema: library.schema,
      version: library.version,
      updatedAt: library.updatedAt,
      defaultRole: library.defaultRoleTheme,
      characterIdMap: Object.fromEntries(library.rolePresets.map((preset) => [preset.id, preset.characterId])),
      usageStatement: referenceDeclaration.statement,
      usageStatementSha256,
      usageStatementRef: referenceDeclaration.statementRef,
      license: library.rolePresets[0].license,
      aiProvenance: library.rolePresets[0].aiProvenance,
    },
    usageDeclaration: {
      researchOnly: true,
      prohibitedUses: referenceDeclaration.prohibitedUses.slice(),
    },
  }
}

/**
 * Read the clip ids from the three animation manifests and require one shared set.
 * @param {Record<string, any>} manifests Parsed manifest.json per character.
 * @returns {string[]} Shared clip ids in manifest order.
 */
function deriveClipIds(manifests) {
  let clipIds = null
  for (const kind of CHARACTER_ORDER) {
    const tags = manifests[kind] && manifests[kind].tags
    ensure(tags && typeof tags === 'object', kind + ': manifest.tags is missing')
    const ids = Object.keys(tags)
    ensure(ids.length > 0, kind + ': manifest.tags is empty')
    if (clipIds === null) clipIds = ids
    else ensure(JSON.stringify(ids) === JSON.stringify(clipIds), kind + ': manifest clip ids differ from ' + CHARACTER_ORDER[0])
  }
  return clipIds
}

/**
 * Resolve one interaction event to a clip id for one character through its
 * behavior rule -> state -> tag chain. A tag of "idle" means bubble-only (null).
 * @param {string} kind Character kind (human/cat/dog).
 * @param {string} event Interaction event name.
 * @param {any} behavior Parsed behavior.json for that character.
 * @param {string[]} clipIds Valid clip ids from the manifests.
 * @returns {string | null} Target clip id, or null for bubble-only events.
 */
function resolveEventClip(kind, event, behavior, clipIds) {
  const rules = Array.isArray(behavior.rules) ? behavior.rules : []
  const rule = rules.find((candidate) => candidate && candidate.on === event)
  ensure(rule, kind + ': behavior.json has no rule for event "' + event + '"')
  const state = behavior.states && behavior.states[rule.to]
  ensure(state && typeof state.tag === 'string', kind + ': rule "' + event + '" targets state "' + rule.to + '" without a tag')
  if (state.tag === 'idle') return null
  ensure(clipIds.includes(state.tag), kind + ': event "' + event + '" targets "' + state.tag + '" which is not a manifest clip id')
  return state.tag
}

/**
 * Derive EVENT_CLIPS from the famling interaction surface: every region gesture
 * event, every species action event and every non-idle ambient micro state. The
 * three characters must resolve the event to the same target; order is stable
 * (gestures, then menu actions, then ambient-only states).
 * @param {Record<string, any>} behaviors Parsed behavior.json per character.
 * @param {Record<string, any>} regions Parsed regions.json per character.
 * @param {string[]} clipIds Valid clip ids from the manifests.
 * @returns {Record<string, string | null>} Generated event -> clip table.
 */
function deriveEventClips(behaviors, regions, clipIds) {
  const ordered = []
  const seen = new Set()
  const addEvent = (event, where) => {
    ensure(typeof event === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(event), where + ': unsafe event name "' + String(event) + '"')
    if (seen.has(event)) return
    seen.add(event)
    ordered.push(event)
  }
  for (const kind of CHARACTER_ORDER) for (const gesture of regions[kind].gestures || []) addEvent(gesture.event, kind + '/gestures')
  for (const kind of CHARACTER_ORDER) for (const action of regions[kind].actions || []) addEvent(action.event, kind + '/actions')
  for (const kind of CHARACTER_ORDER) {
    for (const choice of (behaviors[kind].ambient && behaviors[kind].ambient.choices) || []) {
      if (choice.state === 'idle' || choice.state === 'idle_blink') continue
      addEvent(choice.state, kind + '/ambient')
    }
  }
  ensure(ordered.length > 0, 'no interaction events found in regions/behavior')
  /** @type {Record<string, string | null>} */
  const eventClips = {}
  for (const event of ordered) {
    ensure(ACTION_EVENTS.includes(event), 'event "' + event + '" is not in embed-anims.mjs ACTION_EVENTS; extend ACTION_EVENTS and verify-anims.mjs first')
    const targets = CHARACTER_ORDER.map((kind) => resolveEventClip(kind, event, behaviors[kind], clipIds))
    for (const target of targets) ensure(target === targets[0], 'event "' + event + '": the three character behaviors disagree on the target clip')
    eventClips[event] = targets[0]
  }
  ensure(eventClips.talk === null, 'talk must resolve to bubble-only null')
  return eventClips
}

/**
 * Derive MICRO_LINES: each character's non-idle ambient micro action (resolved to
 * its clip id) mapped to the plugin locale key from MICRO_LINE_KEYS.
 * @param {Record<string, any>} behaviors Parsed behavior.json per character.
 * @param {string[]} clipIds Valid clip ids from the manifests.
 * @returns {Record<string, Record<string, string>>} character -> clip -> locale key.
 */
function deriveMicroLines(behaviors, clipIds) {
  /** @type {Record<string, Record<string, string>>} */
  const microLines = {}
  for (const kind of MICRO_ORDER) {
    const behavior = behaviors[kind]
    const entries = []
    for (const choice of (behavior.ambient && behavior.ambient.choices) || []) {
      if (choice.state === 'idle' || choice.state === 'idle_blink') continue
      const state = behavior.states && behavior.states[choice.state]
      ensure(state && typeof state.tag === 'string', kind + ': ambient state "' + choice.state + '" has no tag')
      ensure(clipIds.includes(state.tag), kind + ': ambient state "' + choice.state + '" maps to missing clip "' + state.tag + '"')
      const key = MICRO_LINE_KEYS[kind] && MICRO_LINE_KEYS[kind][state.tag]
      ensure(typeof key === 'string' && key.length > 0, kind + ': no plugin locale key for micro action "' + state.tag + '"; update MICRO_LINE_KEYS')
      if (!entries.some((entry) => entry[0] === state.tag)) entries.push([state.tag, key])
    }
    ensure(entries.length > 0, kind + ': no non-idle ambient micro actions')
    microLines[kind] = Object.fromEntries(entries)
  }
  return microLines
}

/**
 * Derive the complete generated model from one famling checkout.
 * @param {string} famlingRoot Absolute famling checkout root.
 * @returns {{ catalog: any, eventClips: Record<string, string | null>, microLines: Record<string, Record<string, string>>, sourceSha256: string, clipIds: string[] }} Model used by the renderers, generate() and tests.
 */
export function deriveConstants(famlingRoot) {
  ensure(typeof famlingRoot === 'string' && famlingRoot.length > 0, 'deriveConstants requires a famling checkout root')
  const library = readJson(famlingRoot, 'public/content/library.json')
  const manifests = {}
  const behaviors = {}
  const regions = {}
  for (const kind of CHARACTER_ORDER) {
    const directory = CHARACTER_DIRS[kind]
    manifests[kind] = readJson(famlingRoot, 'public/assets/pet/anim/' + kind + '/manifest.json')
    behaviors[kind] = readJson(famlingRoot, 'public/characters/' + directory + '/behavior.json')
    regions[kind] = readJson(famlingRoot, 'public/characters/' + directory + '/regions.json')
  }
  const clipIds = deriveClipIds(manifests)
  return {
    catalog: deriveCatalog(library, famlingRoot),
    eventClips: deriveEventClips(behaviors, regions, clipIds),
    microLines: deriveMicroLines(behaviors, clipIds),
    sourceSha256: digestSources(famlingRoot),
    clipIds,
  }
}

/**
 * Render the generated content-constants block, including both marker lines.
 * @param {any} catalog Catalog model from deriveConstants().
 * @param {string} sourceSha256 Source digest written into the banner.
 * @returns {string} Block text ending with a newline.
 */
function renderContentBlock(catalog, sourceSha256) {
  const lines = []
  lines.push('    ' + CONTENT_BEGIN)
  lines.push('    // @generated by scripts/gen-content-constants.mjs - do not edit this block by hand.')
  lines.push('    // source: ../../desktop-games/public/content/library.json + docs/legal/USE-RESTRICTIONS-2026-11-19.md')
  lines.push('    // source-sha256: ' + sourceSha256)
  lines.push('    // declared plugin deltas D1-D4: see docs/CONTENT-CONSTANTS-2026-11-20.md')
  lines.push('    const DIALOGUE_MODE_IDS = ' + renderStringArray(catalog.dialogueModeIds))
  lines.push('    const DIALOGUE_MODES = {')
  for (const id of catalog.dialogueModeIds) {
    const mode = catalog.dialogueModes[id]
    lines.push('      ' + id + ': { maxChars: ' + mode.maxChars + ', bubbleChance: ' + mode.bubbleChance + ' },')
  }
  lines.push('    }')
  lines.push('    const THEME_IDS = ' + renderStringArray(catalog.themeIds))
  lines.push('    const BACKGROUND_IDS = ' + renderStringArray(catalog.backgroundIds))
  lines.push('    const BACKGROUNDS = {')
  for (const id of catalog.backgroundIds) lines.push('      ' + id + ': { vars: ' + renderVars(catalog.backgrounds[id]) + ' },')
  lines.push('    }')
  lines.push('    const FONT_IDS = ' + renderStringArray(catalog.fontIds))
  lines.push('    const FONTS = {')
  for (const id of catalog.fontIds) lines.push('      ' + id + ': { family: ' + quote(catalog.fonts[id].family) + ' },')
  lines.push('    }')
  lines.push('    const ROLE_IDS = ' + renderStringArray(catalog.roleIds))
  lines.push('    const ROLE_BUNDLES = {')
  for (const roleId of Object.keys(catalog.roleBundles)) {
    const bundle = catalog.roleBundles[roleId]
    lines.push('      ' + roleId + ': { character: ' + quote(bundle.character) + ', voicePolicy: { canTts: ' + (bundle.voicePolicy.canTts ? 'true' : 'false') + ', mode: ' + quote(bundle.voicePolicy.mode) + ', sound: ' + (bundle.voicePolicy.sound ? 'true' : 'false') + ' }, dialogue: ' + quote(bundle.dialogue) + ', theme: ' + quote(bundle.theme) + ', background: ' + quote(bundle.background) + ', font: { family: ' + quote(bundle.font.family) + ', size: ' + bundle.font.size + ', lineHeight: ' + bundle.font.lineHeight + ' }, available: ' + (bundle.available ? 'true' : 'false') + ' },')
  }
  lines.push('    }')
  const shared = catalog.sharedContentSemantics
  lines.push('    const SHARED_CONTENT_SEMANTICS = {')
  lines.push('      schema: ' + quote(shared.schema) + ', version: ' + quote(shared.version) + ', updatedAt: ' + quote(shared.updatedAt) + ', defaultRole: ' + quote(shared.defaultRole) + ',')
  lines.push('      characterIdMap: { ' + Object.keys(shared.characterIdMap).map((key) => key + ': ' + quote(shared.characterIdMap[key])).join(', ') + ' },')
  lines.push('      usageStatement: ' + quote(shared.usageStatement) + ',')
  lines.push('      usageStatementSha256: ' + quote(shared.usageStatementSha256) + ',')
  lines.push('      usageStatementRef: ' + quote(shared.usageStatementRef) + ',')
  lines.push('      license: { spdx: ' + quote(shared.license.spdx) + ', attribution: ' + quote(shared.license.attribution) + ' },')
  lines.push('      aiProvenance: { generated: ' + (shared.aiProvenance.generated ? 'true' : 'false') + ', disclosure: ' + quote(shared.aiProvenance.disclosure) + ', tools: ' + renderStringArray(shared.aiProvenance.tools || []) + ' },')
  lines.push('    }')
  lines.push('    const USAGE_DECLARATION = {')
  lines.push('      researchOnly: true,')
  lines.push('      statement: SHARED_CONTENT_SEMANTICS.usageStatement,')
  lines.push('      statementRef: SHARED_CONTENT_SEMANTICS.usageStatementRef,')
  lines.push('      statementSha256: SHARED_CONTENT_SEMANTICS.usageStatementSha256,')
  lines.push('      prohibitedUses: ' + renderStringArray(catalog.usageDeclaration.prohibitedUses) + ',')
  lines.push('    }')
  lines.push('    ' + CONTENT_END)
  return lines.join('\n') + '\n'
}

/**
 * Render the generated event-clip / micro-line block, including both markers.
 * @param {Record<string, string | null>} eventClips Generated event -> clip table.
 * @param {Record<string, Record<string, string>>} microLines Generated character -> clip -> locale key table.
 * @param {string} sourceSha256 Source digest written into the banner.
 * @returns {string} Block text ending with a newline.
 */
function renderActionsBlock(eventClips, microLines, sourceSha256) {
  const lines = []
  lines.push('    ' + ACTIONS_BEGIN)
  lines.push('    // @generated by scripts/gen-content-constants.mjs - do not edit this block by hand.')
  lines.push('    // sources: ../../desktop-games/public/characters/*/{regions,behavior}.json + public/assets/pet/anim/*/manifest.json')
  lines.push('    // source-sha256: ' + sourceSha256)
  lines.push('    // derivation: interaction events -> behavior rule -> state.tag; tag "idle" is bubble-only (null).')
  lines.push('    const EVENT_CLIPS = {')
  for (const event of Object.keys(eventClips)) {
    const target = eventClips[event]
    lines.push('      ' + event + ': ' + (target === null ? 'null' : quote(target)) + ',')
  }
  lines.push('    }')
  lines.push('    // Locale keys for each character non-idle ambient micro action (cat/dog never TTS).')
  lines.push('    const MICRO_LINES = {')
  for (const kind of Object.keys(microLines)) {
    const entries = Object.keys(microLines[kind]).map((clipId) => clipId + ': ' + quote(microLines[kind][clipId]))
    lines.push('      ' + kind + ': { ' + entries.join(', ') + ' },')
  }
  lines.push('    }')
  lines.push('    ' + ACTIONS_END)
  return lines.join('\n') + '\n'
}

/**
 * Find one marker pair in client.js and return the line index range (inclusive).
 * @param {string} source Full client.js text.
 * @param {string} beginMarker Exact begin marker line (trimmed comparison).
 * @param {string} endMarker Exact end marker line (trimmed comparison).
 * @returns {{ lines: string[], begin: number, end: number }} Split source and inclusive range.
 */
function locateBlock(source, beginMarker, endMarker) {
  const lines = source.split('\n')
  const begin = lines.findIndex((line) => line.trim() === beginMarker)
  const end = lines.findIndex((line) => line.trim() === endMarker)
  ensure(begin !== -1, 'client.js is missing the ' + beginMarker + ' marker')
  ensure(end !== -1, 'client.js is missing the ' + endMarker + ' marker')
  ensure(end > begin, 'client.js markers are out of order: ' + beginMarker)
  ensure(lines.slice(begin + 1, end).every((line) => line.trim() !== beginMarker && line.trim() !== endMarker), 'client.js has more than one ' + beginMarker + ' marker')
  return { lines, begin, end }
}

/**
 * Extract one generated block (markers included) from client.js.
 * @param {string} source Full client.js text.
 * @param {string} beginMarker Exact begin marker line.
 * @param {string} endMarker Exact end marker line.
 * @returns {string} Block text with a trailing newline.
 */
export function extractBlock(source, beginMarker, endMarker) {
  const { lines, begin, end } = locateBlock(source, beginMarker, endMarker)
  return lines.slice(begin, end + 1).join('\n') + '\n'
}

/**
 * Replace one generated block in client.js, keeping the surrounding code intact.
 * @param {string} source Full client.js text.
 * @param {string} beginMarker Exact begin marker line.
 * @param {string} endMarker Exact end marker line.
 * @param {string} block Replacement block text (markers included).
 * @returns {string} Updated client.js text.
 */
export function injectBlock(source, beginMarker, endMarker, block) {
  const { lines, begin, end } = locateBlock(source, beginMarker, endMarker)
  const blockLines = block.split('\n')
  if (blockLines[blockLines.length - 1] === '') blockLines.pop()
  return [...lines.slice(0, begin), ...blockLines, ...lines.slice(end + 1)].join('\n')
}

/**
 * Parse and compare the rendered blocks against the derived model. This catches
 * renderer regressions before anything is written to disk.
 * @param {string} source Updated client.js text with both generated blocks.
 * @param {any} model Derivation model from deriveConstants().
 * @returns {void}
 */
function validateGenerated(source, model) {
  const contentBlock = extractBlock(source, CONTENT_BEGIN, CONTENT_END)
  const actionsBlock = extractBlock(source, ACTIONS_BEGIN, ACTIONS_END)
  const content = new Function(contentBlock + '\nreturn { DIALOGUE_MODE_IDS, DIALOGUE_MODES, THEME_IDS, BACKGROUND_IDS, BACKGROUNDS, FONT_IDS, FONTS, ROLE_IDS, ROLE_BUNDLES, SHARED_CONTENT_SEMANTICS, USAGE_DECLARATION }')()
  const actions = new Function(actionsBlock + '\nreturn { EVENT_CLIPS, MICRO_LINES }')()
  const catalog = model.catalog
  ensure(JSON.stringify(content.DIALOGUE_MODE_IDS) === JSON.stringify(catalog.dialogueModeIds), 'rendered DIALOGUE_MODE_IDS differs from the model')
  ensure(JSON.stringify(content.DIALOGUE_MODES) === JSON.stringify(catalog.dialogueModes), 'rendered DIALOGUE_MODES differs from the model')
  ensure(JSON.stringify(content.THEME_IDS) === JSON.stringify(catalog.themeIds), 'rendered THEME_IDS differs from the model')
  const expectedBackgrounds = {}
  for (const id of catalog.backgroundIds) expectedBackgrounds[id] = { vars: catalog.backgrounds[id] }
  ensure(JSON.stringify(content.BACKGROUNDS) === JSON.stringify(expectedBackgrounds), 'rendered BACKGROUNDS differs from the model')
  ensure(JSON.stringify(content.FONTS) === JSON.stringify(catalog.fonts), 'rendered FONTS differs from the model')
  ensure(JSON.stringify(content.ROLE_BUNDLES) === JSON.stringify(catalog.roleBundles), 'rendered ROLE_BUNDLES differs from the model')
  ensure(JSON.stringify(content.ROLE_IDS) === JSON.stringify(catalog.roleIds), 'rendered ROLE_IDS differs from the model')
  ensure(JSON.stringify(content.SHARED_CONTENT_SEMANTICS) === JSON.stringify(catalog.sharedContentSemantics), 'rendered SHARED_CONTENT_SEMANTICS differs from the model')
  ensure(content.USAGE_DECLARATION.researchOnly === true, 'rendered USAGE_DECLARATION.researchOnly must be true')
  ensure(JSON.stringify(content.USAGE_DECLARATION.prohibitedUses) === JSON.stringify(catalog.usageDeclaration.prohibitedUses), 'rendered prohibitedUses differs from the model')
  ensure(content.USAGE_DECLARATION.statement === catalog.sharedContentSemantics.usageStatement, 'rendered statement differs from the shared anchor')
  ensure(content.USAGE_DECLARATION.statementRef === catalog.sharedContentSemantics.usageStatementRef, 'rendered statementRef differs from the shared anchor')
  ensure(content.USAGE_DECLARATION.statementSha256 === catalog.sharedContentSemantics.usageStatementSha256, 'rendered statementSha256 differs from the shared anchor')
  ensure(JSON.stringify(actions.EVENT_CLIPS) === JSON.stringify(model.eventClips), 'rendered EVENT_CLIPS differs from the model')
  ensure(JSON.stringify(actions.MICRO_LINES) === JSON.stringify(model.microLines), 'rendered MICRO_LINES differs from the model')
}

/**
 * Ensure every generated micro-line locale key appears in both language tables
 * of client.js (the verify-anims contract counts two occurrences per key).
 * @param {string} source Updated client.js text.
 * @param {Record<string, Record<string, string>>} microLines Generated micro-line table.
 * @returns {void}
 */
function validateLocaleKeys(source, microLines) {
  for (const kind of Object.keys(microLines)) {
    for (const clipId of Object.keys(microLines[kind])) {
      const key = microLines[kind][clipId]
      const occurrences = source.split(key).length - 1
      ensure(occurrences >= 2, kind + '/' + clipId + ': locale key "' + key + '" must appear in both zh and en client strings (found ' + occurrences + ')')
    }
  }
}

/**
 * Build the next client.js text and report whether the generated blocks are stale.
 * @param {{ pluginRoot?: string, clientPath?: string, famlingRoot?: string }} [options] Optional path overrides (CLI/test parity).
 * @returns {{ model: any, source: string, next: string, stale: string[], clientPath: string, famlingRoot: string }} Generation result; nothing is written.
 */
export function generate(options = {}) {
  const pluginRoot = options.pluginRoot || PLUGIN_ROOT
  const clientPath = options.clientPath || join(pluginRoot, 'client.js')
  const candidate = options.famlingRoot || process.env.FAMLING_REPO_DIR || DEFAULT_FAMLING_ROOT
  const famlingRoot = resolveFamlingRoot(candidate)
  if (!famlingRoot) {
    /** @type {Error & { code?: string, candidate?: string }} */
    const error = new Error('[gen-content-constants] famling checkout not found at ' + resolve(candidate) + ' (pass --famling DIR or set FAMLING_REPO_DIR)')
    error.code = 'FAMLING_NOT_FOUND'
    error.candidate = resolve(candidate)
    throw error
  }
  const model = deriveConstants(famlingRoot)
  const source = readFileSync(clientPath, 'utf8')
  const contentBlock = renderContentBlock(model.catalog, model.sourceSha256)
  const actionsBlock = renderActionsBlock(model.eventClips, model.microLines, model.sourceSha256)
  let next = injectBlock(source, CONTENT_BEGIN, CONTENT_END, contentBlock)
  next = injectBlock(next, ACTIONS_BEGIN, ACTIONS_END, actionsBlock)
  validateGenerated(next, model)
  validateLocaleKeys(next, model.microLines)
  const stale = []
  if (extractBlock(source, CONTENT_BEGIN, CONTENT_END) !== contentBlock) stale.push(CONTENT_BEGIN)
  if (extractBlock(source, ACTIONS_BEGIN, ACTIONS_END) !== actionsBlock) stale.push(ACTIONS_BEGIN)
  return { model, source, next, stale, clientPath, famlingRoot }
}

/**
 * Static fallback used only in a clean plugin-only checkout: prove both marker
 * pairs exist, are ordered, and their blocks parse (no famling to regenerate).
 * @param {string} source Full client.js text.
 * @returns {void}
 */
function validateStaticBlocks(source) {
  const contentBlock = extractBlock(source, CONTENT_BEGIN, CONTENT_END)
  const actionsBlock = extractBlock(source, ACTIONS_BEGIN, ACTIONS_END)
  new Function(contentBlock + '\nreturn { DIALOGUE_MODE_IDS, ROLE_BUNDLES, SHARED_CONTENT_SEMANTICS, USAGE_DECLARATION }')
  new Function(actionsBlock + '\nreturn { EVENT_CLIPS, MICRO_LINES }')
  ensure(actionsBlock.includes('const EVENT_CLIPS = {'), 'actions block does not define EVENT_CLIPS')
  ensure(actionsBlock.includes('const MICRO_LINES = {'), 'actions block does not define MICRO_LINES')
}

/**
 * Parse the documented command line flags.
 * @param {string[]} argv Raw process arguments.
 * @returns {{ mode: 'write' | 'check', famlingRoot?: string, pluginRoot?: string, help: boolean }} Parsed options.
 */
function parseArgs(argv) {
  /** @type {{ mode: 'write' | 'check', famlingRoot?: string, pluginRoot?: string, help: boolean }} */
  const options = { mode: 'write', help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.mode = 'check'
    else if (arg === '--write') options.mode = 'write'
    else if (arg === '--famling') {
      options.famlingRoot = argv[index + 1]
      ensure(typeof options.famlingRoot === 'string' && options.famlingRoot.length > 0, '--famling requires a directory')
      index += 1
    } else if (arg === '--root') {
      options.pluginRoot = argv[index + 1]
      ensure(typeof options.pluginRoot === 'string' && options.pluginRoot.length > 0, '--root requires a directory')
      index += 1
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('unknown argument: ' + arg)
  }
  return options
}

/**
 * CLI entry point: --check compares, otherwise inject + write the blocks.
 * @param {string[]} [argv] Raw process arguments.
 * @returns {Promise<void>}
 */
async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error('[gen-content-constants] ' + error.message)
    process.exitCode = 1
    return
  }
  if (options.help) {
    console.log('usage: node scripts/gen-content-constants.mjs [--check] [--famling DIR] [--root DIR]')
    return
  }
  try {
    const result = generate(options)
    if (options.mode === 'check') {
      if (result.stale.length > 0) {
        console.error('[gen-content-constants] generated blocks are stale - run npm run gen:content')
        for (const marker of result.stale) console.error('[gen-content-constants]   stale: ' + marker)
        process.exitCode = 1
        return
      }
      console.log('[gen-content-constants] check ok: content-constants + event-clips blocks match ' + result.famlingRoot)
      console.log('[gen-content-constants] source-sha256 ' + result.model.sourceSha256)
      return
    }
    if (result.next !== result.source) writeFileSync(result.clientPath, result.next)
    console.log('[gen-content-constants] client.js ' + (result.next !== result.source ? 'updated' : 'unchanged') + ' (' + Buffer.byteLength(result.source) + ' -> ' + Buffer.byteLength(result.next) + ' B)')
    console.log('[gen-content-constants] events: ' + Object.keys(result.model.eventClips).join(', '))
    console.log('[gen-content-constants] source-sha256 ' + result.model.sourceSha256)
  } catch (error) {
    if (error && error.code === 'FAMLING_NOT_FOUND' && options.mode === 'check') {
      console.log('[gen-content-constants] famling checkout not found (' + error.candidate + '); generated blocks stay frozen - running static block checks only')
      try {
        validateStaticBlocks(readFileSync(CLIENT_PATH, 'utf8'))
        console.log('[gen-content-constants] static block check ok')
      } catch (staticError) {
        console.error('[gen-content-constants] ' + (staticError && staticError.message))
        process.exitCode = 1
      }
      return
    }
    console.error('[gen-content-constants] ' + ((error && error.message) || String(error)))
    process.exitCode = 1
  }
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) await main()
