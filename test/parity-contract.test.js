/**
 * Shared content semantics parity (E1-T1 / MB-030/031/033) - plugin side.
 *
 * The plugin checkout is independent, so the shared values are frozen in the
 * client content block (SHARED_CONTENT_SEMANTICS + USAGE_DECLARATION) and
 * checked here. When the sibling famling checkout is present (this workspace)
 * the same test reads public/content/library.json and the famling source and
 * asserts both ends agree; a clean plugin-only checkout skips those tests
 * instead of failing. The famling repo runs its own mirror of this contract.
 *
 * See /mnt/d/Projects/dsh/desktop-games/docs/plan/SHARED-CONTENT-SEMANTICS-2026-11-19.md
 * (famling side: docs/plan/SHARED-CONTENT-SEMANTICS-2026-11-19.md).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONTENT_AI_PROVENANCE_TEMPLATE,
  CONTENT_EXTENSION_POINTS,
  CONTENT_LICENSE_TEMPLATE,
  CONTENT_LIMITS,
  CONTENT_PACK_SCHEMA_VERSION,
  CONTENT_USAGE_STATEMENT,
  CONTENT_USAGE_STATEMENT_REF,
  CONTENT_USAGE_STATEMENT_SHA256,
  PROHIBITED_USES,
  ROLE_BUNDLE_IDS,
  USAGE_DECLARATION_TEMPLATE,
} from '../content-extension.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Sibling famling checkout; override for CI or a different layout. */
const FAM_LING_ROOT = process.env.FAMLING_REPO_DIR ?? join(ROOT, '..', '..', 'desktop-games')
const LIBRARY_PATH = join(FAM_LING_ROOT, 'public', 'content', 'library.json')
const famlingAvailable = existsSync(LIBRARY_PATH)
const clientSource = readFileSync(join(ROOT, 'client.js'), 'utf8')
const contentChunkSource = readFileSync(join(ROOT, 'client.content.js'), 'utf8')

function readText(path) { return readFileSync(path, 'utf8') }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function extractBlock(source, begin, end) {
  const start = source.indexOf(begin)
  const stop = source.indexOf(end)
  assert.ok(start >= 0 && stop > start, 'client.js marker pair exists: ' + begin)
  return source.slice(start + begin.length, stop)
}
function evaluateBlock(block, names) {
  return new Function(block + '\nreturn {' + names.join(',') + '}')()
}
function readStringList(source, declaration) {
  const start = source.indexOf(declaration)
  assert.ok(start >= 0, 'declaration exists: ' + declaration)
  const from = source.indexOf('[', start)
  const to = source.indexOf(']', from)
  assert.ok(from > start && to > from, 'list literal exists: ' + declaration)
  return source.slice(from + 1, to).split(',').map((part) => part.trim()).filter((part) => part.length > 2).map((part) => part.slice(1, -1))
}
function parseGeneratedHeader(source) {
  const marker = '    // characters: '
  const start = source.indexOf(marker)
  if (start < 0) return null
  const line = source.slice(start + marker.length, source.indexOf('\n', start))
  const parts = line.split(' - ')
  const clips = Number.parseInt(parts[1] ?? '', 10)
  const frames = Number.parseInt(parts[2] ?? '', 10)
  return Number.isFinite(clips) && Number.isFinite(frames) ? { clips, frames } : null
}

const content = evaluateBlock(extractBlock(clientSource, '// <dsh-famling:content:begin>', '// <dsh-famling:content:end>'), [
  'SHARED_CONTENT_SEMANTICS', 'USAGE_DECLARATION', 'ROLE_BUNDLES', 'ROLE_IDS', 'DIALOGUE_MODES',
  'DIALOGUE_MODE_IDS', 'THEME_IDS', 'BACKGROUND_IDS', 'FONT_IDS', 'THEMES', 'BACKGROUNDS', 'FONTS',
])
const anims = evaluateBlock(extractBlock(clientSource, '// <dsh-famling:anims:begin>', '// <dsh-famling:anims:end>'), ['CHARACTER_POLICY', 'CHARACTER_CHUNKS'])
anims.CHARACTER_IDS = readStringList(clientSource, 'const CHARACTER_IDS = ')
const actions = evaluateBlock(extractBlock(clientSource, '// <dsh-famling:actions:begin>', '// <dsh-famling:actions:end>'), ['EVENT_CLIPS'])
const header = parseGeneratedHeader(clientSource)

const SHA256_KNOWN = '0353536cefd702014b12a8365c4a486f19848d049652e9692027216adb80c743'
const USAGE_REF = 'docs/legal/USE-RESTRICTIONS-2026-11-19.md'

