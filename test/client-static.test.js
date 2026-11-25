import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { CHARACTERS, CHUNK_NAMES, PLUGIN_ROOT, chunkPath, decodePng, loadRegionConfig, resolveAssetsRoot, resolveCharactersRoot } from '../scripts/embed-anims.mjs'
import { readAnimationSpec, validateEmbeddedAgainstSpec } from '../scripts/anim-spec.mjs'
import { FIRST_SCREEN_BUDGET_BYTES, loadChunkModule, loadClientData, verifyClient } from '../scripts/verify-anims.mjs'
import { AUDIT_BASELINE_BYTES } from '../scripts/measure-bundle.mjs'
import { CONTENT_EXTENSION_COMPATIBILITY, CONTENT_EXTENSION_POINTS, CONTENT_EXTENSION_VERSION, CONTENT_PACK_EXAMPLE, CONTENT_PACK_SCHEMA_VERSION, PROHIBITED_USES, ROLE_BUNDLE_IDS, USAGE_DECLARATION_TEMPLATE, isContentExtensionCompatible, validateContentPack } from '../content-extension.mjs'

const clientPath = join(PLUGIN_ROOT, 'client.js')
const clientSource = readFileSync(clientPath, 'utf8')
const contentChunkPath = join(PLUGIN_ROOT, 'client.content.js')
const contentSource = readFileSync(contentChunkPath, 'utf8')
const behaviorChunkPath = join(PLUGIN_ROOT, 'client.behavior.js')
const behaviorSource = readFileSync(behaviorChunkPath, 'utf8')
const statusChunkPath = join(PLUGIN_ROOT, 'client.status.js')
const statusSource = readFileSync(statusChunkPath, 'utf8')
const clientData = loadClientData(clientSource)

// Release pin follows package.json (the single version truth): version-truth
// keeps every public surface in sync, and this test proves the package ships it.
const EXPECTED_VERSION = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')).version

// Frame counts come from the private manifests: human 68, cat 74 (10-frame
// stand_wag + 8-frame idle), dog 70. Total 212 embedded frames; never assume 12x68/204.
const EXPECTED_FRAME_COUNTS = { human: 68, cat: 74, dog: 70 }

test('generated block embeds human/cat/dog with 12 clips and manifest frame counts (68/74/70 = 212)', () => {
  const total = { frames: 0 }
  for (const kind of CHARACTERS) {
    const anim = clientData.ANIMS[kind]
    assert.ok(anim, kind + ': ANIMS entry is present')
    assert.equal(Object.keys(anim.clips).length, 12, kind + ': 12 clips')
    const frames = Object.values(anim.clips).reduce((sum, clip) => sum + clip.frames.length, 0)
    assert.equal(frames, EXPECTED_FRAME_COUNTS[kind], kind + ': manifest frame count')
    total.frames += frames
  }
  assert.equal(total.frames, 212, '212 embedded frames in total')
  assert.equal(Object.keys(clientData.SPRITES).length, 212, '212 unique sprite keys')
})

test('cat stand_wag keeps its 10-frame / 3200ms non-uniform holdMs timing', () => {
  const cat = clientData.ANIMS.cat.clips.stand_wag
  assert.equal(cat.frames.length, 10, 'cat stand_wag has 10 frames')
  assert.deepEqual(cat.holdMs, [300, 300, 300, 350, 400, 400, 400, 350, 250, 150], 'per-frame holdMs from the manifest')
  assert.equal(cat.durationMs, 3200, 'manifest durationMs')
  assert.equal(cat.holdMs.reduce((sum, value) => sum + value, 0), 3200, 'holdMs sums to durationMs')
  // The other species keep the 6-frame stand_wag; timing is per-species data.
  for (const kind of ['human', 'dog']) {
    const clip = clientData.ANIMS[kind].clips.stand_wag
    assert.equal(clip.frames.length, 6, kind + ': stand_wag keeps 6 frames')
    assert.equal(clip.holdMs, undefined, kind + ': stand_wag has no per-frame holds')
  }
})

test('every embedded frame is a 96x96 PNG with visible pixels', () => {
  for (const kind of CHARACTERS) {
    const anim = clientData.ANIMS[kind]
    for (const clip of Object.values(anim.clips)) {
      for (const frameKey of clip.frames) {
        const base64 = clientData.SPRITES[frameKey]
        assert.equal(typeof base64, 'string', frameKey + ': sprite base64')
        const png = decodePng(Buffer.from(base64, 'base64'))
        assert.equal(png.width, 96, frameKey + ': width')
        assert.equal(png.height, 96, frameKey + ': height')
        let visible = 0
        for (let offset = 3; offset < png.rgba.length; offset += 4) if (png.rgba[offset] !== 0) visible += 1
        assert.ok(visible > 100, frameKey + ': visible hard-alpha pixels')
      }
    }
  }
})

test('bubble and TTS policy is human=speech/tts, cat+dog=thought/no-tts', () => {
  assert.deepEqual({ canTts: clientData.ANIMS.human.canTts, bubble: clientData.ANIMS.human.bubble }, { canTts: true, bubble: 'speech' })
  for (const kind of ['cat', 'dog']) {
    assert.deepEqual({ canTts: clientData.ANIMS[kind].canTts, bubble: clientData.ANIMS[kind].bubble }, { canTts: false, bubble: 'thought' }, kind)
  }
})

const REQUIRED_REGION_EVENTS = { head: 'pat', body: 'stand_wag', tail: 'chase_tail' }

function assertSaysArray(kind, where, says) {
  assert.ok(Array.isArray(says), kind + ' ' + where + ': says is an array')
  assert.ok(says.length >= 2, kind + ' ' + where + ': at least two random lines (so a repeat tap can differ)')
  assert.ok(says.length <= 6, kind + ' ' + where + ': at most six random lines')
  for (const line of says) {
    assert.equal(typeof line, 'string', kind + ' ' + where + ': says line is a string')
    assert.ok(line.length > 0 && line.length <= 120, kind + ' ' + where + ': says line length')
  }
}

test('embedded tap regions follow the famling hero regions contract with random says', () => {
  for (const kind of CHARACTERS) {
    const config = clientData.ANIMS[kind].regions
    assert.ok(config, kind + ': regions embedded in ANIMS')
    assert.equal(config.version, 1, kind + ': regions version')
    assert.deepEqual(config.canvas, [96, 96], kind + ': regions canvas matches the 96x96 art canvas')
    assert.ok(Array.isArray(config.regions) && config.regions.length > 0, kind + ': regions array')
    const ids = new Set(config.regions.map((region) => region.id))
    for (const regionId of Object.keys(REQUIRED_REGION_EVENTS)) assert.ok(ids.has(regionId), kind + ': declares ' + regionId)
    for (const region of config.regions) {
      assert.equal(region.rect.length, 4, kind + '/' + region.id + ': rect is [x,y,width,height]')
      const [x, y, width, height] = region.rect
      assert.ok(width > 0 && height > 0, kind + '/' + region.id + ': rect size is positive')
      assert.ok(x >= 0 && y >= 0 && x + width <= 96 && y + height <= 96, kind + '/' + region.id + ': rect stays inside the canvas')
    }
    assert.ok(Array.isArray(config.gestures) && config.gestures.length > 0, kind + ': gestures array')
    for (const [regionId, event] of Object.entries(REQUIRED_REGION_EVENTS)) {
      const rule = config.gestures.find((gesture) => gesture.region === regionId && (gesture.gesture || 'tap') === 'tap' && gesture.event === event)
      assert.ok(rule, kind + '/' + regionId + ': tap -> ' + event)
      assert.ok(Array.isArray(rule.states) && rule.states.includes('idle') && rule.states.includes('idle_blink'), kind + '/' + regionId + ': idle/idle_blink gating')
      assertSaysArray(kind, 'region ' + regionId, rule.says)
    }
  }
})

// Species menu contract: the events each character's interaction menu must cover.
const REQUIRED_ACTION_EVENTS = {
  human: ['pat', 'feed', 'stand_wag', 'paw_face', 'talk'],
  cat: ['pat', 'stand_wag', 'paw_face', 'chase_tail', 'run'],
  dog: ['pat', 'ball_throw', 'ball_chase', 'chase_tail', 'run'],
}
const BALL_EVENTS = ['ball_throw', 'ball_chase']

test('embedded species actions and their event -> clip mapping are valid', () => {
  for (const kind of CHARACTERS) {
    const actions = clientData.ANIMS[kind].actions
    assert.ok(Array.isArray(actions) && actions.length > 0, kind + ': actions array')
    const ids = new Set()
    const events = new Set()
    for (const action of actions) {
      assert.match(action.id, /^[a-z][a-z0-9_.-]{0,63}$/, kind + ': safe action id ' + action.id)
      assert.ok(!ids.has(action.id), kind + ': unique action id ' + action.id)
      ids.add(action.id)
      assert.equal(typeof action.label, 'string', kind + '/' + action.id + ': label')
      assert.ok(action.label.length > 0 && action.label.length <= 32, kind + '/' + action.id + ': label length')
      assert.ok(Object.prototype.hasOwnProperty.call(clientData.EVENT_CLIPS, action.event), kind + '/' + action.id + ': event has a client clip mapping: ' + action.event)
      assertSaysArray(kind, 'action ' + action.id, action.says)
      events.add(action.event)
      const clipId = clientData.EVENT_CLIPS[action.event]
      if (clipId !== null) assert.ok(clientData.ANIMS[kind].clips[clipId], kind + '/' + action.id + ': mapped clip exists: ' + clipId)
      if (action.followUpEvent !== undefined) {
        assert.notEqual(action.followUpEvent, action.event, kind + '/' + action.id + ': follow-up differs from primary event')
        assert.ok(Object.prototype.hasOwnProperty.call(clientData.EVENT_CLIPS, action.followUpEvent), kind + '/' + action.id + ': follow-up has a clip mapping')
        const followClip = clientData.EVENT_CLIPS[action.followUpEvent]
        assert.ok(clientData.ANIMS[kind].clips[followClip], kind + '/' + action.id + ': follow-up clip exists: ' + followClip)
        assert.equal(typeof action.followUpMs, 'number', kind + '/' + action.id + ': follow-up delay')
        assert.ok(action.followUpMs >= 0 && action.followUpMs <= 5000, kind + '/' + action.id + ': follow-up delay bounds')
      }
    }
    for (const requiredEvent of REQUIRED_ACTION_EVENTS[kind]) assert.ok(events.has(requiredEvent), kind + ': menu covers event ' + requiredEvent)
  }
})

