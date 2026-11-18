import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

import { CLIENT_PATH } from '../scripts/embed-anims.mjs'
import { loadClientData } from '../scripts/verify-anims.mjs'

const clientSource = readFileSync(CLIENT_PATH, 'utf8')
const embedded = loadClientData(clientSource)

function flattenChildren(values, target) {
  for (const value of values) {
    if (Array.isArray(value)) flattenChildren(value, target)
    else if (value !== null && value !== undefined && value !== false && value !== true) target.push(value)
  }
  return target
}

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || !Array.isArray(node.children)) return ''
  return node.children.map(textOf).join('')
}

/** Minimal hook runtime for the plugin's createElement usage (no DOM needed). */
function createFakeReact() {
  let activeController = null
  const api = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: flattenChildren(children, []) }
    },
    useState(initial) { return activeController.hooks.useState(initial) },
    useRef(initial) { return activeController.hooks.useRef(initial) },
    useEffect(fn, deps) { return activeController.hooks.useEffect(fn, deps) },
  }
  return { api, setActive(controller) { activeController = controller } }
}

function createUi(Component, ReactRuntime) {
  const slots = []
  let element = null
  let dirty = false
  let renderCount = 0
  const controller = {
    cursor: 0,
    effects: [],
    hooks: {
      useState(initial) {
        const index = controller.cursor
        controller.cursor += 1
        let slot = slots[index]
        if (!slot) {
          slot = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
          slots[index] = slot
        }
        if (slot.kind !== 'state') throw new Error('hook order changed at slot ' + index)
        const setValue = (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next
          dirty = true
        }
        return [slot.value, setValue]
      },
      useRef(initial) {
        const index = controller.cursor
        controller.cursor += 1
        let slot = slots[index]
        if (!slot) {
          slot = { kind: 'ref', value: { current: initial } }
          slots[index] = slot
        }
        if (slot.kind !== 'ref') throw new Error('hook order changed at slot ' + index)
        return slot.value
      },
      useEffect(fn, deps) {
        const index = controller.cursor
        controller.cursor += 1
        controller.effects.push({ index, fn, deps })
      },
    },
  }
  function render() {
    dirty = false
    controller.cursor = 0
    controller.effects = []
    ReactRuntime.setActive(controller)
    element = Component()
    for (const effect of controller.effects) {
      let slot = slots[effect.index]
      if (!slot) {
        slot = { kind: 'effect', deps: null, cleanup: null }
        slots[effect.index] = slot
      }
      if (slot.kind !== 'effect') throw new Error('hook order changed at slot ' + effect.index)
      const previous = slot.deps
      const changed = !previous || !effect.deps || previous.length !== effect.deps.length || effect.deps.some((value, index) => value !== previous[index])
      if (!changed) continue
      if (typeof slot.cleanup === 'function') slot.cleanup()
      slot.deps = effect.deps ? effect.deps.slice() : null
      slot.cleanup = effect.fn()
    }
    renderCount += 1
    if (dirty && renderCount < 50) return render()
    return element
  }
  function findAll(predicate) {
    const found = []
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (node.type && predicate(node)) found.push(node)
      if (Array.isArray(node.children)) for (const child of node.children) walk(child)
    }
    walk(element)
    return found
  }
  const ui = {
    render,
    get tree() { return element },
    findAll,
    text(node) { return textOf(node) },
    findButton(label) { return findAll((node) => node.type === 'button' && textOf(node).includes(label))[0] },
    findButtonByAria(label) { return findAll((node) => node.type === 'button' && node.props['aria-label'] === label)[0] },
    findInput(type) { return findAll((node) => node.type === 'input' && node.props.type === type)[0] },
    findBubble() { return findAll((node) => node.type === 'div' && node.props.role === 'status')[0] },
    findPetButton() { return findAll((node) => node.type === 'button' && typeof node.props.title === 'string' && node.props.title.startsWith('Famling ·'))[0] },
    /**
     * Simulate a click on the pet image at an art-canvas point. The fake target
     * reports a rendered size, so the client must map offsetX/Y through the
     * actual display size back to the logical 96x96 canvas.
     */
    clickPetAt(artX, artY, display = 72) {
      const button = ui.findPetButton()
      assert.ok(button, 'pet button exists')
      const scale = display / 96
      const rect = { left: 0, top: 0, right: display, bottom: display, width: display, height: display }
      const target = { width: display, height: display, getBoundingClientRect: () => rect }
      button.props.onClick({ target, currentTarget: target, nativeEvent: { offsetX: artX * scale, offsetY: artY * scale }, preventDefault() {} })
    },
    click(node) {
      assert.ok(node, 'clickable node exists')
      assert.equal(typeof node.props.onClick, 'function', 'node has onClick')
      node.props.onClick({ target: node, preventDefault() {} })
    },
    clickText(label) {
      const node = ui.findButton(label)
      assert.ok(node, 'button exists: ' + label)
      ui.click(node)
    },
    change(node, value) {
      assert.ok(node, 'input node exists')
      node.props.onChange({ target: { value } })
    },
    async settle() {
      await new Promise((resolve) => setImmediate(resolve))
      render()
    },
  }
  return ui
}