const FROZEN_ROLE_IDS = ['human', 'cat', 'dog', 'origami']
const FROZEN_ACTIVE_ROLE_IDS = ['human', 'cat', 'dog']
const FROZEN_CHARACTER_IDS = ['human', 'cat', 'dog']
const FROZEN_DIALOGUE_IDS = ['standard', 'brief', 'quiet']
const FROZEN_THEME_IDS = ['default', 'paper', 'night']
const FROZEN_BACKGROUND_IDS = ['transparent', 'paper', 'dark']
const FROZEN_FONT_IDS = ['system', 'serif', 'mono']
const FROZEN_CHARACTER_ID_MAP = { human: 'humanoid', cat: 'cat', dog: 'dog', origami: 'origami' }

const FROZEN_ROLES = {
  human: { character: 'human', canTts: true, mode: 'speech', sound: true, dialogue: 'standard', theme: 'default', background: 'transparent', font: 'system', available: true, libraryCharacter: 'humanoid', libraryTheme: 'default' },
  cat: { character: 'cat', canTts: false, mode: 'thought', sound: false, dialogue: 'standard', theme: 'night', background: 'dark', font: 'serif', available: true, libraryCharacter: 'cat', libraryTheme: 'night' },
  dog: { character: 'dog', canTts: false, mode: 'thought', sound: false, dialogue: 'standard', theme: 'paper', background: 'paper', font: 'system', available: true, libraryCharacter: 'dog', libraryTheme: 'paper' },
  origami: { character: 'origami', canTts: true, mode: 'speech', sound: false, dialogue: 'standard', theme: 'night', background: 'transparent', font: 'mono', available: false, libraryCharacter: 'origami', libraryTheme: 'high-contrast' },
}

const FROZEN_DIALOGUE = {
  standard: { maxChars: 240, bubbleChance: 0.7 },
  brief: { maxChars: 80, bubbleChance: 0.4 },
  quiet: { maxChars: 50, bubbleChance: 0.05 },
}
const FROZEN_THEME_BUBBLES = {
  default: { bg: '#ffffff', fg: '#111111' },
  paper: { bg: '#fff8ec', fg: '#3b2f24' },
  night: { bg: '#1b2433', fg: '#e6edf7' },
}
const FROZEN_BACKGROUNDS = { transparent: 'transparent', paper: '#f6f1e7', dark: '#14161a' }
const FROZEN_FONTS = {
  system: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans SC', sans-serif",
  serif: "Georgia, 'Noto Serif SC', 'Songti SC', serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
}
const FROZEN_PROHIBITED_USES = [
  'emotional-companionship', 'virtual-partner', 'professional-advice',
  'minor-intimacy', 'impersonation', 'illegal-use',
]
const FROZEN_USAGE_STATEMENT = '本项目及其全部代码、美术、音频、文案、角色素材和衍生物仅用于技术研究与原型验证，不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途。'
const FROZEN_USAGE_STATEMENT_REF = 'docs/legal/USE-RESTRICTIONS-2026-11-19.md'
const FROZEN_USAGE_STATEMENT_SHA256 = '0353536cefd702014b12a8365c4a486f19848d049652e9692027216adb80c743'
const FROZEN_LICENSE = {
  spdx: 'LicenseRef-PolyForm-Noncommercial-1.0.0',
  attribution: 'Famling maintainers; placeholder art under LICENSE-ART (CC BY-NC-SA 4.0)',
}
const FROZEN_AI_PROVENANCE = {
  generated: false,
  disclosure: '内置占位像素帧由确定性脚本生成，未使用生成式 AI；最终美术替换后须更新本声明。',
  tools: ['deterministic-python-renderer'],
}
const FROZEN_EVENT_CLIPS = {
  pat: 'pat_head', stand_wag: 'stand_wag', chase_tail: 'chase_tail',
  ball_throw: 'ball_throw', ball_chase: 'ball_chase', paw_face: 'paw_face',
  scratch: 'scratch', run: 'run', feed: 'stand_wag', talk: null,
}
const FROZEN_REGION_EVENTS = {
  'pet-dog': { gestures: ['pat', 'stand_wag', 'chase_tail'], actions: ['pat', 'ball_throw', 'ball_chase', 'chase_tail', 'run'] },
  'pet-cat': { gestures: ['pat', 'stand_wag', 'chase_tail'], actions: ['pat', 'stand_wag', 'paw_face', 'chase_tail', 'run'] },
  'pet-tinglan-anim': { gestures: ['pat', 'stand_wag', 'chase_tail'], actions: ['pat', 'feed', 'stand_wag', 'paw_face', 'talk'] },
}
const FROZEN_STORAGE_KEYS = [
  'dsh-famling/character', 'dsh-famling/settings', 'dsh-famling/first-run/v1',
  'dsh-famling/consent/v1', 'dsh-famling/dialogue', 'dsh-famling/role',
  'dsh-famling/theme', 'dsh-famling/background', 'dsh-famling/font',
  'dsh-famling/menu', 'dsh-famling/hidden-until', 'dsh-famling/scale', 'dsh-famling/text-scale',
  'dsh-famling/market/catalog', 'dsh-famling.market',
]
const FROZEN_TERMS = { tos: '2026-11-20.1', tts: '2026-11-17.4', asr: '2026-11-17.3', roleplay: '2026-11-17.4' }
const FROZEN_FRAME_TOTALS = { dog: 68, cat: 72, human: 68 }
const FROZEN_CLIP_IDS = [
  'idle', 'idle_blink', 'walk', 'run', 'pat_head', 'ball_throw',
  'ball_chase', 'paw_face', 'scratch', 'stand_wag', 'chase_tail', 'attack',
]
const FROZEN_FAMLING_LIMITS = {
  maxEntriesPerCategory: 64, maxPacksPerMerge: 64, maxPackEntries: 64, maxPackFiles: 128,
  maxNameChars: 48, maxDescriptionChars: 280, maxSaysLines: 12, maxSaysOverrides: 32,
  maxOverridesKeyChars: 64, maxLicenseAttributionChars: 200, maxAiDisclosureChars: 280,
  maxPackTextChars: 6000, maxPreviewChars: 160, maxFontFamilyChars: 200,
  maxBackgroundValueChars: 300, maxFileBytes: 8 * 1024 * 1024, maxPackBytes: 32 * 1024 * 1024,
  maxPackJsonBytes: 256 * 1024, maxSelectionBytes: 2048, maxRemoteUrlChars: 512,
}
const FROZEN_FAMLING_PACK_V2_LIMITS = {
  maxRoleThemesPerPack: 8, maxComponentsPerCategory: 64, maxPackFiles: 128,
  maxZipBytes: 16 * 1024 * 1024, maxZipEntries: 256, maxAssetBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 32 * 1024 * 1024, maxCompressionRatio: 128,
  maxPackJsonBytes: 256 * 1024, maxPreviewChars: 160, maxDesignRefChars: 160,
  maxAuthorChars: 80, maxAiTools: 8, maxAiToolChars: 48, maxMarketPacks: 256,
  maxMarketJsonBytes: 1024 * 1024, maxMarketDescriptionChars: 280,
}