test('cat and human menus have no ball actions; dog fetch chains ball_throw -> ball_chase', () => {
  for (const kind of ['cat', 'human']) {
    const actions = clientData.ANIMS[kind].actions
    const events = actions.map((action) => action.event)
    for (const ballEvent of BALL_EVENTS) assert.ok(!events.includes(ballEvent), kind + ': no ball event ' + ballEvent)
    for (const action of actions) assert.doesNotMatch(action.label, /球|ball/i, kind + ': no ball-like label ' + action.label)
  }
  const dog = clientData.ANIMS.dog.actions
  const fetch = dog.find((action) => action.event === 'ball_throw')
  assert.ok(fetch, 'dog: exposes a ball_throw action')
  assert.equal(fetch.followUpEvent, 'ball_chase', 'dog fetch: follow-up is ball_chase')
  assert.ok(dog.some((action) => action.event === 'ball_chase'), 'dog: exposes a retrieve/ball_chase action')
})

test('embedded regions and actions match the private regions.json or the vendored spec', () => {
  // Cross-repo byte cross-check when the private checkout exists; the vendored
  // spec is the standalone source of truth (MB-004: no private repo needed).
  const charactersRoot = resolveCharactersRoot(null)
  if (charactersRoot) {
    for (const kind of CHARACTERS) {
      const source = loadRegionConfig(charactersRoot, kind)
      assert.deepEqual(clientData.ANIMS[kind].regions, source, kind + ': embedded regions equal the source document')
      assert.deepEqual(clientData.ANIMS[kind].actions, source.actions, kind + ': embedded actions equal the source document')
    }
    return
  }
  const { spec } = readAnimationSpec(PLUGIN_ROOT)
  for (const kind of CHARACTERS) {
    const expected = spec.characters[kind].regions
    assert.deepEqual(clientData.ANIMS[kind].regions, expected, kind + ': embedded regions equal the vendored spec')
    assert.deepEqual(clientData.ANIMS[kind].actions, expected.actions, kind + ': embedded actions equal the vendored spec')
  }
})

test('client code hit-tests regions at the rendered size, only reacts while idle and picks random says', () => {
  assert.ok(clientSource.includes('function onPetClick(event)'), 'pet click handler receives the DOM event')
  assert.ok(behaviorSource.includes('function clickArtPoint(event, config)'), 'rendered-size -> 96px art mapping helper exists (lazy behavior kit)')
  assert.ok(behaviorSource.includes('function regionAt(config, artX, artY)'), 'region hit-test helper exists (lazy behavior kit)')
  assert.ok(clientSource.includes("anim === 'idle' ? (blink ? 'idle_blink' : 'idle') : anim"), 'state gating accepts idle and idle_blink only')
  assert.ok(behaviorSource.includes('function pickSaidLine(pool, key, previous)'), 'random bubble-line picker exists (lazy behavior kit)')
  assert.ok(clientSource.includes('pickSaidLine(reaction.says'), 'region taps pick a random line from the region says')
  assert.ok(clientSource.includes('pickSaidLine(action.says'), 'menu actions pick a random line from the action says')
  assert.ok(!clientSource.includes('playMicroAction(true)'), 'pet clicks no longer fall back to a random micro action')
  assert.ok(!clientSource.includes('ACTION_SETS'), 'obsolete hand-written per-character action rows are gone')
  assert.ok(clientSource.includes('behavior.tapPlan('), 'the entry applies the lazy behavior kit tap plan')
  assert.ok(behaviorSource.includes('function tapGuard(history, key, now)'), 'repeat-tap cooldown lives in the lazy behavior kit')
})

test('the interaction menu renders the embedded current-character actions', () => {
  assert.ok(clientSource.includes('ANIMS[character]?.actions'), 'action panel reads ANIMS[character].actions')
  assert.ok(clientSource.includes('action.followUpEvent'), 'action buttons schedule follow-up events')
  assert.ok(clientSource.includes('const EVENT_CLIPS = {'), 'event -> clip table exists')
  assert.ok(clientSource.includes('// <dsh-famling:event-clips:begin>'), 'EVENT_CLIPS lives in the generated event-clips block (MB-107)')
  assert.equal(clientSource.includes('Hand-written event -> clip table'), false, 'EVENT_CLIPS is generated, not hand-written')
})

test('client code enforces the TTS policy guard, persists the character and keeps the white bubble', () => {
  assert.ok(clientSource.includes('canTts && settings.sound && ttsConsent'), 'TTS guard tied to character policy')
  assert.ok(clientSource.includes('localStorage.setItem(CHARACTER_KEY, character)'), 'character persisted')
  assert.ok(clientSource.includes("'dsh-famling/character'"), 'character storage key')
  assert.ok(clientSource.includes('window.speechSynthesis.cancel()'), 'silent characters cancel running speech')
  assert.ok(clientSource.includes("'--dsh-famling-bubble-bg': '#ffffff'") && clientSource.includes("'--dsh-famling-bubble-text': '#111111'"), 'default theme keeps the white bubble with dark text')
  assert.ok(clientSource.includes('var(--dsh-famling-bubble-bg, #ffffff)') && clientSource.includes('var(--dsh-famling-bubble-text, #111111)'), 'bubble is painted from the theme CSS variables')
  assert.ok(clientSource.includes('var(--dsh-famling-bubble-thought-border, #8f8f8f)') && clientSource.includes('var(--dsh-famling-bubble-border, #9a9a9a)'), 'bubble keeps the grey dashed/solid theme borders')
})

test('TTS/ASR consent is versioned, hashed and withdrawable (MB-014)', () => {
  assert.ok(clientSource.includes("const CONSENT_KEY = 'dsh-famling/consent/v2'"), 'the entry reads the v2 consent key')
  assert.ok(clientSource.includes('record.withdrawn'), 'withdrawn records never grant consent')
  assert.ok(clientSource.includes('record.acceptedAt'), 'acceptedAt is part of the validity check')
  assert.ok(clientSource.includes('record.version === CONSENT_DECLARATION.version') && clientSource.includes('record.hash === CONSENT_DECLARATION.hash'), 'version and hash must match the frozen declaration')
  assert.ok(contentSource.includes("const LEGACY_CONSENT_KEY = 'dsh-famling/consent/v1'"), 'the chunk migrates the legacy v1 key')
  assert.ok(contentSource.includes("version: 'legacy-v1'") && contentSource.includes('withdrawn: true'), 'legacy booleans become withdrawn records')
  assert.ok(contentSource.includes('withdrawn: false'), 'accept creates a non-withdrawn record')
  assert.ok(contentSource.includes("saveConsent('withdraw')"), 'the settings UI can withdraw consent')
  assert.ok(contentSource.includes('撤回语音同意'), 'withdrawal has its own control')
  assert.ok(contentSource.includes('SHA-256'), 'the dialog/settings disclose the declaration hash')
})

test('chat payload carries the active character with a human fallback', () => {
  assert.ok(clientSource.includes('function chatCharacter(value)'), 'character normalization helper exists')
  assert.ok(clientSource.includes("return CHARACTER_IDS.includes(value) ? value : 'human'"), 'unknown/missing character falls back to human')
  assert.ok(clientSource.includes("op: 'chat', text, character: chatCharacter(characterRef.current)"), 'chat request carries the live character')
})

test('embedded animation data is current against the private asset pack or the vendored spec', () => {
  const assetsRoot = resolveAssetsRoot(null)
  if (assetsRoot) {
    const result = verifyClient({ assetsRoot })
    assert.equal(result.ok, true, result.errors.join('; '))
    return
  }
  const { spec } = readAnimationSpec(PLUGIN_ROOT)
  const result = validateEmbeddedAgainstSpec({ pluginRoot: PLUGIN_ROOT, spec })
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.equal(result.stats.frames, 212, 'vendored spec validates all 212 embedded frames without the private checkout')
})

