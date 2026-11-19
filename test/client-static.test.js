import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { CHARACTERS, CHUNK_NAMES, PLUGIN_ROOT, chunkPath, decodePng, loadRegionConfig, resolveAssetsRoot, resolveCharactersRoot } from '../scripts/embed-anims.mjs'
import { FIRST_SCREEN_BUDGET_BYTES, loadChunkModule, loadClientData, verifyClient } from '../scripts/verify-anims.mjs'
import { AUDIT_BASELINE_BYTES } from '../scripts/measure-bundle.mjs'
import { CONTENT_EXTENSION_POINTS, CONTENT_PACK_EXAMPLE, validateContentPack } from '../content-extension.mjs'

const clientPath = join(PLUGIN_ROOT, 'client.js')
const clientSource = readFileSync(clientPath, 'utf8')
const clientData = loadClientData(clientSource)

// Frame counts come from the private manifests: dog/human 68 each, cat 72
// (10-frame stand_wag). Total 208 embedded frames; never assume 12x68/204.
const EXPECTED_FRAME_COUNTS = { human: 68, cat: 72, dog: 68 }

test('generated block embeds human/cat/dog with 12 clips and manifest frame counts (68/72/68 = 208)', () => {
  const total = { frames: 0 }
  for (const kind of CHARACTERS) {
    const anim = clientData.ANIMS[kind]
    assert.ok(anim, kind + ': ANIMS entry is present')
    assert.equal(Object.keys(anim.clips).length, 12, kind + ': 12 clips')
    const frames = Object.values(anim.clips).reduce((sum, clip) => sum + clip.frames.length, 0)
    assert.equal(frames, EXPECTED_FRAME_COUNTS[kind], kind + ': manifest frame count')
    total.frames += frames
  }
  assert.equal(total.frames, 208, '208 embedded frames in total')
  assert.equal(Object.keys(clientData.SPRITES).length, 208, '208 unique sprite keys')
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

test('embedded regions and actions match the private character regions.json when present', (t) => {
  const charactersRoot = resolveCharactersRoot(null)
  if (!charactersRoot) {
    t.skip('private character regions are not available in this checkout')
    return
  }
  for (const kind of CHARACTERS) {
    const source = loadRegionConfig(charactersRoot, kind)
    assert.deepEqual(clientData.ANIMS[kind].regions, source, kind + ': embedded regions equal the source document')
    assert.deepEqual(clientData.ANIMS[kind].actions, source.actions, kind + ': embedded actions equal the source document')
  }
})

test('client code hit-tests regions at the rendered size, only reacts while idle and picks random says', () => {
  assert.ok(clientSource.includes('function onPetClick(event)'), 'pet click handler receives the DOM event')
  assert.ok(clientSource.includes('function clickArtPoint(event, config)'), 'rendered-size -> 96px art mapping helper exists')
  assert.ok(clientSource.includes('function regionAt(config, artX, artY)'), 'region hit-test helper exists')
  assert.ok(clientSource.includes("anim === 'idle' ? (blink ? 'idle_blink' : 'idle') : anim"), 'state gating accepts idle and idle_blink only')
  assert.ok(clientSource.includes('function pickSaidLine(pool, key, previous)'), 'random bubble-line picker exists')
  assert.ok(clientSource.includes('pickSaidLine(reaction.says'), 'region taps pick a random line from the region says')
  assert.ok(clientSource.includes('pickSaidLine(action.says'), 'menu actions pick a random line from the action says')
  assert.ok(!clientSource.includes('playMicroAction(true)'), 'pet clicks no longer fall back to a random micro action')
  assert.ok(!clientSource.includes('ACTION_SETS'), 'obsolete hand-written per-character action rows are gone')
})

test('the interaction menu renders the embedded current-character actions', () => {
  assert.ok(clientSource.includes('ANIMS[character]?.actions'), 'action panel reads ANIMS[character].actions')
  assert.ok(clientSource.includes('action.followUpEvent'), 'action buttons schedule follow-up events')
  assert.ok(clientSource.includes('const EVENT_CLIPS = {'), 'hand-written event -> clip table exists')
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

test('chat payload carries the active character with a human fallback', () => {
  assert.ok(clientSource.includes('function chatCharacter(value)'), 'character normalization helper exists')
  assert.ok(clientSource.includes("return CHARACTER_IDS.includes(value) ? value : 'human'"), 'unknown/missing character falls back to human')
  assert.ok(clientSource.includes("op: 'chat', text, character: chatCharacter(characterRef.current)"), 'chat request carries the live character')
})

test('embedded animation data is current against the private asset pack when present', (t) => {
  const assetsRoot = resolveAssetsRoot(null)
  if (!assetsRoot) {
    t.skip('private animation assets are not available in this checkout')
    return
  }
  const result = verifyClient({ assetsRoot })
  assert.equal(result.ok, true, result.errors.join('; '))
})

test('first-screen client.js carries no sprite payload and meets the lazy budget', () => {
  const entryBytes = Buffer.byteLength(clientSource)
  const humanBytes = Buffer.byteLength(readFileSync(chunkPath(PLUGIN_ROOT, 'human'), 'utf8'))
  assert.ok(entryBytes <= FIRST_SCREEN_BUDGET_BYTES, 'client.js ' + entryBytes + ' B is within the ' + FIRST_SCREEN_BUDGET_BYTES + ' B budget')
  assert.ok(entryBytes < AUDIT_BASELINE_BYTES * 0.25, 'entry shrinks >75% vs the pre-split audit snapshot')
  assert.ok(entryBytes + humanBytes < AUDIT_BASELINE_BYTES * 0.5, 'first paint (entry + default chunk) shrinks >50% vs the pre-split audit snapshot')
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

test('cat label is the Selkirk Rex (curly grey-white) instead of Ragdoll', () => {
  assert.ok(clientSource.includes("cat: '塞尔凯克卷毛猫'"), 'zh client label')
  assert.ok(clientSource.includes("cat: 'Selkirk Rex'"), 'en client label')
  assert.equal(clientSource.includes('布偶猫'), false, 'client source has no stale Ragdoll label')
  for (const file of ['README.md', 'docs/DETAIL.md', 'locale/zh.json', 'locale/en.json']) {
    const text = readFileSync(join(PLUGIN_ROOT, file), 'utf8')
    assert.equal(text.includes('布偶猫'), false, file + ': no stale Ragdoll label')
    assert.equal(text.includes('Ragdoll'), false, file + ': no stale Ragdoll label')
  }
  const zh = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'locale/zh.json'), 'utf8'))
  assert.match(zh.meta.title, /塞尔凯克卷毛猫/)
})

test('package version is 0.9.1, publishes the lazy chunks, content contract and leaves the stage-one boot barrier', async () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.version, '0.9.1')
  assert.equal(pkg.exports['./content-extension'], './content-extension.mjs', 'package exports the content extension contract')
  assert.ok(pkg.files.includes('content-extension.mjs'), 'package publishes the content extension contract')
  for (const kind of CHARACTERS) assert.ok(pkg.files.includes(CHUNK_NAMES[kind]), 'package files publishes ' + CHUNK_NAMES[kind])
  assert.equal(pkg.dsh.client.immediately, false, 'footer pet is not a stage-one registration barrier')
  assert.equal(pkg.scripts['measure:bundle'], 'node scripts/measure-bundle.mjs')
  const module = await import('../index.js')
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.name, 'dsh-famling')
})