/* ==================== local frozen contract (always runs) ==================== */
test('client content block keeps the shared schema/version anchor', () => {
  const shared = content.SHARED_CONTENT_SEMANTICS
  assert.ok(shared, 'SHARED_CONTENT_SEMANTICS is exposed by the client block')
  assert.equal(shared.schema, 'famling.content/0.2')
  assert.equal(shared.version, '0.2.0')
  assert.equal(shared.updatedAt, '2026-11-19')
  assert.equal(shared.defaultRole, 'human')
  assert.deepEqual({ ...shared.characterIdMap }, FROZEN_CHARACTER_ID_MAP)
  assert.deepEqual(Object.keys(content.ROLE_BUNDLES), FROZEN_ROLE_IDS)
  assert.deepEqual(content.ROLE_IDS, FROZEN_ACTIVE_ROLE_IDS)
  assert.deepEqual([...ROLE_BUNDLE_IDS], FROZEN_ROLE_IDS, 'v3 contract exposes the same four role bundle ids')
})

test('usage declaration is the canonical shared statement with all six prohibitions', () => {
  const declaration = content.USAGE_DECLARATION
  const shared = content.SHARED_CONTENT_SEMANTICS
  assert.equal(declaration.researchOnly, true)
  assert.deepEqual([...declaration.prohibitedUses], FROZEN_PROHIBITED_USES)
  assert.deepEqual([...PROHIBITED_USES], FROZEN_PROHIBITED_USES)
  assert.equal(declaration.statement, shared.usageStatement)
  assert.equal(declaration.statementRef, shared.usageStatementRef)
  assert.equal(declaration.statementSha256, shared.usageStatementSha256)
  assert.equal(shared.usageStatementRef, USAGE_REF)
  const sha = createHash('sha256').update(shared.usageStatement, 'utf8').digest('hex')
  assert.equal(sha, SHA256_KNOWN, 'canonical statement SHA-256 is frozen')
  assert.equal(shared.usageStatementSha256, SHA256_KNOWN)
  assert.deepEqual({ ...USAGE_DECLARATION_TEMPLATE }, { researchOnly: true, prohibitedUses: FROZEN_PROHIBITED_USES })
})