function createHarness(options = {}) {
  const storage = new Map()
  storage.set('dsh-famling/settings', JSON.stringify({ sound: true, motion: false, bubble: true, ...(options.settings || {}) }))
  storage.set('dsh-famling/consent/v1', JSON.stringify({ tts: true, asr: false, ...(options.consent || {}) }))
  if (options.character) storage.set('dsh-famling/character', options.character)
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null },
    setItem(key, value) { storage.set(key, String(value)) },
    removeItem(key) { storage.delete(key) },
  }
  const speech = { speak: [], cancel: 0 }
  const listeners = new Map()
  const fetchCalls = []
  const documentStub = {
    baseURI: 'http://localhost/',
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
  }
  let definition = null
  const windowStub = {
    __ModuleLoader__: { load(loaded) { definition = loaded } },
    speechSynthesis: {
      cancel() { speech.cancel += 1 },
      speak(utterance) { speech.speak.push(utterance) },
    },
    innerWidth: 1400,
    innerHeight: 900,
  }
  const timers = { intervals: [], timeouts: [], cleared: 0 }
  const sandbox = {
    window: windowStub,
    localStorage,
    document: documentStub,
    navigator: { language: options.language || 'zh-CN' },
    URL,
    SpeechSynthesisUtterance: class SpeechSynthesisUtterance { constructor(text) { this.text = text } },
    fetch: async (url, init) => {
      fetchCalls.push({ url: String(url), init })
      return {
        ok: true,
        async json() { return { v: 1, ok: true, reply: options.reply || '我在这里。', bubbleKind: options.bubbleKind || 'speech' } },
      }
    },
    setInterval(fn, ms) { timers.intervals.push({ fn, ms }); return timers.intervals.length },
    clearInterval() { timers.cleared += 1 },
    setTimeout(fn, ms) { timers.timeouts.push({ fn, ms }); return timers.timeouts.length },
    clearTimeout() { timers.cleared += 1 },
    console,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' })
  assert.ok(definition, 'client.js registers a module')
  const React = createFakeReact()
  const moduleObject = definition.factory((name) => {
    if (name !== 'react') throw new Error('unexpected require: ' + name)
    return React.api
  })
  let Component = null
  moduleObject.apply({
    slots: {
      inject(name, factory) { return factory() },
      register(spec, component) { Component = component; return () => {} },
    },
  })
  assert.equal(typeof Component, 'function', 'FamlingFooter is registered into the sidebar footer slot')
  const ui = createUi(Component, React)
  ui.render()
  return { ui, speech, fetchCalls, storage, timers }
}

function idleSrc(kind) {
  const key = embedded.ANIMS[kind].clips.idle.frames[0]
  return 'data:image/png;base64,' + embedded.SPRITES[key]
}

function clipSrc(kind, clipId, index = 0) {
  const key = embedded.ANIMS[kind].clips[clipId].frames[index]
  return 'data:image/png;base64,' + embedded.SPRITES[key]
}

function petImage(ui) {
  return ui.findAll((node) => node.type === 'img')[0]
}

test('default render is Tinglan with the embedded 72px idle frame', () => {
  const { ui, speech } = createHarness()
  assert.equal(ui.tree.props['data-character'], 'human')
  const image = ui.findAll((node) => node.type === 'img')[0]
  assert.ok(image, 'pet image renders')
  assert.equal(image.props.width, 72)
  assert.equal(image.props.height, 72)
  assert.equal(image.props.src, idleSrc('human'))
  assert.equal(image.props.style.imageRendering, 'pixelated')
  assert.equal(speech.speak.length, 0, 'nothing is spoken before an interaction')
})