test('first-screen client.js carries no sprite payload and meets the lazy budget', () => {
  const entryBytes = Buffer.byteLength(clientSource)
  const humanBytes = Buffer.byteLength(readFileSync(chunkPath(PLUGIN_ROOT, 'human'), 'utf8'))
  assert.ok(entryBytes <= FIRST_SCREEN_BUDGET_BYTES, 'client.js ' + entryBytes + ' B is within the ' + FIRST_SCREEN_BUDGET_BYTES + ' B budget')
  assert.ok(entryBytes < AUDIT_BASELINE_BYTES * 0.31, 'entry shrinks >69% vs the pre-split audit snapshot')
  assert.ok(entryBytes + humanBytes < AUDIT_BASELINE_BYTES * 0.72, 'first paint (entry + default chunk) stays within 72% of the pre-split audit snapshot (2026-11-22 final-art re-baseline)')
  // The behavior kit and the host-status kit are both requested right after
  // mount, so the honest mount payload charges them too. The 0.11.2 host-state
  // hook moved the mount gate 52% -> 54%; 0.13.3's bubble-priority/work-state
  // consumption re-baselines it to 55% (released, measured entry+status kit).
  // The entry-only 31%/96 KiB gates above are unchanged.
  const behaviorChunkBytes = Buffer.byteLength(readFileSync(behaviorChunkPath, 'utf8'))
  const statusChunkBytes = Buffer.byteLength(readFileSync(statusChunkPath, 'utf8'))
  assert.ok(entryBytes + humanBytes + behaviorChunkBytes + statusChunkBytes < AUDIT_BASELINE_BYTES * 0.75, 'mount payload (entry + default chunk + behavior kit + host-status kit) stays within 75% of the pre-split audit snapshot (2026-11-22 final-art re-baseline)')
  assert.equal(/data:image\/png;base64,[A-Za-z0-9+/]{512,}/.test(clientSource), false, 'no full base64 PNG frame in client.js')
  assert.equal(/[A-Za-z0-9+/]{4096,}={0,2}/.test(clientSource), false, 'no multi-KB base64 literal in client.js')
  assert.ok(clientSource.includes('function requestCharacterChunk(kind, onSettled)'), 'lazy chunk request helper exists')
  assert.ok(clientSource.includes('asyncRequire(CHARACTER_CHUNKS[kind])'), 'chunks load through the module table require.async')
  assert.ok(clientSource.includes('const CHARACTER_CHUNKS = '), 'generated chunk map exists')
  assert.ok(clientSource.includes('function characterCanTts(kind)'), 'bubble/TTS policy is available before the chunk arrives')
  // Offline/no-network: no external URL is used in a load path (chunks are package-local).
  assert.equal(/(?:fetch|import)\s*\(\s*['"]https?:\/\//.test(clientSource), false, 'no external fetch/import')
  assert.equal(/(?:src|href)\s*[:=]\s*['"]https?:\/\//.test(clientSource), false, 'no external asset URL')
})

test('lazy character chunks register with the DSH module table and hold only their own sprites', () => {
  for (const kind of CHARACTERS) {
    const path = chunkPath(PLUGIN_ROOT, kind)
    const source = readFileSync(path, 'utf8')
    // DSH client/modules only serves names matching /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.
    assert.match(CHUNK_NAMES[kind], /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/, kind + ': chunk name is accepted by the DSH module table')
    const loaded = loadChunkModule(path)
    assert.equal(loaded.registration.id, 'dsh-famling', kind + ': chunk registers the package module id')
    assert.equal(loaded.registration.chunk, CHUNK_NAMES[kind], kind + ': chunk field matches the file name')
    assert.equal(typeof loaded.registration.factory, 'function', kind + ': factory is registered')
    const anim = loaded.exports.anims
    const sprites = loaded.exports.sprites
    assert.ok(anim && anim.clips, kind + ': chunk exports clip metadata')
    const frames = Object.values(anim.clips).reduce((sum, clip) => sum + clip.frames.length, 0)
    assert.equal(Object.keys(sprites).length, frames, kind + ': one sprite per frame')
    assert.equal(frames, EXPECTED_FRAME_COUNTS[kind], kind + ': manifest frame count')
    for (const frameKey of Object.keys(sprites)) {
      assert.ok(frameKey.startsWith(kind + '/'), kind + ': no foreign sprite ' + frameKey)
      const png = decodePng(Buffer.from(sprites[frameKey], 'base64'))
      assert.equal(png.width, 96, kind + ': sprite width')
    }
    assert.equal(source.includes('source-sha256: '), true, kind + ': chunk carries the source hash header')
    assert.equal(/(?:fetch|import)\s*\(\s*['"]https?:\/\//.test(source), false, kind + ': chunk uses no external network')
  }
})

test('cat label is the blue-bicolor Ragdoll (the shipped 2026-11-20 cross-repo art), not Selkirk', () => {
  assert.ok(clientSource.includes("cat: '布偶猫'"), 'zh client label')
  assert.ok(clientSource.includes("cat: 'Ragdoll'"), 'en client label')
  assert.equal(clientSource.includes('塞尔凯克'), false, 'client source has no stale Selkirk label')
  assert.equal(clientSource.includes('Selkirk Rex'), false, 'client source has no stale Selkirk Rex label')
  for (const file of ['README.md', 'docs/DETAIL.md', 'locale/zh.json', 'locale/en.json']) {
    const text = readFileSync(join(PLUGIN_ROOT, file), 'utf8')
    assert.equal(text.includes('塞尔凯克'), false, file + ': no stale Selkirk label')
    assert.equal(text.includes('Selkirk Rex'), false, file + ': no stale Selkirk Rex label')
    assert.equal(text.includes('卷毛'), false, file + ': no stale curly-coat copy')
  }
  const zh = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'locale/zh.json'), 'utf8'))
  assert.match(zh.meta.title, /布偶猫/)
})

test('package version is ' + EXPECTED_VERSION + ', publishes the lazy chunks and the v3 content contract', async () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.version, EXPECTED_VERSION)
  assert.equal(pkg.exports['./content-extension'], './content-extension.mjs', 'package exports the content extension contract')
  assert.ok(pkg.files.includes('content-extension.mjs'), 'package publishes the content extension contract')
  for (const kind of CHARACTERS) assert.ok(pkg.files.includes(CHUNK_NAMES[kind]), 'package files publishes ' + CHUNK_NAMES[kind])
  assert.ok(pkg.files.includes('client.content.js'), 'package publishes the lazy content-center chunk')
  assert.ok(pkg.files.includes('client.behavior.js'), 'package publishes the lazy behavior kit chunk')
  assert.ok(pkg.files.includes('client.status.js'), 'package publishes the lazy host-status kit chunk')
  assert.equal(pkg.dsh.client.immediately, false, 'footer pet is not a stage-one registration barrier')
  assert.equal(pkg.scripts['measure:bundle'], 'node scripts/measure-bundle.mjs')
  const module = await import('../index.js')
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.name, 'dsh-famling')
})

test('client.js renders the pet alone: no permanent action buttons and no HTML injection', () => {
  assert.equal(clientSource.includes("key: 'buttons'"), false, 'the four persistent sidebar buttons are gone')
  assert.equal(clientSource.includes("h('button', { key: 'input'"), false, 'no permanent input button')
  assert.equal(clientSource.includes("h('button', { key: 'actions'"), false, 'no permanent interaction button')
  assert.equal(clientSource.includes("h('button', { key: 'settings'"), false, 'no permanent settings button')
  assert.equal(clientSource.includes("h('button', { key: 'content'"), false, 'no permanent content button')
  assert.ok(clientSource.includes("'aria-haspopup': 'menu'"), 'the pet advertises the menu instead')
  assert.ok(clientSource.includes('menuButton ? h('), 'the ⋯ trigger is opt-in only')
  assert.ok(clientSource.includes('function loadMenuState()'), 'menu button state is loaded from storage')
  assert.ok(clientSource.includes('return { button: false }'), 'the menu button defaults to hidden')
  assert.equal(clientSource.includes(': false, page:'), false, 'open/submenu state is transient, not persisted')
  for (const [name, source] of [['client.js', clientSource], ['client.content.js', contentSource], ['client.behavior.js', behaviorSource], ['client.status.js', statusSource]]) {
    assert.equal(source.includes('.innerHTML ='), false, name + ': no innerHTML injection')
    assert.equal(/\beval\s*\(|new Function\s*\(/.test(source), false, name + ': no eval/Function')
  }
})

test('right-click menu is hierarchical, fixed/clamped and fully keyboard driven', () => {
  assert.ok(clientSource.includes('onContextMenu: openMenu'), 'right click opens the menu')
  assert.ok(clientSource.includes("'F10' && event.shiftKey"), 'Shift+F10 opens the menu')
  assert.ok(clientSource.includes("key === 'ContextMenu'"), 'ContextMenu key opens the menu')
  assert.ok(clientSource.includes("const MENU_KEY = 'dsh-famling/menu'"), 'menu state storage key')
  assert.ok(clientSource.includes("menuPage === 'actions'") && clientSource.includes("menuPage === 'more'"), 'root plus actions/more submenu pages')
  assert.ok(clientSource.includes('setMenuPage(item.submenu)'), 'submenu items switch the page')
  assert.ok(clientSource.includes('function clampMenuPosition(x, y, width, height)'), 'viewport clamp helper')
  assert.ok(clientSource.includes("position: 'fixed'"), 'menu is fixed positioned')
  assert.ok(clientSource.includes("role: 'menu'") && clientSource.includes("role: 'menuitem'"), 'aria menu semantics')
  assert.ok(clientSource.includes("'aria-activedescendant'"), 'the active item is announced')
  for (const key of ["'ArrowDown'", "'ArrowUp'", "'Home'", "'End'", "'Escape'", "'Enter'"]) assert.ok(clientSource.includes(key), 'keyboard handling: ' + key)
  assert.ok(clientSource.includes("key === 'ArrowLeft'") && clientSource.includes("key === 'ArrowRight'"), 'submenu page keyboard navigation')
  assert.ok(clientSource.includes("label: '« ' + L.back"), 'submenu pages have a back item')
  assert.ok(clientSource.includes('localStorage.setItem(MENU_KEY, JSON.stringify({ button: menuButton }))'), 'menu button preference persisted')
  assert.ok(clientSource.includes("setMenuPage('root')"), 'each open starts at level one')
  for (const label of ["chatEntry: '聊两句…'", "settingsEntry: '设置…'", "moreEntry: '更多'", "remindEntry: '提醒…'", "notice: '使用限制与版本'"]) assert.ok(clientSource.includes(label), 'localized menu label: ' + label)
  // Offline / no-navigation invariants stay.
  assert.equal(/location\.(?:reload|href|assign|replace)\s*[=(]/.test(clientSource), false, 'menu switches never reload or navigate')
  assert.equal(/(?:fetch|import)\s*\(\s*['"]https?:\/\//.test(clientSource), false, 'no external fetch/import')
  assert.equal(/(?:src|href)\s*[:=]\s*['"]https?:\/\//.test(clientSource), false, 'no external asset URL')
})

test('menu, triggers and buttons paint from the DSH host theme, not the role theme', () => {
  const menuStart = clientSource.indexOf("key: 'menu', ref: menuRef")
  const menuEnd = clientSource.indexOf('currentMenuItems.map')
  assert.ok(menuStart > 0 && menuEnd > menuStart, 'menu node block exists')
  const menuBlock = clientSource.slice(menuStart, menuEnd)
  assert.ok(menuBlock.includes('var(--dsw-alias-bg-layer-1, light-dark(#ffffff, #1f2329))'), 'menu surface uses the real host layer-1 token with a light-dark fallback')
  assert.ok(menuBlock.includes('var(--dsw-alias-label-primary, light-dark(#0f1115, #f5f7fa))'), 'menu text uses the host primary label')
  assert.ok(menuBlock.includes('var(--dsw-alias-border-l2, light-dark(rgba(0,0,0,.12), rgba(255,255,255,.16)))'), 'menu border uses the host border token')
  assert.equal(menuBlock.includes('--dsh-famling-panel-bg'), false, 'the menu never reads the role night/paper panel background')
  assert.equal(menuBlock.includes('--dsh-famling-panel-text'), false, 'the menu never reads the role panel text')
  assert.ok(clientSource.includes('var(--dsw-alias-state-business-primary, light-dark(#4176e6, #7aaaff))'), 'active menu items use the host accent')
  assert.ok(clientSource.includes('var(--dsw-alias-label-primary-inverted, light-dark(#ffffff, #1c1c1e))'), 'active menu items use the inverted host label')
  assert.ok(clientSource.includes('var(--dsw-alias-button-elevated-fill, light-dark(rgba(0,0,0,.04), rgba(255,255,255,.08)))'), 'button fill fallback adapts to day/night')
  assert.ok(clientSource.includes("colorScheme: 'inherit'"), 'the widget root inherits the DSH palette selector so light-dark() follows day/night')
})
test('default panel paints from the real DSH host tokens with a readable light/dark fallback', () => {
  // DSH 0.2.2-rc.4 defines --dsw-alias-bg-layer-1 (light #ffffff / dark #232324)
  // and --dsw-alias-label-primary (light #0f1115 / dark #f9fafb) in
  // packages/client/ui-theme/src/styles/design-platform.css; it never defines
  // --dsw-alias-bg-elevated, so that token must not lead a fallback chain.
  const luminance = (hex) => {
    const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    const number = parseInt(hex.slice(1), 16)
    return 0.2126 * channel((number >> 16) & 255) + 0.7152 * channel((number >> 8) & 255) + 0.0722 * channel(number & 255)
  }
  const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (high + 0.05) / (low + 0.05)
  }
  const themeStart = clientSource.indexOf('const THEMES = {')
  const themeEnd = clientSource.indexOf('const FONT_SIZES = [')
  assert.ok(themeStart > 0 && themeEnd > themeStart, 'THEMES literal is readable by the budget test')
  const themes = new Function('return ' + clientSource.slice(themeStart + 'const THEMES = '.length, themeEnd).trim())()
  const defaultVars = themes.default.vars
  assert.equal(defaultVars['--dsh-famling-panel-bg'], 'var(--dsw-alias-bg-layer-1, light-dark(#ffffff, #1f2329))', 'panel surface uses the host layer-1 token with a light-dark fallback')
  assert.equal(defaultVars['--dsh-famling-panel-text'], 'var(--dsw-alias-label-primary, light-dark(#111111, #e8e8e8))', 'panel text uses the host primary label with a light-dark fallback')
  assert.equal(defaultVars['--dsh-famling-panel-border'], 'var(--dsw-alias-border-l2, light-dark(rgba(0,0,0,.14), rgba(255,255,255,.16)))', 'panel border uses the host border token')
  for (const [name, source] of [['client.js', clientSource], ['client.content.js', contentSource], ['client.behavior.js', behaviorSource], ['client.status.js', statusSource]]) {
    assert.equal(source.includes('--dsw-alias-bg-elevated'), false, name + ': the phantom host token is gone')
  }
  // Real host-provided pairs and the fallback pairs must stay >= 4.5:1 body text.
  assert.ok(contrast('#ffffff', '#0f1115') >= 4.5, 'light host surface/label contrast')
  assert.ok(contrast('#232324', '#f9fafb') >= 4.5, 'dark host surface/label contrast')
  assert.ok(contrast('#ffffff', '#111111') >= 4.5, 'light fallback contrast')
  assert.ok(contrast('#1f2329', '#e8e8e8') >= 4.5, 'dark fallback contrast')
  for (const themeId of ['paper', 'night']) {
    assert.ok(contrast(themes[themeId].vars['--dsh-famling-panel-bg'], themes[themeId].vars['--dsh-famling-panel-text']) >= 4.5, themeId + ': explicit theme panel contrast')
  }
  // The lazy consent dialog duplicates the chain; it must mirror the fix.
  assert.ok(contentSource.includes("background: 'var(--dsh-famling-panel-bg, var(--dsw-alias-bg-layer-1, light-dark(#ffffff, #1f2329)))'"), 'consent dialog mirrors the panel surface chain')
  assert.ok(contentSource.includes("color: 'var(--dsh-famling-panel-text, var(--dsw-alias-label-primary, light-dark(#111111, #e8e8e8)))'"), 'consent dialog mirrors the panel text chain')
  assert.ok(clientSource.includes("background: 'var(--dsh-famling-panel-bg)'"), 'panel surfaces inherit the validated widget-root variable')
})

test('lazy panel chunk exposes the four-tab content center and the unified settings popup', () => {
  assert.ok(contentSource.includes("chunk: 'client.content.js'"), 'content chunk registers the package-local chunk name')
  assert.ok(contentSource.includes('function createContentCenter('), 'content chunk exposes the content center factory')
  assert.ok(contentSource.includes('function createSettingsPanel('), 'content chunk exposes the unified settings factory')
  assert.ok(contentSource.includes('createContentCenter, createSettingsPanel'), 'both popups are exported from the lazy chunk')
  for (const factory of ['createInputPanel', 'createConsentDialog', 'createNoticePanel']) {
    assert.ok(contentSource.includes('function ' + factory + '('), factory + ' lives in the lazy chunk')
    assert.ok(clientSource.includes('panelChunk.' + factory + '('), 'client.js renders ' + factory + ' through the lazy chunk')
  }
  assert.ok(clientSource.includes('panelChunk.createContentCenter('), 'client.js renders the content center through the lazy chunk')
  assert.ok(clientSource.includes('panelChunk.createSettingsPanel('), 'client.js renders settings through the lazy chunk')
  for (const label of ['一键应用', '仅修改当前角色的搭配', '恢复角色默认', '资产包', '远程市场接口已预留', 'researchOnly=true']) assert.ok(contentSource.includes(label), 'content chunk keeps: ' + label)
  for (const tab of ["roles: '角色'", "custom: '自定义'", "packs: '内容包'", "market: '市场'"]) assert.ok(contentSource.includes(tab), 'four first-level tabs: ' + tab)
  // Unified settings popup: every adjustable item + folded advanced/debug.
  for (const label of ["settingsTitle: '设置'", "showMenuButton: '显示菜单按钮'", "menuButtonHint:", "advancedGroup: '高级 / 调试'", "bubble: '说话气泡'", "memoryGroup: 'Advisers'", "contentEntry: '内容与角色…'"]) assert.ok(contentSource.includes(label), 'settings labels: ' + label)
  for (const toggle of ["toggle('quiet'", "toggle('bubble'", "toggle('menu-button'", "toggle('sound'"]) assert.ok(contentSource.includes(toggle), 'settings toggle: ' + toggle)
  for (const label of ["lowDisturbGroup: '低打扰'", "quietHours: '安静时段'", "motionAuto: '跟随系统'", "motionOn: '允许动画'", "motionOff: '减少动态'", "hideHour: '隐藏 1 小时'", "hideTomorrow: '隐藏到明天'", "prefers-reduced-motion", "type: 'time'"]) assert.ok(contentSource.includes(label), 'low-disturb settings: ' + label)
  for (const entryGate of ["const HIDDEN_KEY = 'dsh-famling/hidden-until'", 'function isQuietHoursActive(', 'function resolveMotionPreference(', '60000 + Math.random() * 30000']) assert.ok(clientSource.includes(entryGate), 'low-disturb entry logic: ' + entryGate)
  assert.equal(clientSource.includes("h('textarea'"), false, 'input panel markup moved to the lazy chunk (entry budget)')
  assert.equal(clientSource.includes("h('input', { key: 'at', type: 'datetime-local'"), false, 'reminder form markup moved to the lazy chunk')
  assert.ok(contentSource.includes("'aria-expanded': Boolean(advancedOpen)"), 'advanced/debug group folds behind a toggle')
  assert.ok(contentSource.includes('setChoice') || contentSource.includes('choice('), 'appearance choices reuse the shared control helper')
  assert.ok(clientSource.includes("advancedOpen: settingsAdvanced"), 'collapsed state is owned by client.js (stable hook order)')
})

test('lazy behavior chunk registers with the module table and exports the interaction kit', () => {
  // The DSH module table only serves names matching /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.
  assert.match('client.behavior.js', /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/, 'behavior chunk name is accepted by the DSH module table')
  const loaded = loadChunkModule(behaviorChunkPath)
  assert.equal(loaded.registration.id, 'dsh-famling', 'behavior chunk registers the package module id')
  assert.equal(loaded.registration.chunk, 'client.behavior.js', 'behavior chunk field matches the file name')
  assert.equal(typeof loaded.registration.factory, 'function', 'behavior chunk factory is registered')
  for (const name of ['pickSaidLine', 'clickArtPoint', 'regionAt', 'regionReaction', 'tapGuard', 'tapPlan', 'frameDurations']) {
    assert.equal(typeof loaded.exports[name], 'function', 'behavior kit exports ' + name + '()')
  }
  assert.ok(clientSource.includes('asyncRequire(entry.file).then') && clientSource.includes('requestBehaviorChunk'), 'the entry loads the kit through one memoized require.async entry point')
  assert.ok(clientSource.includes("file: './client.behavior.js'"), 'the behavior kit request is package-local')
  assert.equal(/(?:fetch|import)\s*\(\s*['\"]https?:\/\//.test(behaviorSource), false, 'no external fetch/import')
  assert.equal(/(?:src|href)\s*[:=]\s*['\"]https?:/.test(behaviorSource), false, 'no external asset URL')
  assert.equal(behaviorSource.includes('localStorage'), false, 'the behavior kit never touches storage (client.js owns every key)')
  assert.equal(behaviorSource.includes('document.'), false, 'the behavior kit never touches the document')
})


test('lazy host-status chunk registers with the module table and exports the coarse-state kit', () => {
  // The DSH module table only serves names matching /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.
  assert.match('client.status.js', /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/, 'host-status chunk name is accepted by the DSH module table')
  const loaded = loadChunkModule(statusChunkPath)
  assert.equal(loaded.registration.id, 'dsh-famling', 'host-status chunk registers the package module id')
  assert.equal(loaded.registration.chunk, 'client.status.js', 'host-status chunk field matches the file name')
  assert.equal(typeof loaded.registration.factory, 'function', 'host-status chunk factory is registered')
  assert.equal(typeof loaded.exports.watchHostStatus, 'function', 'the chunk exports watchHostStatus()')
  assert.equal(typeof loaded.exports.readStateReport, 'function', 'the chunk exports its closed-schema reader')
  // The kit only polls the same-origin bridge through the entry's helper: no
  // storage, no DOM, no network of its own (the entry owns both).
  assert.equal(statusSource.includes('localStorage'), false, 'the host-status kit never touches storage')
  assert.equal(statusSource.includes('document.'), false, 'the host-status kit never touches the document')
  assert.equal(/(?:fetch|import)\s*\(\s*['\"]https?:\/\//.test(statusSource), false, 'no external fetch/import')
  assert.equal(/(?:src|href)\s*[:=]\s*['\"]https?:/.test(statusSource), false, 'no external asset URL')
  assert.equal(/\bsetInterval\b|\beval\s*\(|new Function\s*\(/.test(statusSource), false, 'no setInterval/eval in the lazy kit')
  assert.ok(clientSource.includes('requestStatusChunk') && clientSource.includes("file: './client.status.js'"), 'the entry loads the kit through one memoized package-local require.async entry')
  assert.ok(clientSource.includes('watchHostStatus'), 'the entry starts the watcher through the chunk export')
  assert.equal(clientSource.includes('hostStatus.current?.busy') || clientSource.includes('hostStatus.current?.busy'), true, 'automatic-output suppression reads the coarse busy flag')
  // The lazy kit stays small: it is charged to the mount payload gate above.
  assert.ok(Buffer.byteLength(statusSource) < 8 * 1024, 'host-status kit stays a small lazy chunk: ' + Buffer.byteLength(statusSource) + ' B')
})

test('the host-status reader rejects malformed bridge replies fail-closed', () => {
  const { readStateReport } = loadChunkModule(statusChunkPath).exports
  const good = { v: 2, ok: true, op: 'state', available: true, source: 'events', state: 'running', active: 1, updatedAt: 5, lastError: null, transitions: [{ state: 'running', at: 5 }] }
  // The chunk factory runs in a vm realm: compare fields, never object identity.
  const valid = readStateReport(good)
  assert.equal(valid.available, true, 'a valid report is accepted')
  assert.equal(valid.state, 'running', 'a valid report maps to the coarse state')
  assert.equal(readStateReport({ ...good, available: false, state: 'unknown' }).available, false, 'unsupported is reported, not guessed')
  const malformed = [
    null, undefined, 'state', [], {}, { ok: false, op: 'state' }, { ok: true, op: 'probe', available: true },
    { ...good, state: 'busy' }, { ...good, active: -1 }, { ...good, active: 65 }, { ...good, active: 1.5 }, { ...good, active: '1' },
    { ...good, updatedAt: 'now' }, { ...good, updatedAt: -1 },
    { ...good, lastError: { kind: 'weird', at: 1 } }, { ...good, lastError: { kind: 'auth', at: 'x' } }, { ...good, lastError: { kind: 'auth', at: 1, message: 'SECRET' } },
    { ...good, transitions: new Array(17).fill({ state: 'idle', at: 1 }) },
    { ...good, transitions: [{ state: 'busy', at: 1 }] },
    { ...good, transitions: [{ state: 'idle', at: 'x' }] },
  ]
  for (const reply of malformed) assert.equal(readStateReport(reply), null, 'fail-closed: ' + JSON.stringify(reply))
})
test('client role bundles and dialogue modes mirror the shared famling content library', (t) => {
  const begin = '// <dsh-famling:content:begin>'
  const end = '// <dsh-famling:content:end>'
  const block = clientSource.slice(clientSource.indexOf(begin) + begin.length, clientSource.indexOf(end))
  const data = new Function(block + '\nreturn { ROLE_BUNDLES, ROLE_IDS, DIALOGUE_MODES }')()
  assert.deepEqual(data.DIALOGUE_MODES, {
    standard: { maxChars: 240, bubbleChance: 0.7 },
    brief: { maxChars: 80, bubbleChance: 0.4 },
    quiet: { maxChars: 50, bubbleChance: 0.05 },
  }, 'dialogue modes mirror the shared dialoguePacks values')
  const expected = {
    human: { dialogue: 'standard', theme: 'default', background: 'transparent', family: 'system', canTts: true },
    cat: { dialogue: 'standard', theme: 'night', background: 'transparent', family: 'serif', canTts: false },
    dog: { dialogue: 'standard', theme: 'paper', background: 'transparent', family: 'system', canTts: false },
  }
  for (const [role, values] of Object.entries(expected)) {
    const bundle = data.ROLE_BUNDLES[role]
    assert.equal(bundle.dialogue, values.dialogue, role + ': dialogue matches shared rolePresets')
    assert.equal(bundle.theme, values.theme, role + ': theme matches shared rolePresets')
    assert.equal(bundle.background, values.background, role + ': background matches shared rolePresets')
    assert.equal(bundle.font.family, values.family, role + ': font matches shared rolePresets')
    assert.equal(bundle.voicePolicy.canTts, values.canTts, role + ': voice policy matches shared rolePresets')
  }
  assert.equal(data.ROLE_BUNDLES.origami.available, false, 'origami stays reserved (no art chunk in this plugin)')
  assert.equal(data.ROLE_BUNDLES.origami.theme, 'night', 'origami high-contrast is explicitly mapped to night, never silently applied')
  assert.ok(clientSource.includes('origami maps high-contrast to'), 'the origami mapping is documented in client.js')
  assert.ok(clientSource.includes('brief 80 / 40%, quiet 50 / 5%'), 'shared dialogue values are documented in client.js')
  // Cross-check against the actual shared library when the famling checkout is present.
  const libraryPath = join(PLUGIN_ROOT, '..', '..', 'desktop-games', 'public', 'content', 'library.json')
  if (!existsSync(libraryPath)) {
    t.skip('famling public/content/library.json is not available in this checkout')
    return
  }
  const library = JSON.parse(readFileSync(libraryPath, 'utf8'))
  const characterMap = { humanoid: 'human', cat: 'cat', dog: 'dog', origami: 'origami' }
  for (const role of ['human', 'cat', 'dog']) {
    const preset = library.rolePresets.find((item) => item.id === role)
    assert.ok(preset, 'shared rolePreset exists: ' + role)
    const bundle = data.ROLE_BUNDLES[role]
    assert.equal(bundle.character, characterMap[preset.characterId], role + ': characterId maps to the plugin character')
    assert.equal(bundle.dialogue, preset.dialoguePackId, role + ': dialoguePackId')
    assert.equal(bundle.theme, preset.appearance.themeId, role + ': themeId')
    assert.equal(bundle.background, preset.appearance.backgroundId, role + ': backgroundId')
    assert.equal(bundle.font.family, preset.appearance.fontId, role + ': fontId')
    assert.equal(bundle.voicePolicy.canTts, preset.voiceId !== 'none', role + ': voiceId -> canTts')
  }
  const origami = library.rolePresets.find((item) => item.id === 'origami')
  assert.ok(origami, 'shared origami preset exists')
  assert.equal(origami.appearance.themeId, 'high-contrast', 'shared origami theme is high-contrast')
  const pluginThemeIds = ['default', 'paper', 'night']
  assert.equal(pluginThemeIds.includes(origami.appearance.themeId), false, 'this plugin has no high-contrast theme, hence the documented night mapping')
  for (const pack of library.dialoguePacks) {
    const mode = data.DIALOGUE_MODES[pack.mode]
    assert.ok(mode, 'dialogue mode exists in client: ' + pack.mode)
    assert.equal(mode.maxChars, pack.maxChars, pack.mode + ': maxChars matches the shared dialoguePacks')
    assert.equal(mode.bubbleChance, pack.bubbleChance, pack.mode + ': bubbleChance matches the shared dialoguePacks')
  }
})

test('role bundles persist every component in the existing keys and record dsh-famling/role', () => {
  assert.ok(clientSource.includes('const ROLE_BUNDLES = {'), 'role bundle catalog exists')
  assert.ok(clientSource.includes("const ROLE_KEY = 'dsh-famling/role'"), 'role storage key is unified')
  assert.ok(clientSource.includes('localStorage.setItem(ROLE_KEY, roleId)'), 'active role persisted')
  assert.ok(clientSource.includes('function applyRole(nextRole)'), 'one-click role application exists')
  assert.ok(clientSource.includes('function restoreRole()'), 'restore-role-defaults exists')
  assert.ok(clientSource.includes("const ROLE_IDS = ['human', 'cat', 'dog']"), 'three available role cards')
  assert.ok(clientSource.includes('origami: { character: \'origami\''), 'origami bundle is reserved in data')
  for (const component of ["character: 'human'", 'voicePolicy: {', "dialogue: 'standard'", "theme: 'default'", "background: 'transparent'", "font: { family: 'system'"]) {
    assert.ok(clientSource.includes(component), 'role bundle component: ' + component)
  }
  for (const key of ["const DIALOGUE_KEY = 'dsh-famling/dialogue'", "const THEME_KEY = 'dsh-famling/theme'", "const BACKGROUND_KEY = 'dsh-famling/background'", "const FONT_KEY = 'dsh-famling/font'"]) {
    assert.ok(clientSource.includes(key), 'existing component storage key kept: ' + key)
  }
  assert.ok(clientSource.includes('loadRoleId()'), 'role id is loaded on first render')
  assert.ok(clientSource.includes('requestCharacterChunk(character'), 'character sprite chunks stay lazy')
  assert.ok(clientSource.includes('canTts && settings.sound && ttsConsent'), 'TTS guard tied to character policy')
  assert.ok(clientSource.includes("source === 'ambient' && dialogue.bubbleChance < 1"), 'shared bubble probability gates automatic/ambient lines only')
  assert.ok(clientSource.includes("source === 'ambient' && (dialogueMode === 'quiet' || isQuietHoursActive(settings.quietHours)"), 'quiet mode and quiet hours suppress ambient lines only (shared dialoguePack semantics)')
  assert.ok(clientSource.includes("isQuietHoursActive(settings.quietHours) || hostStatus.current?.busy"), 'a busy host agent reuses the same ambient/micro quiet suppression')
  assert.ok(clientSource.includes("say(line, 'speech', 'interactive')"), 'explicit taps/actions are not chance-gated (shared "explicit interaction bubbles still show")')
  assert.ok(clientSource.includes("line.slice(0, dialogue.maxChars - 1)"), 'brief mode filters over-long replies')
  assert.ok(clientSource.includes('utterance.voice = voice'), 'the selected browser voice is applied to speech')
  assert.ok(clientSource.includes('FONT_SIZES = [11, 12, 14]') && clientSource.includes('FONT_LINE_HEIGHTS = [1.4, 1.5, 1.8]'), 'font size/line height presets are bounded')
  assert.ok(contentSource.includes("canTts ? h('label'"), 'TTS toggle only renders when the character can speak')
  assert.ok(contentSource.includes('T.voiceSilent'), 'cat/dog show the silent thought-bubble policy')
  assert.equal(clientSource.includes('fonts.googleapis') || contentSource.includes('fonts.googleapis'), false, 'no web fonts')
  assert.equal(clientSource.includes('@import') || contentSource.includes('@import'), false, 'no CSS imports')
})

test('client role bundles match the v3 contract ids, components and declaration tokens', () => {
  const begin = '// <dsh-famling:content:begin>'
  const end = '// <dsh-famling:content:end>'
  const start = clientSource.indexOf(begin)
  const stop = clientSource.indexOf(end)
  assert.ok(start >= 0 && stop > start, 'client content block markers exist')
  const block = clientSource.slice(start + begin.length, stop)
  const data = new Function(block + '\nreturn { ROLE_BUNDLES, ROLE_IDS, USAGE_DECLARATION, MARKET_CONFIG }')()
  assert.deepEqual(Object.keys(data.ROLE_BUNDLES), [...ROLE_BUNDLE_IDS], 'client role ids match content-extension ROLE_BUNDLE_IDS')
  for (const role of ROLE_BUNDLE_IDS) {
    for (const component of ['character', 'voicePolicy', 'dialogue', 'theme', 'background', 'font']) {
      assert.ok(Object.prototype.hasOwnProperty.call(data.ROLE_BUNDLES[role], component), role + ': bundle component ' + component)
    }
  }
  assert.deepEqual([...data.ROLE_IDS], ['human', 'cat', 'dog'], 'three roles are available in the UI')
  assert.equal(data.ROLE_BUNDLES.origami.available, false, 'origami is data-only reserved')
  assert.equal(data.ROLE_BUNDLES.human.available, true)
  assert.equal(data.USAGE_DECLARATION.researchOnly, true)
  assert.deepEqual([...data.USAGE_DECLARATION.prohibitedUses], [...PROHIBITED_USES], 'client declaration tokens match the v3 contract')
  assert.equal(data.MARKET_CONFIG.status, 'reserved')
  assert.equal(data.MARKET_CONFIG.catalogUrl, null)
  assert.equal(data.MARKET_CONFIG.catalogUrlKey, 'dsh-famling/market/catalog')
})
test('content extension points publish the reserved v3 role/pack contract', () => {
  assert.equal(CONTENT_EXTENSION_POINTS.version, 3)
  assert.equal(CONTENT_EXTENSION_POINTS.status, 'reserved')
  assert.deepEqual({ ...CONTENT_EXTENSION_POINTS.transport }, { network: false, execute: false, innerHTML: false, worker: false, assets: false })
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.entry.kinds], ['role', 'character', 'voice', 'dialogue', 'theme', 'background', 'font'])
  for (const field of ['kind', 'id', 'name', 'preview', 'apply', 'source', 'permissions', 'version']) assert.ok(CONTENT_EXTENSION_POINTS.entry.fields.includes(field), 'entry field: ' + field)
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.entry.roleFields], ['compatibility'])
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.pack.sources], ['bundled', 'local', 'remote'])
  assert.ok(CONTENT_EXTENSION_POINTS.pack.fields.includes('usageDeclaration'), 'usageDeclaration is a required pack field')
  assert.ok(CONTENT_EXTENSION_POINTS.pack.optionalFields.includes('assets'), 'assets manifest is reserved')
  assert.ok(CONTENT_EXTENSION_POINTS.pack.optionalFields.includes('remoteCatalog'), 'remote catalog is reserved')
  for (const field of ['license', 'aiProvenance', 'compatibility']) {
    assert.ok(CONTENT_EXTENSION_POINTS.pack.optionalFields.includes(field), 'optional v3 compliance pack field: ' + field)
  }
  assert.equal(CONTENT_EXTENSION_POINTS.compliance.additive, true, 'compliance fields are additive (backward compatible)')
  for (const field of ['license', 'aiProvenance']) {
    assert.ok(CONTENT_EXTENSION_POINTS.entry.optionalFields.includes(field), 'optional v3 compliance entry field: ' + field)
  }
  assert.equal(CONTENT_EXTENSION_POINTS.pack.usageDeclaration.required, true)
  assert.equal(CONTENT_EXTENSION_POINTS.pack.usageDeclaration.researchOnly, true)
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.pack.usageDeclaration.prohibitedUses], [...PROHIBITED_USES], 'six prohibited uses')
  assert.equal(CONTENT_EXTENSION_POINTS.pack.assets.loaded, false, 'asset manifests are never loaded')
  assert.equal(CONTENT_EXTENSION_POINTS.pack.assets.supported, true)
  assert.equal(CONTENT_EXTENSION_POINTS.pack.remoteCatalog.status, 'reserved')
  assert.equal(CONTENT_EXTENSION_POINTS.pack.remoteCatalog.fetched, false)
  assert.equal(CONTENT_EXTENSION_POINTS.remoteCatalog.status, 'reserved', 'top-level remote catalog alias is reserved')
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.roleBundles], [...ROLE_BUNDLE_IDS], 'top-level role bundle ids are reserved')
  assert.ok(CONTENT_EXTENSION_POINTS.entry.permissions.includes('apply:role'), 'role permission')
  for (const permission of ['apply:theme', 'apply:background', 'apply:font']) assert.ok(CONTENT_EXTENSION_POINTS.entry.permissions.includes(permission), 'permission: ' + permission)
  for (const kind of CONTENT_EXTENSION_POINTS.entry.kinds) assert.ok(CONTENT_EXTENSION_POINTS.entry.schemas[kind].apply, kind + ': apply schema')
  assert.ok(CONTENT_EXTENSION_POINTS.entry.schemas.role.compatibility, 'role compatibility schema')
  const example = JSON.parse(JSON.stringify(CONTENT_PACK_EXAMPLE))
  assert.equal(validateContentPack(example).ok, true, 'example pack is schema-valid')
  assert.equal(validateContentPack(example, { requireCompliance: true }).ok, true, 'example pack also passes strict compliance validation')
  assert.ok(example.license && example.license.spdx, 'example declares a licence')
  assert.ok(example.aiProvenance && example.aiProvenance.disclosure, 'example declares AI provenance')
  assert.ok(example.compatibility && example.compatibility.minPluginVersion, 'example declares host compatibility')
  assert.equal(example.schemaVersion, 3)
  assert.equal(example.usageDeclaration.researchOnly, true)
  assert.deepEqual(example.usageDeclaration.prohibitedUses, [...USAGE_DECLARATION_TEMPLATE.prohibitedUses])
  const roleEntry = example.entries.find((entry) => entry.kind === 'role')
  assert.ok(roleEntry, 'example includes a role bundle entry')
  for (const component of ['character', 'voicePolicy', 'dialogue', 'theme', 'background', 'font']) assert.ok(roleEntry.apply[component], 'role bundle component: ' + component)
  assert.ok(roleEntry.compatibility && roleEntry.compatibility.minPluginVersion)
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.exports['./content-extension'], './content-extension.mjs', 'contract is a package export')
})


test('the v3 content contract publishes a single-version compatibility policy for hello', () => {
  assert.equal(CONTENT_EXTENSION_VERSION, 3, 'v3 stays the current contract revision')
  assert.equal(CONTENT_PACK_SCHEMA_VERSION, 3)
  assert.equal(CONTENT_EXTENSION_POINTS.version, CONTENT_EXTENSION_VERSION)
  assert.deepEqual(
    { ...CONTENT_EXTENSION_COMPATIBILITY },
    { current: 3, supportedPackSchemaVersions: [3], policy: 'additive-within-major', breakingChange: 'requires a documented major bump and a migration note' },
    'compatibility policy is explicit and frozen',
  )
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.compatibility.supportedPackSchemaVersions], [3])
  assert.equal(isContentExtensionCompatible(3), true)
  for (const value of [0, 2, 4, '3', 3.5, null, undefined, Number.NaN, [3], { version: 3 }]) {
    assert.equal(isContentExtensionCompatible(value), false, 'incompatible/unknown value rejected: ' + String(value))
  }
})

test('the host bridge exposes hello/probe wire 2 and keeps llm/schedule optional', () => {
  const hostSource = readFileSync(join(PLUGIN_ROOT, 'index.js'), 'utf8')
  assert.ok(hostSource.includes("export const inject = ['connection']"), 'only the connection service is required injection')
  assert.ok(hostSource.includes('const BRIDGE_WIRE_VERSION = 2'), 'bridge wire revision is explicit')
  for (const term of ["op === 'hello'", "op === 'probe'", 'contentExtension: CONTENT_EXTENSION_VERSION', 'capabilities:', 'degraded', 'hostIdentity', 'detectHost']) {
    assert.ok(hostSource.includes(term), 'host bridge wires: ' + term)
  }
  assert.ok(hostSource.includes("from './content-extension.mjs'"), 'the hello contract is sourced from content-extension.mjs (v3)')
  assert.ok(clientSource.includes('const BRIDGE_WIRE_VERSION = 2'), 'client speaks bridge wire 2')
  assert.ok(clientSource.includes("op: 'hello'"), 'client sends the hello handshake')
  assert.ok(clientSource.includes('contentExtension: 3'), 'client declares content-extension v3 in the handshake')
  assert.ok(clientSource.includes('setHost('), 'client stores the capability document')
  assert.ok(contentSource.includes('hostGroup'), 'settings exposes the Host capability section')
  assert.ok(contentSource.includes('noModelDetail') && contentSource.includes('noScheduleDetail'), 'input panel states capability degradation')
})

test('every v3 pack must declare research use and all six prohibited uses', () => {
  const clone = () => JSON.parse(JSON.stringify(CONTENT_PACK_EXAMPLE))
  const cases = []
  let pack = clone(); delete pack.usageDeclaration; cases.push(['missing declaration', pack])
  pack = clone(); pack.usageDeclaration.researchOnly = false; cases.push(['researchOnly false', pack])
  pack = clone(); pack.usageDeclaration.prohibitedUses = [...PROHIBITED_USES.slice(0, 5)]; cases.push(['missing prohibited use', pack])
  pack = clone(); pack.usageDeclaration.prohibitedUses = [...PROHIBITED_USES, 'extra-use']; cases.push(['unknown prohibited use', pack])
  pack = clone(); pack.usageDeclaration.prohibitedUses = [PROHIBITED_USES[0], ...PROHIBITED_USES.slice(0, 5)]; cases.push(['duplicate prohibited use', pack])
  pack = clone(); pack.usageDeclaration = { ...pack.usageDeclaration, license: 'x' }; cases.push(['unknown declaration field', pack])
  pack = clone(); pack.usageDeclaration.statement = 'x'; cases.push(['mutated canonical statement', pack])
  pack = clone(); pack.schemaVersion = 2; cases.push(['old schema version', pack])
  for (const [name, value] of cases) {
    const result = validateContentPack(value)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.length > 0, name + ': errors are reported')
  }
})

test('third-party content packs with scripts, traversal, unknown enums or oversized payloads are rejected', () => {
  const example = () => JSON.parse(JSON.stringify(CONTENT_PACK_EXAMPLE))
  const roleEntry = (pack) => pack.entries.find((entry) => entry.kind === 'role')
  const themeEntry = (pack) => pack.entries.find((entry) => entry.kind === 'theme')
  const cases = []
  let pack = example(); roleEntry(pack).apply.theme.variables['--dsh-famling-bubble-bg'] = () => '#fff'; cases.push(['function payload', pack])
  pack = example(); roleEntry(pack).apply.theme.variables['--dsh-famling-bubble-bg'] = new Date(); cases.push(['non-plain value', pack])
  pack = example(); roleEntry(pack).kind = 'script'; cases.push(['unknown kind', pack])
  pack = example(); roleEntry(pack).id = '../evil'; cases.push(['path-like id', pack])
  pack = example(); roleEntry(pack).preview = { kind: 'image', path: '../../secret.png' }; cases.push(['path traversal', pack])
  pack = example(); pack.source = 'remote'; cases.push(['remote source without opt-in', pack])
  pack = example(); themeEntry(pack).apply.variables = JSON.parse('{"__proto__": "#ffffff"}'); cases.push(['prototype key', pack])
  pack = example(); themeEntry(pack).apply.variables['--dsh-famling-bubble-bg'] = 'url(https://evil.example/x.png)'; cases.push(['unsafe CSS value', pack])
  pack = example(); roleEntry(pack).name = '<script>alert(1)</script>'; cases.push(['markup in text', pack])
  pack = example(); roleEntry(pack).permissions = ['apply:theme', 'admin:root']; cases.push(['unknown permission', pack])
  pack = example(); roleEntry(pack).onApply = 'alert(1)'; cases.push(['unknown field', pack])
  pack = example(); roleEntry(pack).source = 'bundled'; cases.push(['entry source mismatch', pack])
  pack = example(); pack.entries = Array.from({ length: 33 }, (_, index) => ({ ...themeEntry(example()), id: 'theme-' + index })); cases.push(['too many entries', pack])
  for (const [name, value] of cases) {
    const result = validateContentPack(value)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.length > 0, name + ': errors are reported')
  }
  const entryPack = (kind, permissions, preview, apply) => {
    const value = example()
    value.permissions = permissions
    value.entries = [{ ...themeEntry(value), kind, id: kind + '-entry', permissions, preview, apply }]
    return value
  }
  cases.length = 0
  cases.push(['background with url()', entryPack('background', ['apply:background'], { kind: 'color', value: '#ffffff' }, { kind: 'color', value: 'url(https://evil.example/bg.png)' })])
  cases.push(['unknown background kind', entryPack('background', ['apply:background'], { kind: 'color', value: '#ffffff' }, { kind: 'image', value: '#ffffff' })])
  cases.push(['font stack with quotes and declarations', entryPack('font', ['apply:font'], { kind: 'text', value: 'Aa' }, { family: "'Comic Sans'; background: url(x)" })])
  cases.push(['font stack with too many families', entryPack('font', ['apply:font'], { kind: 'text', value: 'Aa' }, { family: Array.from({ length: 9 }, () => 'serif').join(', ') })])
  cases.push(['font size out of range', entryPack('font', ['apply:font'], { kind: 'text', value: 'Aa' }, { family: 'Georgia, serif', size: 99 })])
  cases.push(['font line height out of range', entryPack('font', ['apply:font'], { kind: 'text', value: 'Aa' }, { family: 'Georgia, serif', lineHeight: 0.5 })])
  cases.push(['font with unknown apply field', entryPack('font', ['apply:font'], { kind: 'text', value: 'Aa' }, { family: 'serif', weight: 700 })])
  for (const [name, value] of cases) {
    const result = validateContentPack(value)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.length > 0, name + ': errors are reported')
  }
  assert.equal(validateContentPack(entryPack('background', ['apply:background'], { kind: 'color', value: '#ffffff' }, { kind: 'transparent' })).ok, true, 'plain transparent background pack is valid')
  assert.equal(validateContentPack(entryPack('background', ['apply:background'], { kind: 'color', value: '#ffffff' }, { kind: 'color', value: 'rgb(20, 22, 26)' })).ok, true, 'safe color background pack is valid')
  assert.equal(validateContentPack(entryPack('font', ['apply:font'], { kind: 'text', value: 'Aa' }, { family: 'Georgia, serif', size: 14, lineHeight: 1.6 })).ok, true, 'local font stack pack is valid')
  const allowedRemote = example()
  allowedRemote.source = 'remote'
  for (const entry of allowedRemote.entries) entry.source = 'remote'
  assert.equal(validateContentPack(allowedRemote, { allowRemote: true }).ok, true, 'remote stays reserved but schema-valid behind an explicit future opt-in')
  const oversized = example()
  const key = '--dsh-famling-' + 'a'.repeat(28)
  const value = 'rgb(' + '1,'.repeat(23) + '1)'
  const variables = {}
  for (let index = 0; index < 24; index += 1) variables[key + index] = value
  oversized.entries = Array.from({ length: 32 }, (_, index) => ({ ...themeEntry(example()), id: 'big-' + index, apply: { variables } }))
  const oversizedResult = validateContentPack(oversized)
  assert.equal(oversizedResult.ok, false, 'oversized pack is rejected')
  assert.ok(oversizedResult.errors.some((error) => /JSON size|exceeds/.test(error)), 'size limit error is reported: ' + oversizedResult.errors.join('; '))
})

test('v3 role bundles, asset manifests and remote catalog are pure metadata and malformed values are rejected', () => {
  const clone = () => JSON.parse(JSON.stringify(CONTENT_PACK_EXAMPLE))
  const roleEntry = (pack) => pack.entries.find((entry) => entry.kind === 'role')
  const withAssets = () => {
    const pack = clone()
    pack.assets = { format: 'zip', files: [{ path: 'art/human/idle-0.png', sha256: 'a'.repeat(64), bytes: 1024 }], totalBytes: 1024 }
    return pack
  }
  assert.equal(validateContentPack(withAssets()).ok, true, 'valid asset manifest metadata is accepted (and never loaded)')
  const withCatalog = () => {
    const pack = clone()
    pack.remoteCatalog = { status: 'reserved', url: 'https://catalog.example/packs.json' }
    return pack
  }
  assert.equal(validateContentPack(withCatalog()).ok, true, 'valid reserved remote catalog metadata is accepted (and never fetched)')
  const cases = []
  let pack = withAssets(); pack.assets.format = 'rar'; cases.push(['unknown asset format', pack])
  pack = withAssets(); pack.assets.files[0].path = '../../evil.png'; cases.push(['asset path traversal', pack])
  pack = withAssets(); pack.assets.files[0].sha256 = 'abc'; cases.push(['bad asset hash', pack])
  pack = withAssets(); pack.assets.files = Array.from({ length: 33 }, (_, index) => ({ path: 'art/' + index + '.png', sha256: 'a'.repeat(64) })); cases.push(['too many asset files', pack])
  pack = withAssets(); pack.assets.files.push({ ...pack.assets.files[0] }); cases.push(['duplicate asset path', pack])
  pack = withAssets(); pack.assets.totalBytes = 1; cases.push(['asset total bytes too small', pack])
  pack = withCatalog(); pack.remoteCatalog.url = 'http://catalog.example/packs.json'; cases.push(['non-https catalog', pack])
  pack = withCatalog(); pack.remoteCatalog.status = 'active'; cases.push(['non-reserved catalog status', pack])
  pack = clone(); roleEntry(pack).compatibility = { minPluginVersion: '0.10.0', maxPluginVersion: '0.9.0' }; cases.push(['role compatibility range inverted', pack])
  pack = clone(); delete roleEntry(pack).apply.font; cases.push(['role missing font component', pack])
  pack = clone(); roleEntry(pack).apply.voicePolicy = { canTts: true, mode: 'thought' }; cases.push(['role voice policy mismatch', pack])
  pack = clone(); delete roleEntry(pack).compatibility; cases.push(['role missing compatibility', pack])
  pack = clone(); roleEntry(pack).compatibility = { minPluginVersion: 'latest' }; cases.push(['role bad compatibility version', pack])
  pack = clone(); roleEntry(pack).permissions = ['apply:theme']; cases.push(['role missing apply:role permission', pack])
  pack = clone(); roleEntry(pack).usageDeclaration = { researchOnly: false, prohibitedUses: [...PROHIBITED_USES] }; cases.push(['invalid per-role declaration restatement', pack])
  for (const [name, value] of cases) {
    const result = validateContentPack(value)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.length > 0, name + ': errors are reported')
  }
  assert.equal(validateContentPack(clone()).ok, true, 'valid six-component role bundle is accepted')
})

/* ---------- MB-020/021/022/023/024: plugin safety floor (E3-T1/T2/T3) ---------- */
test('the host bridge ships a local crisis short-circuit with 12356/110/120 and no model call', async () => {
  const host = await import('../index.js')
  assert.equal(typeof host.crisisKeyword, 'function', 'crisisKeyword is exported for tests/audit')
  assert.ok(Array.isArray(host.CRISIS_KEYWORDS) && host.CRISIS_KEYWORDS.length >= 30, 'readable keyword list')
  const source = readFileSync(join(PLUGIN_ROOT, 'index.js'), 'utf8')
  for (const term of ['12356', '110', '120', '不是诊断', 'not a diagnosis']) assert.ok(source.includes(term), 'host crisis reply carries: ' + term)
  assert.ok(source.includes("safety: 'crisis-local-resource'"), 'crisis route is identifiable in the bridge response')
  assert.ok(source.includes('llmCalls: 0'), 'crisis route reports zero model calls')
  assert.ok(source.indexOf('crisisKeyword(input)') < source.indexOf('await chatWithDsh(host, input'), 'the local crisis check runs before any model call')
})

test('the chat surfaces disclose the DSH-configured model provider in both languages', () => {
  for (const term of ['模型供应商', '勿发', '密码', '隐私', '客户资料']) assert.ok(clientSource.includes(term), 'client.js zh disclosure: ' + term)
  for (const term of ['model provider', 'never send passwords', 'private data', 'client material']) assert.ok(clientSource.includes(term), 'client.js en disclosure: ' + term)
  assert.ok(clientSource.includes('AI 聊天'), 'client.js wires the AI chat switch state')
  assert.ok(clientSource.includes('settings.chat === false'), 'chat requests are gated by the switch')
  assert.ok(contentSource.includes('dataGroup'), 'settings has a data/boundaries section')
  assert.ok(contentSource.includes('AI 聊天'), 'settings exposes the AI chat switch')
  assert.ok(contentSource.includes('onClearLocalData'), 'settings exposes clear-local-data')
  assert.ok(contentSource.includes('createFirstRunNotice'), 'the first-run card comes from the lazy chunk (entry budget)')
  assert.ok(clientSource.includes('FIRST_RUN_KEY'), 'the one-time first-run flag is a local key')
  // 0.11.2 worktree: the two one-shot first-run actions keep their copy and
  // their task/bridge orchestration inside the lazy chunk; the entry only
  // injects state/bridge/chat callbacks and stays inside its byte gates.
  for (const key of ['firstRunRemindText', 'firstRunChatQuestion', 'firstRunNoSchedule', 'firstRunRemindFailed']) {
    assert.ok(contentSource.includes(key), 'the first-run action copy lives in the lazy chunk: ' + key)
  }
  assert.equal(clientSource.includes('10 分钟后提醒我休息一下'), false, 'the first-run action label does not charge the entry budget')
  assert.ok(clientSource.includes('onBridge: callBridge') && clientSource.includes('onQuickState: setFirstRunAction'), 'the entry injects the existing bridge and the transient action state into the lazy card')
  assert.ok(clientSource.includes('onQuickChat: quickChat'), 'the entry injects the existing chat-panel opener')
  assert.ok(contentSource.includes("op: 'task', text: T.firstRunRemindText"), 'the task payload is built in the lazy chunk')
  for (const [name, source] of [['client.js', clientSource], ['client.content.js', contentSource]]) {
    assert.equal(/dsh-famling\/first-run\/v[2-9]/.test(source), false, name + ': quick actions reuse the existing v1 first-run flag and add no new storage key')
  }
  assert.equal(/https?:\/\//.test(contentSource), false, 'the content chunk stays offline')
})

/* ==================== "一起工作" focus mode (0.12.0 working tree / task-B1) ==================== */
// 0.13.3 released entry baseline: 0.12.0 focus baseline (95,533) + the
// 2,025 B bubble-priority/work-state feature folded in at this release. The
// focus/feature wiring may still add at most 200 B on top of this baseline.
const FOCUS_ENTRY_BASELINE_BYTES = 97_558

test('"一起工作" focus mode lives in the lazy chunks; the entry stays within the released 200 B budget', () => {
  const entryBytes = Buffer.byteLength(clientSource)
  const focusDelta = entryBytes - FOCUS_ENTRY_BASELINE_BYTES
  assert.ok(focusDelta >= 0 && focusDelta <= 200, 'focus wiring adds ' + focusDelta + ' B (<= 200 B) to the entry')
  assert.ok(entryBytes <= FIRST_SCREEN_BUDGET_BYTES, 'entry stays within the 96 KiB budget')
  assert.ok(entryBytes < AUDIT_BASELINE_BYTES * 0.31, 'entry stays within the 31% gate')
  // Entry owns no focus UI/copy/markup: one badge hook, one prompt sink, two quiet gates.
  assert.ok(clientSource.includes('panelChunk?.createFocusStatus?.(L.lang)'), 'the remaining badge is rendered by the lazy chunk')
  assert.ok(clientSource.includes("onFocusMsg: (text) => say(text, 'speech', 'direct')"), 'the entry lends only a one-time bubble prompt')
  assert.equal((clientSource.match(/window\.__famlingFocus\?\.until > Date\.now\(\)/g) || []).length, 2, 'ambient bubbles + micro actions are the only two focus gates')
  assert.equal(clientSource.includes('25 分钟'), false, 'the 25/50 copy stays in the lazy chunk')
  assert.equal(clientSource.includes('结束专注'), false, 'the focus controls stay in the lazy chunk')
  assert.equal(clientSource.includes("'dsh-famling/focus"), false, 'no new storage key')
  assert.equal(/localStorage[^\n]*focus/i.test(clientSource), false, 'the entry never persists focus state')
  assert.equal(clientSource.includes('Notification'), false, 'no system-notification API in the entry')
  assert.equal(contentSource.includes('Notification'), false, 'no system-notification API in the lazy chunk')
  // The lazy chunk owns the session: one in-memory deadline + one timer.
  const begin = contentSource.indexOf('// <dsh-famling:focus:begin>')
  const end = contentSource.indexOf('// <dsh-famling:focus:end>')
  assert.ok(begin >= 0 && end > begin, 'the focus session block is marked')
  const block = contentSource.slice(begin, end)
  assert.ok(block.includes('const FOCUS_MINUTES = [25, 50]'), 'only 25/50-minute sessions')
  assert.ok(block.includes("const FOCUS_STORE_KEY = '__famlingFocus'"), 'the session state is one window memory store')
  assert.equal(/localStorage|sessionStorage|indexedDB/.test(block), false, 'the focus session never persists')
  assert.equal(/Notification\b/.test(block), false, 'the focus session never raises a system notification')
  assert.ok(block.includes('setTimeout(() => endFocus('), 'the deadline is one local timeout, nothing else')
  assert.ok(contentSource.includes('function createFocusStatus('), 'the chunk exports the lightweight badge factory')
  assert.match(contentSource, /createContentCenter, createSettingsPanel, createFocusStatus,/, 'the entry requests the badge factory from the same chunk')
  for (const key of ['focusGroup:', 'focusHint:', 'focusStart25:', 'focusStart50:', 'focusEnd:', 'focusStatus:', 'focusIdle:', 'focusBadge:', 'focusDone:', 'focusDoneEarly:', 'focusMemoryOnly:']) assert.ok(contentSource.includes(key), 'focus i18n key: ' + key)
  // The picker reuses the existing unified settings panel instead of a new permanent UI.
  assert.ok(contentSource.includes('focusSection = section(T, T.focusGroup'), 'focus controls are an existing settings section')
  assert.ok(contentSource.includes('lowDisturb, focusSection, data'), 'focus sits with the low-disturb settings')
})