test('role bundles keep the frozen six-component bundles and declared differences', () => {
  for (const [roleId, expected] of Object.entries(FROZEN_ROLES)) {
    const bundle = content.ROLE_BUNDLES[roleId]
    assert.ok(bundle, roleId + ': bundle exists')
    assert.equal(bundle.character, expected.character)
    assert.deepEqual({ ...bundle.voicePolicy }, { canTts: expected.canTts, mode: expected.mode, sound: expected.sound })
    assert.equal(bundle.dialogue, expected.dialogue)
    assert.equal(bundle.theme, expected.theme)
    assert.equal(bundle.background, expected.background)
    assert.equal(bundle.font.family, expected.font)
    assert.equal(bundle.font.size, 12)
    assert.equal(bundle.font.lineHeight, 1.5)
    assert.equal(bundle.available, expected.available)
  }
  assert.equal(content.ROLE_BUNDLES.origami.available, false, 'origami stays data-only (declared difference D2)')
  assert.equal(content.ROLE_BUNDLES.origami.theme, 'night', 'high-contrast is explicitly mapped to night (D3)')
  assert.deepEqual([...content.THEME_IDS], FROZEN_THEME_IDS, 'plugin has no high-contrast implementation (D3)')
  assert.deepEqual([...content.BACKGROUND_IDS], FROZEN_BACKGROUND_IDS)
  assert.deepEqual([...content.FONT_IDS], FROZEN_FONT_IDS)
  for (const [fontId, family] of Object.entries(FROZEN_FONTS)) assert.equal(content.FONTS[fontId].family, family)
  for (const [backgroundId, value] of Object.entries(FROZEN_BACKGROUNDS)) {
    assert.equal(content.BACKGROUNDS[backgroundId].vars['--dsh-famling-widget-bg'], value)
  }
  for (const [themeId, bubble] of Object.entries(FROZEN_THEME_BUBBLES)) {
    assert.equal(content.THEMES[themeId].vars['--dsh-famling-bubble-bg'], bubble.bg, themeId + ': frozen plugin bubble bg')
    assert.equal(content.THEMES[themeId].vars['--dsh-famling-bubble-text'], bubble.fg, themeId + ': frozen plugin bubble text')
  }
})

test('dialogue modes keep the shared values; only automatic/ambient lines are gated', () => {
  assert.deepEqual([...content.DIALOGUE_MODE_IDS], FROZEN_DIALOGUE_IDS)
  for (const mode of FROZEN_DIALOGUE_IDS) assert.deepEqual({ ...content.DIALOGUE_MODES[mode] }, FROZEN_DIALOGUE[mode])
  assert.ok(clientSource.includes("source === 'ambient' && dialogue.bubbleChance < 1"), 'probability gates ambient lines only')
  assert.ok(clientSource.includes("source === 'ambient' && (dialogueMode === 'quiet' || isQuietHoursActive(settings.quietHours))"), 'quiet mode/quiet hours suppress ambient lines only (shared semantics)')
  assert.ok(clientSource.includes("say(line, 'speech', 'interactive')"), 'explicit taps/actions still show (shared semantics)')
  assert.ok(clientSource.includes("say(result.reply, 'thought', 'direct')"), 'host replies are direct/explicit')
  assert.ok(clientSource.includes('line.slice(0, dialogue.maxChars - 1)'), 'every dialogue line is clamped to the shared maxChars')
})

test('compliance metadata (licence / AI provenance) is frozen', () => {
  const shared = content.SHARED_CONTENT_SEMANTICS
  assert.deepEqual({ ...shared.license }, FROZEN_LICENSE)
  assert.deepEqual({ ...shared.aiProvenance }, FROZEN_AI_PROVENANCE)
})