test('settings panel switches to the Selkirk Rex cat, persists it and disables voice', () => {
  const { ui, speech, storage } = createHarness()
  ui.clickText('设置')
  ui.render()
  ui.clickText('塞尔凯克卷毛猫')
  ui.render()
  assert.equal(ui.tree.props['data-character'], 'cat')
  assert.equal(ui.findPetButton().props['aria-label'], '塞尔凯克卷毛猫', 'pet aria-label uses the Selkirk Rex name')
  assert.equal(ui.findAll((node) => node.type === 'img')[0].props.src, idleSrc('cat'))
  assert.equal(storage.get('dsh-famling/character'), 'cat')
  const checkboxes = ui.findAll((node) => node.type === 'input' && node.props.type === 'checkbox')
  assert.equal(checkboxes[0].props.disabled, true, 'voice checkbox disabled for cat')
  assert.equal(checkboxes[0].props.checked, false)
  assert.ok(ui.findAll((node) => node.type === 'p').some((node) => ui.text(node).includes('仅汀岚')), 'voice hint shown')
  assert.equal(speech.speak.length, 0)
  assert.ok(speech.cancel >= 1, 'switching to a silent character cancels browser speech')
})

test('cat interactions use readable dashed thought bubbles and never call browser TTS', () => {
  const { ui, speech } = createHarness({ character: 'cat' })
  assert.equal(ui.tree.props['data-character'], 'cat')
  ui.clickText('互动')
  ui.render()
  assert.ok(ui.findButton('洗脸'), 'cat-specific action present')
  assert.equal(ui.findButton('摇尾巴'), undefined, 'dog-only action is not shown for cat')
  assert.ok(ui.findButton('摸摸'), 'shared pat_head action present')
  ui.clickText('洗脸')
  ui.render()
  const bubble = ui.findBubble()
  assert.ok(bubble, 'thought bubble renders')
  assert.notEqual(bubble.props.style.background, 'transparent')
  assert.match(bubble.props.style.background, /rgba?\(/)
  assert.equal(bubble.props.style.color, '#f4f6fb')
  assert.match(bubble.props.style.border, /dashed/)
  assert.equal(speech.speak.length, 0, 'cat must never call speechSynthesis')
})

test('human interactions keep solid speech bubbles and browser TTS', () => {
  const { ui, speech } = createHarness()
  ui.clickText('互动')
  ui.render()
  assert.ok(ui.findButton('摸摸'), 'human action present')
  assert.ok(ui.findButton('挥手'), 'human-specific action present')
  assert.equal(ui.findButton('追尾巴'), undefined, 'cat/dog-only action is not shown for human')
  ui.clickText('摸摸')
  ui.render()
  const bubble = ui.findBubble()
  assert.ok(bubble)
  assert.notEqual(bubble.props.style.background, 'transparent')
  assert.match(bubble.props.style.border, /solid/)
  assert.equal(speech.speak.length, 1, 'human speech uses TTS when enabled + consented')
  assert.equal(speech.speak[0].text, '被摸到了。')
})

test('chat bridge sends the active character so the Host can switch personas', async () => {
  const { ui, fetchCalls } = createHarness()
  async function typeAndSend(text) {
    const textarea = ui.findAll((node) => node.type === 'textarea')[0]
    assert.ok(textarea, 'chat input panel is open')
    ui.change(textarea, text)
    ui.render()
    ui.clickText('发送')
    await ui.settle()
  }
  ui.clickText('输入')
  ui.render()
  await typeAndSend('你好')
  ui.clickText('设置')
  ui.render()
  ui.clickText('塞尔凯克卷毛猫')
  ui.render()
  ui.clickText('输入')
  ui.render()
  await typeAndSend('今天好懒')
  ui.clickText('设置')
  ui.render()
  ui.clickText('金毛')
  ui.render()
  ui.clickText('输入')
  ui.render()
  await typeAndSend('去玩球')
  assert.equal(ui.tree.props['data-character'], 'dog')
  assert.deepEqual(fetchCalls.map((call) => JSON.parse(call.init.body).character), ['human', 'cat', 'dog'])
})

test('stored character choice is restored on the next render', () => {
  const { ui } = createHarness({ character: 'dog' })
  assert.equal(ui.tree.props['data-character'], 'dog')
  assert.equal(ui.findAll((node) => node.type === 'img')[0].props.src, idleSrc('dog'))
})

test('chat bridge still works from the input panel (op:chat, same endpoint)', async () => {
  const { ui, fetchCalls, speech } = createHarness({ reply: '嗯，我在。' })
  ui.clickText('输入')
  ui.render()
  const textarea = ui.findAll((node) => node.type === 'textarea')[0]
  ui.change(textarea, '你好')
  ui.render()
  ui.clickText('发送')
  await ui.settle()
  assert.equal(fetchCalls.length, 1)
  assert.match(fetchCalls[0].url, /\/api\/famling\/bridge$/)
  const payload = JSON.parse(fetchCalls[0].init.body)
  assert.deepEqual(payload, { v: 1, op: 'chat', text: '你好', character: 'human' })
  const bubble = ui.findBubble()
  assert.ok(bubble)
  assert.equal(ui.text(bubble), '嗯，我在。')
  assert.equal(speech.speak.length, 1, 'human reply is read aloud under TTS consent')
})

// Art-canvas points (96x96) inside each character's head/body/tail region.
const REGION_CASES = {
  human: {
    head: { point: [51, 27], clip: 'pat_head', line: '被摸到了。' },
    body: { point: [48, 66], clip: 'stand_wag', line: '挥了挥手。' },
    tail: { point: [74, 72], clip: 'chase_tail', line: '回头看了一眼。' },
  },
  cat: {
    head: { point: [50, 35], clip: 'pat_head', line: '（被摸到了，呼噜呼噜…）' },
    body: { point: [50, 69], clip: 'stand_wag', line: '（站起来看看。）' },
    tail: { point: [81, 69], clip: 'chase_tail', line: '（尾巴…转。）' },
  },
  dog: {
    head: { point: [50, 31], clip: 'pat_head', line: '（好舒服，还要！）' },
    body: { point: [49, 68], clip: 'stand_wag', line: '（摇尾巴…开心。）' },
    tail: { point: [83, 67], clip: 'chase_tail', line: '（尾巴在动？追！）' },
  },
}

test('region taps map head/body/tail to pat_head/stand_wag/chase_tail', () => {
  for (const kind of ['human', 'cat', 'dog']) {
    for (const [regionId, expected] of Object.entries(REGION_CASES[kind])) {
      const { ui, speech } = createHarness({ character: kind })
      ui.clickPetAt(expected.point[0], expected.point[1])
      ui.render()
      assert.equal(petImage(ui).props.src, clipSrc(kind, expected.clip), kind + '/' + regionId + ': plays ' + expected.clip)
      const bubble = ui.findBubble()
      assert.ok(bubble, kind + '/' + regionId + ': bubble renders')
      assert.equal(ui.text(bubble), expected.line, kind + '/' + regionId + ': bubble line')
      if (kind === 'human') {
        assert.match(bubble.props.style.border, /solid/, 'human region taps use a solid speech bubble')
        assert.equal(speech.speak.length, 1, 'human region taps may use browser TTS')
      } else {
        assert.match(bubble.props.style.border, /dashed/, kind + ' region taps use a thought bubble')
        assert.equal(speech.speak.length, 0, kind + ' region taps never call browser TTS')
      }
    }
  }
})

test('the same relative tap point hits the same region at every rendered size', () => {
  const points = [[50, 35, 'pat_head'], [50, 69, 'stand_wag'], [81, 69, 'chase_tail']]
  for (const display of [64, 72, 96, 144, 192]) {
    for (const [artX, artY, clipId] of points) {
      const { ui } = createHarness({ character: 'cat' })
      ui.clickPetAt(artX, artY, display)
      ui.render()
      assert.equal(petImage(ui).props.src, clipSrc('cat', clipId), display + 'px display: ' + clipId)
    }
  }
})

test('a tap does not interrupt a playing (non-idle) animation', () => {
  const { ui, speech } = createHarness({ character: 'human' })
  ui.clickText('互动')
  ui.render()
  ui.clickText('摸摸')
  ui.render()
  const playing = petImage(ui).props.src
  const playingBubble = ui.text(ui.findBubble())
  assert.equal(playing, clipSrc('human', 'pat_head'), 'pat_head clip is playing')
  ui.clickPetAt(74, 72) // the tail region would play chase_tail if gating were missing
  ui.render()
  assert.equal(petImage(ui).props.src, playing, 'animation is unchanged while non-idle')
  assert.equal(ui.text(ui.findBubble()), playingBubble, 'bubble is unchanged while non-idle')
  assert.equal(speech.speak.length, 1, 'no extra narration while non-idle')
})

test('a tap outside every region is a no-op (no random fallback)', () => {
  const { ui, speech } = createHarness({ character: 'dog' })
  const idle = petImage(ui).props.src
  ui.clickPetAt(3, 3)
  ui.render()
  assert.equal(petImage(ui).props.src, idle, 'idle animation keeps playing')
  assert.equal(ui.findBubble(), undefined, 'no bubble on transparent/undefined area')
  assert.equal(speech.speak.length, 0, 'no narration on transparent/undefined area')
})

test('region taps still react during the idle blink phase', () => {
  const { ui, timers } = createHarness({ character: 'cat', settings: { motion: true } })
  const blinkTimer = timers.timeouts.find((timer) => timer.ms >= 3600 && timer.ms < 6200)
  assert.ok(blinkTimer, 'idle blink timer is scheduled')
  blinkTimer.fn()
  ui.render()
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'idle_blink'), 'blink frame is showing')
  ui.clickPetAt(50, 35)
  ui.render()
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'pat_head'), 'head tap reacts while blinking')
})