test('client.js wires the 4th content button, the content-center panel and one settings entry', () => {
  assert.ok(clientSource.includes("content: '内容'"), 'zh sidebar label for the content button')
  assert.ok(clientSource.includes("content: 'Content'"), 'en sidebar label for the content button')
  assert.ok(clientSource.includes("contentTitle: '内容中心'"), 'zh content-center title')
  assert.ok(clientSource.includes("contentEntry: '内容与角色…'"), 'single settings entry row')
  assert.ok(clientSource.includes("contentTabs: { characters: '角色', voices: '声音', dialogue: '对话', themes: '主题', backgrounds: '背景', fonts: '字体' }"), 'six category tabs')
  assert.ok(clientSource.includes("onClick: () => openPanel('content')"), 'the settings row and the 4th button open the content center')
  assert.equal(clientSource.includes("key: 'character', style: { marginBottom: 7 }"), false, 'settings no longer contains the scattered character block')
  assert.equal(clientSource.includes("key: 'tts-note'"), false, 'the voice hint moved out of settings into the content center')
  assert.ok(clientSource.includes('const contentCards = {') && clientSource.includes('contentCards[contentTab]'), 'category bodies are rendered from the content catalog')
  assert.ok(clientSource.includes('characters: CHARACTER_IDS.map') && clientSource.includes('dialogue: DIALOGUE_MODE_IDS.map') && clientSource.includes('themes: THEME_IDS.map') && clientSource.includes('backgrounds: BACKGROUND_IDS.map') && clientSource.includes('fonts: [') && clientSource.includes('FONT_IDS.map'), 'all six categories build their cards from the catalog ids')
  assert.ok(clientSource.includes("'aria-pressed': active"), 'selectable cards expose their current state')
  assert.equal(/location\.(?:reload|href|assign|replace)\s*[=(]/.test(clientSource), false, 'content switches never reload or navigate')
  assert.equal(clientSource.includes('.innerHTML ='), false, 'no innerHTML injection')
  assert.equal(/\beval\s*\(|new Function\s*\(/.test(clientSource), false, 'no eval/Function in the client')
})

test('content center persists dialogue/theme/background/font choices and only the human gets browser voices', () => {
  assert.ok(clientSource.includes("const DIALOGUE_KEY = 'dsh-famling/dialogue'"), 'dialogue storage key')
  assert.ok(clientSource.includes('localStorage.setItem(DIALOGUE_KEY, dialogueMode)'), 'dialogue mode persisted')
  assert.ok(clientSource.includes("const THEME_KEY = 'dsh-famling/theme'"), 'theme storage key')
  assert.ok(clientSource.includes('localStorage.setItem(THEME_KEY, themeId)'), 'theme persisted')
  assert.ok(clientSource.includes('function availableVoices()'), 'browser voice lister exists')
  assert.ok(clientSource.includes('getVoices()'), 'speechSynthesis.getVoices() is used')
  assert.ok(clientSource.includes("canTts ? h('label', { key: 'sound'"), 'TTS toggle only renders when the character can speak')
  assert.ok(clientSource.includes('L.voiceSilent'), 'cat/dog show the silent thought-bubble policy')
  assert.ok(clientSource.includes('maxChars: 90') && clientSource.includes('bubbleChance: 0.35'), 'brief/quiet modes have bounded, documented effects')
  assert.ok(clientSource.includes("source !== 'direct' && dialogue.bubbleChance < 1"), 'quiet mode lowers ambient bubble probability')
  assert.ok(clientSource.includes("line.slice(0, dialogue.maxChars - 1)"), 'brief mode filters over-long replies')
  assert.ok(clientSource.includes('utterance.voice = voice'), 'the selected browser voice is applied to speech')
  assert.ok(clientSource.includes("const BACKGROUND_KEY = 'dsh-famling/background'") && clientSource.includes('localStorage.setItem(BACKGROUND_KEY, backgroundId)'), 'background persisted')
  assert.ok(clientSource.includes("const FONT_KEY = 'dsh-famling/font'") && clientSource.includes('localStorage.setItem(FONT_KEY, JSON.stringify(fontChoice))'), 'font choice persisted as bounded JSON')
  assert.ok(clientSource.includes('var(--dsh-famling-widget-bg, transparent)') && clientSource.includes('var(--dsh-famling-font-family, inherit)'), 'background/font applied through widget CSS variables')
  assert.ok(clientSource.includes('FONT_SIZES = [11, 12, 14]') && clientSource.includes('FONT_LINE_HEIGHTS = [1.4, 1.5, 1.8]'), 'font size/line height presets are bounded')
  assert.ok(clientSource.includes('fonts.googleapis') === false && clientSource.includes('@import') === false, 'no web fonts or CSS imports')
})

test('content extension points publish the reserved pure-data pack contract', () => {
  assert.equal(CONTENT_EXTENSION_POINTS.version, 2)
  assert.equal(CONTENT_EXTENSION_POINTS.status, 'reserved')
  assert.deepEqual({ ...CONTENT_EXTENSION_POINTS.transport }, { network: false, execute: false, innerHTML: false, worker: false })
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.entry.kinds], ['character', 'voice', 'dialogue', 'theme', 'background', 'font'])
  for (const field of ['kind', 'id', 'name', 'preview', 'apply', 'source', 'permissions', 'version']) assert.ok(CONTENT_EXTENSION_POINTS.entry.fields.includes(field), 'entry field: ' + field)
  assert.deepEqual([...CONTENT_EXTENSION_POINTS.pack.sources], ['bundled', 'local', 'remote'])
  assert.ok(Number.isFinite(CONTENT_EXTENSION_POINTS.pack.limits.maxBytes) && CONTENT_EXTENSION_POINTS.pack.limits.maxBytes > 0)
  assert.ok(Array.isArray(CONTENT_EXTENSION_POINTS.entry.permissions) && CONTENT_EXTENSION_POINTS.entry.permissions.includes('apply:theme'))
  for (const permission of ['apply:background', 'apply:font']) assert.ok(CONTENT_EXTENSION_POINTS.entry.permissions.includes(permission), 'new permission: ' + permission)
  assert.equal(CONTENT_EXTENSION_POINTS.pack.schemaVersion, 2, 'pack schema version 2 adds background/font kinds')
  for (const kind of CONTENT_EXTENSION_POINTS.entry.kinds) assert.ok(CONTENT_EXTENSION_POINTS.entry.schemas[kind].apply, kind + ': apply schema')
  assert.equal(validateContentPack(JSON.parse(JSON.stringify(CONTENT_PACK_EXAMPLE))).ok, true, 'example pack is schema-valid')
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.exports['./content-extension'], './content-extension.mjs', 'contract is a package export')
})