test('v3 content-extension compliance anchors equal the client and frozen compliance values', () => {
  const shared = content.SHARED_CONTENT_SEMANTICS
  const declaration = content.USAGE_DECLARATION
  assert.equal(CONTENT_USAGE_STATEMENT, FROZEN_USAGE_STATEMENT)
  assert.equal(CONTENT_USAGE_STATEMENT_REF, FROZEN_USAGE_STATEMENT_REF)
  assert.equal(CONTENT_USAGE_STATEMENT_SHA256, FROZEN_USAGE_STATEMENT_SHA256)
  assert.equal(createHash('sha256').update(CONTENT_USAGE_STATEMENT, 'utf8').digest('hex'), SHA256_KNOWN, 'canonical statement SHA-256 is recomputed')
  assert.equal(shared.usageStatement, CONTENT_USAGE_STATEMENT, 'client and wire freeze the same statement')
  assert.equal(shared.usageStatementRef, CONTENT_USAGE_STATEMENT_REF)
  assert.equal(shared.usageStatementSha256, CONTENT_USAGE_STATEMENT_SHA256)
  assert.equal(declaration.statement, CONTENT_USAGE_STATEMENT)
  assert.equal(declaration.statementRef, CONTENT_USAGE_STATEMENT_REF)
  assert.equal(declaration.statementSha256, CONTENT_USAGE_STATEMENT_SHA256)
  assert.deepEqual({ ...CONTENT_LICENSE_TEMPLATE }, FROZEN_LICENSE)
  assert.deepEqual({ ...CONTENT_AI_PROVENANCE_TEMPLATE }, FROZEN_AI_PROVENANCE)
  assert.deepEqual({ ...CONTENT_LICENSE_TEMPLATE }, { ...shared.license })
  assert.deepEqual({ ...CONTENT_AI_PROVENANCE_TEMPLATE }, { ...shared.aiProvenance })
  for (const text of [FROZEN_LICENSE.spdx, FROZEN_LICENSE.attribution, FROZEN_AI_PROVENANCE.disclosure]) {
    assert.ok(contentChunkSource.includes(text), 'content chunk shows: ' + text)
  }
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.compliance.packFields], ['license', 'aiProvenance', 'compatibility'])
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.compliance.entryOptionalFields], ['license', 'aiProvenance'])
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.compliance.usageDeclaration.optionalFields], ['statement', 'statementRef', 'statementSha256'])
  for (const field of CONTENT_EXTENSION_POINTS.compliance.packFields) {
    assert.ok(CONTENT_EXTENSION_POINTS.pack.optionalFields.includes(field), 'pack optional field: ' + field)
  }
  assert.ok(CONTENT_EXTENSION_POINTS.entry.optionalFields.includes('license'), 'entries may restate a licence')
  assert.ok(CONTENT_EXTENSION_POINTS.entry.optionalFields.includes('aiProvenance'), 'entries may restate AI provenance')
})

test('the v3 content-extension contract keeps the shared declaration and frozen limits', () => {
  assert.equal(CONTENT_PACK_SCHEMA_VERSION, 3)
  assert.deepEqual([...ROLE_BUNDLE_IDS], FROZEN_ROLE_IDS)
  assert.deepEqual([...PROHIBITED_USES], FROZEN_PROHIBITED_USES)
  assert.deepEqual({ ...CONTENT_EXTENSION_POINTS.transport }, { network: false, execute: false, innerHTML: false, worker: false, assets: false })
  assert.equal(CONTENT_EXTENSION_POINTS.compliance.additive, true, 'compliance metadata is additive in v3')
  assert.equal(CONTENT_EXTENSION_POINTS.compliance.strictOption, 'requireCompliance')
  assert.equal(typeof CONTENT_EXTENSION_POINTS.validation.options.requireCompliance, 'string', 'strict compliance option is documented')
  assert.equal(typeof CONTENT_EXTENSION_POINTS.validation.options.pluginVersion, 'string', 'host-version compatibility option is documented')
  assert.deepEqual({ ...CONTENT_LIMITS }, {
    maxBytes: 65536, maxEntries: 32, maxEntriesPerKind: 16, maxDepth: 8,
    maxIdChars: 64, maxNameChars: 64, maxDescriptionChars: 240, maxTextChars: 280,
    maxPathChars: 160, maxAssetPathChars: 160, maxAssetFiles: 32,
    maxAssetTotalBytes: 268435456, maxCatalogUrlChars: 240, maxPermissions: 8,
    maxVars: 24, maxVarValueChars: 80, maxArrayItems: 64, maxObjectKeys: 32, maxErrors: 32,
    maxSpdxChars: 64, maxLicenseAttributionChars: 200, maxAiDisclosureChars: 280,
    maxAiTools: 8, maxAiToolChars: 48,
  })
})

