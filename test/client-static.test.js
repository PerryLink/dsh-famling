import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { CHARACTERS, PLUGIN_ROOT, decodePng, resolveAssetsRoot } from '../scripts/embed-anims.mjs'
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

test('embedded animation data is current against the private asset pack when present', (t) => {
  const assetsRoot = resolveAssetsRoot(null)
  if (!assetsRoot) {
    t.skip('private animation assets are not available in this checkout')
    return
  }
  const result = verifyClient({ assetsRoot })
  assert.equal(result.ok, true, result.errors.join('; '))
})

test('package version is 0.8.0 and the host bridge entrypoint is still exported', async () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.version, '0.8.0')
  const module = await import('../index.js')
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.name, 'dsh-famling')
})