test('third-party content packs with scripts, traversal, unknown enums or oversized payloads are rejected', () => {
  const example = () => JSON.parse(JSON.stringify(CONTENT_PACK_EXAMPLE))
  const cases = []
  const withFunction = example()
  withFunction.entries[0].apply.variables['--dsh-famling-bubble-bg'] = () => '#fff'
  cases.push(['function payload', withFunction])
  const withDate = example()
  withDate.entries[0].apply.variables['--dsh-famling-bubble-bg'] = new Date()
  cases.push(['non-plain value', withDate])
  const unknownKind = example()
  unknownKind.entries[0].kind = 'script'
  cases.push(['unknown kind', unknownKind])
  const pathLikeId = example()
  pathLikeId.entries[0].id = '../evil'
  cases.push(['path-like id', pathLikeId])
  const traversal = example()
  traversal.entries[0].preview = { kind: 'image', path: '../../secret.png' }
  cases.push(['path traversal', traversal])
  const remote = example()
  remote.source = 'remote'
  cases.push(['remote source without opt-in', remote])
  const prototype = example()
  prototype.entries[0].apply.variables = JSON.parse('{"__proto__": "#ffffff"}')
  cases.push(['prototype key', prototype])
  const unsafeCss = example()
  unsafeCss.entries[0].apply.variables['--dsh-famling-bubble-bg'] = 'url(https://evil.example/x.png)'
  cases.push(['unsafe CSS value', unsafeCss])
  const markup = example()
  markup.entries[0].name = '<script>alert(1)</script>'
  cases.push(['markup in text', markup])
  const unknownPermission = example()
  unknownPermission.entries[0].permissions = ['apply:theme', 'admin:root']
  cases.push(['unknown permission', unknownPermission])
  const unknownField = example()
  unknownField.entries[0].onApply = 'alert(1)'
  cases.push(['unknown field', unknownField])
  const wrongSource = example()
  wrongSource.entries[0].source = 'bundled'
  cases.push(['entry source mismatch', wrongSource])
  const tooMany = example()
  tooMany.entries = Array.from({ length: 33 }, (_, index) => ({ ...example().entries[0], id: 'theme-' + index }))
  cases.push(['too many entries', tooMany])
  for (const [name, pack] of cases) {
    const result = validateContentPack(pack)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.length > 0, name + ': errors are reported')
  }
  const backgroundPack = (apply) => {
    const pack = example()
    pack.permissions = ['apply:background']
    pack.entries = [{ ...example().entries[0], kind: 'background', permissions: ['apply:background'], preview: { kind: 'color', value: '#ffffff' }, apply }]
    return pack
  }
  const fontPack = (apply) => {
    const pack = example()
    pack.permissions = ['apply:font']
    pack.entries = [{ ...example().entries[0], kind: 'font', permissions: ['apply:font'], preview: { kind: 'text', value: 'Aa' }, apply }]
    return pack
  }
  cases.push(['background with url()', backgroundPack({ kind: 'color', value: 'url(https://evil.example/bg.png)' })])
  cases.push(['unknown background kind', backgroundPack({ kind: 'image', value: '#ffffff' })])
  cases.push(['font stack with quotes and declarations', fontPack({ family: "'Comic Sans'; background: url(x)" })])
  cases.push(['font stack with too many families', fontPack({ family: Array.from({ length: 9 }, () => 'serif').join(', ') })])
  cases.push(['font size out of range', fontPack({ family: 'Georgia, serif', size: 99 })])
  cases.push(['font line height out of range', fontPack({ family: 'Georgia, serif', lineHeight: 0.5 })])
  cases.push(['font with unknown apply field', fontPack({ family: 'serif', weight: 700 })])
  for (const [name, pack] of cases) {
    const result = validateContentPack(pack)
    assert.equal(result.ok, false, name + ' must be rejected')
    assert.ok(result.errors.length > 0, name + ': errors are reported')
  }
  assert.equal(validateContentPack(backgroundPack({ kind: 'transparent' })).ok, true, 'plain transparent background pack is valid')
  assert.equal(validateContentPack(backgroundPack({ kind: 'color', value: 'rgb(20, 22, 26)' })).ok, true, 'safe color background pack is valid')
  assert.equal(validateContentPack(fontPack({ family: 'Georgia, serif', size: 14, lineHeight: 1.6 })).ok, true, 'local font stack pack is valid')
  const allowedRemote = example()
  allowedRemote.source = 'remote'
  allowedRemote.entries[0].source = 'remote'
  assert.equal(validateContentPack(allowedRemote, { allowRemote: true }).ok, true, 'remote stays reserved but schema-valid behind an explicit future opt-in')
  const oversized = example()
  const key = '--dsh-famling-' + 'a'.repeat(28)
  const value = 'rgb(' + '1,'.repeat(23) + '1)'
  const variables = {}
  for (let index = 0; index < 24; index += 1) variables[key + index] = value
  oversized.entries = Array.from({ length: 32 }, (_, index) => ({ ...example().entries[0], id: 'big-' + index, apply: { variables } }))
  const oversizedResult = validateContentPack(oversized)
  assert.equal(oversizedResult.ok, false, 'oversized pack is rejected')
  assert.ok(oversizedResult.errors.some((error) => /JSON size|exceeds/.test(error)), 'size limit error is reported: ' + oversizedResult.errors.join('; '))
})