test('sprite chunks, item counts and event->clip table are frozen', () => {
  assert.ok(header, 'generated anims header exists')
  assert.equal(header.clips, 12)
  assert.equal(header.frames, 208)
  assert.deepEqual(anims.CHARACTER_IDS, FROZEN_CHARACTER_IDS)
  assert.deepEqual(Object.keys(anims.CHARACTER_CHUNKS), FROZEN_CHARACTER_IDS)
  for (const character of FROZEN_CHARACTER_IDS) {
    assert.equal(anims.CHARACTER_CHUNKS[character], './client.anims.' + character + '.js')
    assert.ok(existsSync(join(ROOT, 'client.anims.' + character + '.js')), character + ': lazy chunk exists')
    const policy = anims.CHARACTER_POLICY[character]
    assert.equal(policy.canTts, character === 'human', character + ': only human may TTS')
    assert.equal(policy.bubble, character === 'human' ? 'speech' : 'thought')
  }
  assert.deepEqual({ ...actions.EVENT_CLIPS }, FROZEN_EVENT_CLIPS)
  for (const clip of Object.values(FROZEN_EVENT_CLIPS)) {
    if (clip !== null) assert.ok(FROZEN_CLIP_IDS.includes(clip), 'event target is a known clip: ' + clip)
  }
})

