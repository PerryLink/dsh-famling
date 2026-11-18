import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { CHARACTERS, PLUGIN_ROOT, decodePng, loadRegionConfig, resolveAssetsRoot, resolveCharactersRoot } from '../scripts/embed-anims.mjs'
import { loadClientData, verifyClient } from '../scripts/verify-anims.mjs'

const clientPath = join(PLUGIN_ROOT, 'client.js')
const clientSource = readFileSync(clientPath, 'utf8')
const clientData = loadClientData(clientSource)

test('generated block embeds human/cat/dog with 12 clips and 68 frames each', () => {
  for (const kind of CHARACTERS) {
    const anim = clientData.ANIMS[kind]
    assert.ok(anim, kind + ': ANIMS entry is present')
    assert.equal(Object.keys(anim.clips).length, 12, kind + ': 12 clips')
    const frames = Object.values(anim.clips).reduce((sum, clip) => sum + clip.frames.length, 0)
    assert.equal(frames, 68, kind + ': 68 frames')
  }
  assert.equal(Object.keys(clientData.SPRITES).length, 204, '204 unique sprite keys')
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

test('embedded tap regions follow the famling hero regions contract', () => {
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
    }
  }
})

test('embedded regions match the private character regions.json when present', (t) => {
  const charactersRoot = resolveCharactersRoot(null)
  if (!charactersRoot) {
    t.skip('private character regions are not available in this checkout')
    return
  }
  for (const kind of CHARACTERS) {
    assert.deepEqual(clientData.ANIMS[kind].regions, loadRegionConfig(charactersRoot, kind), kind + ': embedded regions equal the source document')
  }
})

test('client code hit-tests regions at the rendered size and only reacts while idle', () => {
  assert.ok(clientSource.includes('function onPetClick(event)'), 'pet click handler receives the DOM event')
  assert.ok(clientSource.includes("const REGION_EVENT_CLIPS = { pat: 'pat_head', stand_wag: 'stand_wag', chase_tail: 'chase_tail' }"), 'region events map to animation clips')
  assert.ok(clientSource.includes('function clickArtPoint(event, config)'), 'rendered-size -> 96px art mapping helper exists')
  assert.ok(clientSource.includes('function regionAt(config, artX, artY)'), 'region hit-test helper exists')
  assert.ok(clientSource.includes("anim === 'idle' ? (blink ? 'idle_blink' : 'idle') : anim"), 'state gating accepts idle and idle_blink only')
  assert.ok(!clientSource.includes('playMicroAction(true)'), 'pet clicks no longer fall back to a random micro action')
})

test('action mapping only uses clips that exist and exposes pat_head/ball_throw/ball_chase', () => {
  for (const kind of CHARACTERS) {
    const rows = clientData.ACTION_SETS[kind]
    assert.ok(Array.isArray(rows) && rows.length > 0, kind + ': action rows')
    const clips = new Set(rows.map((row) => row[0]))
    for (const [clipId] of rows) assert.ok(clientData.ANIMS[kind].clips[clipId], kind + ': action clip exists: ' + clipId)
    for (const required of ['pat_head', 'ball_throw', 'ball_chase']) assert.ok(clips.has(required), kind + ': exposes ' + required)
    for (const clipId of clientData.ANIMS[kind].microActions) {
      assert.ok(clientData.ANIMS[kind].clips[clipId], kind + ': micro clip exists: ' + clipId)
      assert.ok(clientData.MICRO_LINES[kind][clipId], kind + ': micro bubble line: ' + clipId)
    }
  }
})

test('client code enforces the TTS policy guard and persists the character', () => {
  assert.ok(clientSource.includes('canTts && settings.sound && ttsConsent'), 'TTS guard tied to character policy')
  assert.ok(clientSource.includes('localStorage.setItem(CHARACTER_KEY, character)'), 'character persisted')
  assert.ok(clientSource.includes("'dsh-famling/character'"), 'character storage key')
  assert.ok(clientSource.includes('window.speechSynthesis.cancel()'), 'silent characters cancel running speech')
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

test('package version is 0.8.2 and the host bridge entrypoint is still exported', async () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.version, '0.8.2')
  const module = await import('../index.js')
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.name, 'dsh-famling')
})

