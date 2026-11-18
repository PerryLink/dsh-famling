import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { CHARACTERS, PLUGIN_ROOT, decodePng, loadRegionConfig, resolveAssetsRoot, resolveCharactersRoot } from '../scripts/embed-anims.mjs'
import { loadClientData, verifyClient } from '../scripts/verify-anims.mjs'

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
  assert.ok(clientSource.includes("background: '#ffffff', color: '#111111'"), 'bubble keeps the white background and dark text')
  assert.ok(clientSource.includes('1.5px dashed #8f8f8f') && clientSource.includes('1px solid #9a9a9a'), 'bubble keeps the grey dashed/solid borders')
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

test('package version is 0.8.4 and the host bridge entrypoint is still exported', async () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.version, '0.8.4')
  const module = await import('../index.js')
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.name, 'dsh-famling')
})