test('storage keys stay in the plugin namespace with the frozen list', () => {
  const literalKeys = new Set()
  for (const match of clientSource.matchAll(/'dsh-famling[^']*'/g)) literalKeys.add(match[0].slice(1, -1))
  for (const key of FROZEN_STORAGE_KEYS) assert.ok(literalKeys.has(key), 'storage key present: ' + key)
  for (const key of FROZEN_STORAGE_KEYS) {
    assert.ok(key.startsWith('dsh-famling'), 'plugin key stays in its namespace: ' + key)
    assert.equal(key.startsWith('desktop-games/'), false)
  }
})

/* ==================== cross-product conformance (needs famling) ==================== */
const famlingSkip = famlingAvailable ? false : 'famling checkout not present (clean plugin checkout / CI)'

test('famling rolePresets map one-to-one onto the plugin role bundles', { skip: famlingSkip }, () => {
  const library = readJson(LIBRARY_PATH)
  const shared = content.SHARED_CONTENT_SEMANTICS
  assert.equal(shared.schema, library.schema)
  assert.equal(shared.version, library.version)
  assert.equal(shared.updatedAt, library.updatedAt)
  assert.equal(shared.defaultRole, library.defaultRoleTheme)
  assert.deepEqual(library.rolePresets.map((preset) => preset.id), FROZEN_ROLE_IDS)
  assert.equal(library.rolePresets.length, 4)
  for (const [roleId, expected] of Object.entries(FROZEN_ROLES)) {
    const preset = library.rolePresets.find((entry) => entry.id === roleId)
    const bundle = content.ROLE_BUNDLES[roleId]
    assert.ok(preset, roleId + ': famling role preset exists')
    assert.equal(preset.characterId, expected.libraryCharacter)
    assert.equal(shared.characterIdMap[roleId], preset.characterId, roleId + ': character id map matches')
    assert.equal(bundle.character, expected.character)
    assert.equal(bundle.dialogue, preset.dialoguePackId)
    assert.equal(bundle.theme, preset.appearance.themeId === 'high-contrast' ? 'night' : preset.appearance.themeId)
    assert.equal(bundle.background, preset.appearance.backgroundId)
    assert.equal(bundle.font.family, preset.appearance.fontId)
    const silent = preset.voiceId === 'none'
    assert.equal(bundle.voicePolicy.canTts, !silent, roleId + ': silent roles never TTS')
    assert.equal(bundle.voicePolicy.mode, silent ? 'thought' : 'speech')
  }
  assert.equal(library.defaultRoleTheme, shared.defaultRole)
  assert.deepEqual({ ...library.defaults }, { character: 'humanoid', voice: 'stella', dialoguePack: 'standard', theme: 'default', background: 'transparent', font: 'system' })
  assert.equal(library.characters.length, 4)
  assert.equal(library.voices.length, 2)
  assert.equal(library.dialoguePacks.length, 3)
  assert.equal(library.themes.length, 4)
  assert.equal(library.backgrounds.length, 3)
  assert.equal(library.fonts.length, 3)
})

test('famling dialogue/appearance/usage/compliance values equal the frozen plugin values', { skip: famlingSkip }, () => {
  const library = readJson(LIBRARY_PATH)
  const preset = library.rolePresets[0]
  const shared = content.SHARED_CONTENT_SEMANTICS
  for (const pack of library.dialoguePacks) {
    assert.deepEqual({ maxChars: pack.maxChars, bubbleChance: pack.bubbleChance }, FROZEN_DIALOGUE[pack.id])
    assert.deepEqual({ ...content.DIALOGUE_MODES[pack.id] }, FROZEN_DIALOGUE[pack.id])
  }
  assert.equal(preset.usageDeclaration.statement, shared.usageStatement)
  assert.equal(preset.usageDeclaration.statementRef, shared.usageStatementRef)
  assert.deepEqual([...preset.usageDeclaration.prohibitedUses], FROZEN_PROHIBITED_USES)
  const sha = createHash('sha256').update(preset.usageDeclaration.statement, 'utf8').digest('hex')
  assert.equal(sha, shared.usageStatementSha256)
  for (const entry of library.rolePresets) {
    assert.deepEqual({ ...entry.license }, FROZEN_LICENSE)
    assert.deepEqual({ ...entry.aiProvenance }, FROZEN_AI_PROVENANCE)
  }
  assert.deepEqual({ ...CONTENT_LICENSE_TEMPLATE }, { ...library.rolePresets[0].license }, 'famling and the v3 wire anchor the same licence')
  assert.deepEqual({ ...CONTENT_AI_PROVENANCE_TEMPLATE }, { ...library.rolePresets[0].aiProvenance }, 'famling and the v3 wire anchor the same AI provenance')
  for (const background of library.backgrounds) {
    const pluginValue = content.BACKGROUNDS[background.id].vars['--dsh-famling-widget-bg']
    assert.equal(pluginValue, background.value)
  }
  for (const font of library.fonts) assert.equal(content.FONTS[font.id].family, font.family)
  const libraryThemeIds = library.themes.map((theme) => theme.id)
  for (const themeId of FROZEN_THEME_IDS) assert.ok(libraryThemeIds.includes(themeId))
  assert.ok(libraryThemeIds.includes('high-contrast'), 'famling-only high-contrast theme is declared')
  const defaultTheme = library.themes.find((theme) => theme.id === 'default')
  assert.equal(content.THEMES.default.vars['--dsh-famling-bubble-bg'], defaultTheme.vars.bubbleBg)
  assert.equal(content.THEMES.default.vars['--dsh-famling-bubble-text'], defaultTheme.vars.bubbleFg)
})

test('famling manifests/regions match the embedded counts and event->clip map', { skip: famlingSkip }, () => {
  let totalFrames = 0
  for (const [character, expectedFrames] of Object.entries(FROZEN_FRAME_TOTALS)) {
    const manifest = readJson(join(FAM_LING_ROOT, 'public', 'assets', 'pet', 'anim', character, 'manifest.json'))
    const clips = Object.entries(manifest.tags)
    assert.equal(clips.length, 12, character + ': 12 clips')
    const frames = clips.reduce((sum, entry) => sum + entry[1].frames, 0)
    assert.equal(frames, expectedFrames, character + ': total frames')
    totalFrames += frames
  }
  assert.equal(totalFrames, header.frames, 'embedded header frame total equals the famling manifests')
  for (const directory of Object.keys(FROZEN_REGION_EVENTS)) {
    const regions = readJson(join(FAM_LING_ROOT, 'public', 'characters', directory, 'regions.json'))
    const expected = FROZEN_REGION_EVENTS[directory]
    assert.deepEqual(regions.gestures.map((gesture) => gesture.event), [...expected.gestures])
    assert.deepEqual((regions.actions ?? []).map((action) => action.event), [...expected.actions])
    for (const event of expected.gestures.concat(expected.actions)) {
      assert.ok(event in actions.EVENT_CLIPS, directory + ': event has an embedded clip: ' + event)
    }
  }
})

test('famling limits/terms/storage keys are compatible with the plugin contract', { skip: famlingSkip }, () => {
  const librarySource = readText(join(FAM_LING_ROOT, 'src', 'pet', 'content-library.ts'))
  const limits = readLimitObject(librarySource, 'CONTENT_LIMITS')
  const packLimits = readLimitObject(librarySource, 'CONTENT_PACK_V2_LIMITS')
  assert.deepEqual({ ...limits }, FROZEN_FAMLING_LIMITS, 'famling catalog limits are frozen')
  assert.deepEqual({ ...packLimits }, FROZEN_FAMLING_PACK_V2_LIMITS, 'famling pack limits are frozen')
  assert.ok(CONTENT_LIMITS.maxBytes <= packLimits.maxPackJsonBytes, 'plugin pack JSON cap is not weaker')
  assert.ok(CONTENT_LIMITS.maxEntries <= packLimits.maxComponentsPerCategory, 'plugin entry cap is not weaker')
  assert.ok(CONTENT_LIMITS.maxEntriesPerKind <= packLimits.maxComponentsPerCategory, 'plugin per-kind cap is not weaker')
  assert.ok(CONTENT_LIMITS.maxAssetFiles <= packLimits.maxPackFiles, 'plugin file cap is not weaker')
  assert.ok(CONTENT_LIMITS.maxDescriptionChars <= limits.maxDescriptionChars, 'plugin description cap is not weaker')
  assert.ok(CONTENT_LIMITS.maxTextChars <= limits.maxPackTextChars, 'plugin text cap is not weaker')
  assert.equal(CONTENT_LIMITS.maxPathChars, packLimits.maxPreviewChars, 'preview path cap matches')
  assert.ok(CONTENT_LIMITS.maxAssetTotalBytes > packLimits.maxTotalUncompressedBytes, 'declared D6 exception: reserved v3 asset archive')
  assert.ok(CONTENT_LIMITS.maxNameChars > limits.maxNameChars, 'declared D6 exception: short human names')
  const termsSource = readText(join(FAM_LING_ROOT, 'src', 'pet', 'consent', 'terms.ts'))
  assert.equal(readStringExport(termsSource, 'TOS_VERSION'), FROZEN_TERMS.tos)
  assert.equal(readStringExport(termsSource, 'TTS_VERSION'), FROZEN_TERMS.tts)
  assert.equal(readStringExport(termsSource, 'ASR_VERSION'), FROZEN_TERMS.asr)
  assert.equal(readStringExport(termsSource, 'ROLEPLAY_VERSION'), FROZEN_TERMS.roleplay)
  const statement = readMultilineStringExport(librarySource, 'CONTENT_USAGE_STATEMENT')
  const canonical = readText(join(FAM_LING_ROOT, 'docs', 'legal', 'USE-RESTRICTIONS-2026-11-19.md'))
  const sha = createHash('sha256').update(statement, 'utf8').digest('hex')
  assert.equal(sha, SHA256_KNOWN)
  assert.ok(canonical.includes(statement))
  assert.ok(canonical.includes(sha))
  assert.ok(canonical.includes('v1 · 2026-11-19'))
  const selectionKeys = readSelectionKeys(librarySource)
  assert.deepEqual(Object.values(selectionKeys).sort(), [
    'desktop-games/pet/content/background', 'desktop-games/pet/content/character',
    'desktop-games/pet/content/dialogue-pack', 'desktop-games/pet/content/font',
    'desktop-games/pet/content/theme', 'desktop-games/pet/content/voice',
  ])
  const literalKeys = new Set()
  for (const match of clientSource.matchAll(/'dsh-famling[^']*'/g)) literalKeys.add(match[0].slice(1, -1))
  for (const key of Object.values(selectionKeys)) {
    assert.equal(literalKeys.has(key), false, 'plugin does not read the famling key: ' + key)
    assert.ok(key.startsWith('desktop-games/pet/content/'))
  }
})

/* ==================== famling-source parsing helpers ==================== */
function readLimitObject(source, name) {
  const marker = 'export const ' + name + ' = Object.freeze({'
  const start = source.indexOf(marker)
  assert.ok(start >= 0, name + ': frozen object exists in the famling source')
  const end = source.indexOf('\n})', start)
  assert.ok(end > start, name + ': frozen object is closed')
  const body = source.slice(start + marker.length, end)
  const allowed = '0123456789*+-/(). \t'
  const result = {}
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if (value.endsWith(',')) value = value.slice(0, -1)
    if (value.length === 0) continue
    if (![...value].every((character) => allowed.includes(character))) continue
    result[key] = Function('"use strict"; return (' + value + ')')()
  }
  return result
}
function readStringExport(source, name) {
  const marker = 'export const ' + name + " = '"
  const start = source.indexOf(marker)
  assert.ok(start >= 0, name + ': string export exists in the famling source')
  const from = start + marker.length
  return source.slice(from, source.indexOf("'", from))
}
function readMultilineStringExport(source, name) {
  const marker = 'export const ' + name + " =\n  '"
  const start = source.indexOf(marker)
  assert.ok(start >= 0, name + ': multiline string export exists in the famling source')
  const from = start + marker.length
  return source.slice(from, source.indexOf("'", from))
}
function readSelectionKeys(source) {
  const marker = 'export const CONTENT_SELECTION_KEYS'
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'CONTENT_SELECTION_KEYS exists in the famling source')
  const from = source.indexOf('Object.freeze({', start)
  const to = source.indexOf('})', from)
  assert.ok(from >= 0 && to > from, 'CONTENT_SELECTION_KEYS literal is closed')
  const result = {}
  for (const rawLine of source.slice(from, to).split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//') || line.startsWith('export')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1)
    const first = value.indexOf("'")
    const last = value.lastIndexOf("'")
    if (first < 0 || last <= first) continue
    result[key] = value.slice(first + 1, last)
  }
  return result
}

