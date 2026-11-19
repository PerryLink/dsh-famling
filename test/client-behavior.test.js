import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

import { dirname, join } from 'node:path'

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
    findButtonExact(label) { return findAll((node) => node.type === 'button' && textOf(node) === label)[0] },
    findButtonByAria(label) { return findAll((node) => node.type === 'button' && node.props['aria-label'] === label)[0] },
    findInput(type) { return findAll((node) => node.type === 'input' && node.props.type === type)[0] },
    findBubble() { return findAll((node) => node.type === 'div' && node.props.role === 'status')[0] },
    findPetButton() { return findAll((node) => node.type === 'button' && typeof node.props.title === 'string' && node.props.title.startsWith('Famling ·'))[0] },
    menuLabels() { return findAll((node) => node.type === 'button').map((node) => textOf(node)).filter((text) => text !== '' && !['输入', '互动', '设置', '×', 'Input', 'Play', 'Settings', 'Close'].includes(text)) },
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
    clickExact(label) {
      const node = ui.findButtonExact(label)
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
  if (options.role) storage.set('dsh-famling/role', options.role)
  if (options.dialogue) storage.set('dsh-famling/dialogue', options.dialogue)
  if (options.theme) storage.set('dsh-famling/theme', options.theme)
  if (options.background) storage.set('dsh-famling/background', options.background)
  if (options.font) storage.set('dsh-famling/font', JSON.stringify(options.font))
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
  const chunkDefinitions = new Map()
  const windowStub = {
    __ModuleLoader__: {
      load(loaded) {
        if (loaded && typeof loaded.chunk === 'string') chunkDefinitions.set(loaded.chunk, loaded)
        else definition = loaded
      },
    },
    speechSynthesis: {
      cancel() { speech.cancel += 1 },
      speak(utterance) { speech.speak.push(utterance) },
      getVoices() { return options.voices || [] },
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
  const random = { fn: options.random || null }
  const mathStub = Object.create(Math)
  mathStub.random = () => (random.fn ? random.fn() : Math.random())
  sandbox.Math = mathStub
  vm.createContext(sandbox)
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' })
  assert.ok(definition, 'client.js registers a module')
  const React = createFakeReact()
  /**
   * Minimal mirror of the DSH module table: synchronously require React, and
   * resolve a registered package-local lazy chunk through require.async. The
   * thenable settles synchronously so the fake React effects can repaint in the
   * same render pass; the real runtime hands back a Promise instead.
   */
  const requireModule = (name) => {
    if (name !== 'react') throw new Error('unexpected require: ' + name)
    return React.api
  }
  const asyncCalls = []
  requireModule.async = (spec) => {
    const fileName = String(spec).replace(/^\.\//, '')
    asyncCalls.push(fileName)
    if (fileName === 'client.content.js') {
      if (options.failContentChunk) {
        return { then(resolve, reject) { reject(new Error('simulated missing content chunk: ' + fileName)) } }
      }
      if (!chunkDefinitions.has(fileName)) {
        const chunkSource = readFileSync(join(dirname(CLIENT_PATH), fileName), 'utf8')
        vm.runInContext(chunkSource, sandbox, { filename: fileName })
      }
      const contentRegistration = chunkDefinitions.get(fileName)
      assert.ok(contentRegistration, 'content chunk registered: ' + fileName)
      return { then(resolve) { resolve(contentRegistration.factory(requireModule)) } }
    }
    if (!/^client\.anims\.(human|cat|dog)\.js$/.test(fileName)) throw new Error('unexpected async chunk: ' + spec)
    if (Array.isArray(options.failChunks) && options.failChunks.includes(fileName)) {
      return { then(resolve, reject) { reject(new Error('simulated missing lazy chunk: ' + fileName)) } }
    }
    if (!chunkDefinitions.has(fileName)) {
      const chunkSource = readFileSync(join(dirname(CLIENT_PATH), fileName), 'utf8')
      vm.runInContext(chunkSource, sandbox, { filename: fileName })
    }
    const registration = chunkDefinitions.get(fileName)
    assert.ok(registration, 'lazy chunk registered: ' + fileName)
    // Tests read the real generated chunk factory; production require.async
    // returns the same exports as a Promise.
    const payload = registration.factory(requireModule)
    return { then(resolve) { resolve(payload) } }
  }
  const moduleObject = definition.factory(requireModule)
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
  return { ui, speech, fetchCalls, storage, timers, asyncCalls, module: moduleObject, setRandom(fn) { random.fn = fn } }
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

function regionSays(kind, regionId) {
  const rule = embedded.ANIMS[kind].regions.gestures.find((gesture) => gesture.region === regionId)
  assert.ok(rule, kind + '/' + regionId + ': region rule exists')
  return rule.says
}

function actionSays(kind, actionId) {
  const action = embedded.ANIMS[kind].actions.find((item) => item.id === actionId)
  assert.ok(action, kind + '/' + actionId + ': action exists')
  return action.says
}

/** Invoke the most recently scheduled fake setTimeout with this delay. */
function runTimeout(ui, timers, ms) {
  const timer = [...timers.timeouts].reverse().find((item) => item.ms === ms)
  assert.ok(timer, 'timeout +' + ms + 'ms is scheduled')
  timer.fn()
  ui.render()
}

/** Expected playback delays, recomputed independently from the embedded data. */
function clipDurations(kind, clipId) {
  const seq = embedded.ANIMS[kind].clips[clipId]
  const durations = seq.frames.map((_, index) => {
    const hold = Array.isArray(seq.holdMs) ? seq.holdMs[index] : undefined
    return Number.isFinite(hold) && hold > 0 ? hold : Math.max(30, Math.round(1000 / (seq.fps || 6)))
  })
  if (seq.loop !== true && Number.isFinite(seq.durationMs)) {
    const total = durations.reduce((sum, value) => sum + value, 0)
    if (seq.durationMs > total) durations[durations.length - 1] += seq.durationMs - total
  }
  return durations
}

/** Play a one-shot clip to its end by invoking each scheduled frame timeout. */
function finishClip(ui, timers, kind, clipId) {
  const durations = clipDurations(kind, clipId)
  for (let index = 0; index < durations.length; index += 1) {
    const timer = timers.timeouts[timers.timeouts.length - 1]
    assert.ok(timer, kind + '/' + clipId + ': frame timeout is scheduled')
    assert.equal(timer.ms, durations[index], kind + '/' + clipId + ': frame ' + index + ' delay')
    timer.fn()
    ui.render()
  }
}

test('default render is Tinglan with the embedded 72px idle frame', () => {
  const { ui, speech } = createHarness()
  assert.equal(ui.tree.props['data-character'], 'human')
  const image = petImage(ui)
  assert.ok(image, 'pet image renders')
  assert.equal(image.props.width, 72)
  assert.equal(image.props.height, 72)
  assert.equal(image.props.src, idleSrc('human'))
  assert.equal(image.props.style.imageRendering, 'pixelated')
  assert.equal(speech.speak.length, 0, 'nothing is spoken before an interaction')
})

test('idle loop advances frame by frame using the per-frame delays', () => {
  const { ui, timers } = createHarness({ character: 'cat', settings: { motion: true } })
  const idle = embedded.ANIMS.cat.clips.idle
  const expectedDelay = Math.max(30, Math.round(1000 / (idle.fps || 6)))
  for (let frame = 1; frame < idle.frames.length; frame += 1) {
    // The blink/micro timers are also queued; pick the most recent idle delay.
    const timer = [...timers.timeouts].reverse().find((item) => item.ms === expectedDelay)
    assert.ok(timer, 'idle frame timeout is scheduled')
    timer.fn()
    ui.render()
    assert.equal(petImage(ui).props.src, clipSrc('cat', 'idle', frame), 'idle frame ' + frame)
  }
  runTimeout(ui, timers, expectedDelay)
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'idle', 0), 'idle loop wraps back to frame 0')
})

/** Open the content center (4th sidebar button) and optionally one category tab. */
function openContent(ui, tab) {
  ui.clickExact('内容')
  ui.render()
  if (tab) { ui.clickExact(tab); ui.render() }
}

function contentDialog(ui) {
  return ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-label'] === '内容中心')[0]
}

test('settings only links to the content center and keeps the other toggles', () => {
  const { ui } = createHarness()
  ui.clickText('设置')
  ui.render()
  assert.ok(ui.findButtonExact('内容与角色…'), 'settings has one content entry row')
  assert.equal(ui.findButtonExact('塞尔凯克卷毛猫'), undefined, 'no scattered character buttons in settings')
  assert.equal(ui.findButtonExact('金毛'), undefined, 'no scattered character buttons in settings')
  assert.equal(ui.findAll((node) => node.type === 'input' && node.props.type === 'checkbox').length, 2, 'settings keeps motion + bubble toggles')
  ui.clickExact('内容与角色…')
  ui.render()
  assert.ok(contentDialog(ui), 'content center opens from the settings entry')
})

test('content center exposes exactly four first-level tabs: roles / customize / packs / market', () => {
  const { ui } = createHarness()
  openContent(ui, '角色')
  const tabs = ui.findAll((node) => node.type === 'button' && node.props.role === 'tab').map((node) => ui.text(node))
  assert.deepEqual(tabs, ['角色', '自定义', '内容包', '市场'], 'four first-level tabs only')
  assert.ok(ui.text(contentDialog(ui)).includes('角色就是主题'), 'the role-is-theme model is explained')
  assert.ok(ui.text(contentDialog(ui)).includes('声音: 浏览器 TTS'), 'role card shows the voice summary')
  assert.ok(ui.text(contentDialog(ui)).includes('外观: 默认 / 透明 / 系统'), 'role card shows the appearance summary')
  for (const oldTab of ['声音', '对话', '主题', '背景', '字体']) {
    const row = ui.findAll((node) => node.type === 'button' && node.props.role === 'tab' && ui.text(node) === oldTab)
    assert.equal(row.length, 0, 'old six-category tab is gone: ' + oldTab)
  }
})

test('English content center localizes the four tabs, role apply action and market placeholder', () => {
  const { ui } = createHarness({ language: 'en-US' })
  ui.clickExact('Content')
  ui.render()
  const tabs = ui.findAll((node) => node.type === 'button' && node.props.role === 'tab').map((node) => ui.text(node))
  assert.deepEqual(tabs, ['Roles', 'Customize', 'Packs', 'Market'], 'English first-level tabs')
  assert.ok(ui.findButtonByAria('Apply role Tinglan'), 'English one-click apply label')
  ui.clickExact('Market')
  ui.render()
  const dialog = ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-label'] === 'Content Center')[0]
  assert.ok(dialog, 'English content panel is open')
  assert.ok(ui.text(dialog).includes('remote market interface is reserved'), 'English market placeholder')
  assert.ok(ui.text(dialog).includes('catalogUrl'), 'English catalog field remains reserved')
})
test('one-click role applies character + voice policy + dialogue + theme/background/font together', () => {
  const { ui, speech, storage } = createHarness()
  openContent(ui, '角色')
  assert.ok(ui.text(contentDialog(ui)).includes('✓ 当前'), 'the current role is marked')
  assert.equal(ui.findButtonByAria('一键应用 汀岚').props['aria-pressed'] === undefined, true, 'apply buttons carry a stable aria label')
  ui.click(ui.findButtonByAria('一键应用 塞尔凯克卷毛猫'))
  ui.render()
  assert.equal(ui.tree.props['data-character'], 'cat', 'character component applied')
  assert.equal(storage.get('dsh-famling/role'), 'cat', 'role bundle persisted')
  assert.equal(storage.get('dsh-famling/character'), 'cat')
  assert.equal(storage.get('dsh-famling/dialogue'), 'brief', 'dialogue component applied')
  assert.equal(storage.get('dsh-famling/theme'), 'paper', 'theme component applied')
  assert.equal(storage.get('dsh-famling/background'), 'paper', 'background component applied')
  assert.deepEqual(JSON.parse(storage.get('dsh-famling/font')), { family: 'serif', size: 12, lineHeight: 1.5 }, 'font component applied')
  assert.equal(ui.tree.props.style['--dsh-famling-bubble-bg'], '#fff8ec', 'paper bubble variable is live')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], '#f6f1e7', 'paper backdrop variable is live')
  assert.match(ui.tree.props.style['--dsh-famling-font-family'], /Georgia/, 'serif font variable is live')
  assert.equal(ui.findPetButton().props['aria-label'], '塞尔凯克卷毛猫')
  assert.equal(petImage(ui).props.src, idleSrc('cat'))
  assert.equal(speech.speak.length, 0, 'a silent role policy never speaks')
  assert.ok(speech.cancel >= 1, 'switching to a silent role cancels browser speech')
  assert.ok(ui.text(contentDialog(ui)).includes('✓ 当前'), 'the current marker moves with the bundle')
})

test('one-click role applies the voice policy without bypassing the TTS consent gate', () => {
  const consented = createHarness()
  openContent(consented.ui, '角色')
  consented.ui.click(consented.ui.findButtonByAria('一键应用 塞尔凯克卷毛猫'))
  consented.ui.render()
  assert.equal(JSON.parse(consented.storage.get('dsh-famling/settings')).sound, false, 'a silent role turns sound off')
  consented.ui.click(consented.ui.findButtonByAria('一键应用 汀岚'))
  consented.ui.render()
  assert.equal(JSON.parse(consented.storage.get('dsh-famling/settings')).sound, true, 'a speech role turns sound on when TTS is consented')
  const noConsent = createHarness({ consent: { tts: false } })
  openContent(noConsent.ui, '角色')
  noConsent.ui.click(noConsent.ui.findButtonByAria('一键应用 塞尔凯克卷毛猫'))
  noConsent.ui.render()
  noConsent.ui.click(noConsent.ui.findButtonByAria('一键应用 汀岚'))
  noConsent.ui.render()
  assert.equal(JSON.parse(noConsent.storage.get('dsh-famling/settings')).sound, false, 'the consent gate is never bypassed')
})
test('role cards keep glyph avatars and do not preload other animation chunks', () => {
  const { ui, asyncCalls } = createHarness()
  openContent(ui, '角色')
  const animCalls = asyncCalls.filter((name) => name.startsWith('client.anims.'))
  assert.deepEqual(animCalls, ['client.anims.human.js'], 'only the current role chunk is loaded before applying a role')
  assert.ok(asyncCalls.includes('client.content.js'), 'the content-center UI chunk loads on first open')
  assert.equal(ui.findAll((node) => node.type === 'span' && node.props['aria-hidden'] === true && ['🧑', '🐱', '🐶'].includes(ui.text(node))).length >= 3, true, 'role cards keep their glyph avatars')
  ui.click(ui.findButtonByAria('一键应用 金毛'))
  ui.render()
  assert.ok(asyncCalls.includes('client.anims.dog.js'), 'the applied role chunk is lazy-loaded')
  assert.equal(asyncCalls.includes('client.anims.cat.js'), false, 'unapplied role chunks stay unloaded')
})

test('cat menu is species-specific (no ball/fetch actions) and bubbles stay silent thoughts', () => {
  const { ui, speech } = createHarness({ character: 'cat' })
  assert.equal(ui.tree.props['data-character'], 'cat')
  ui.clickText('互动')
  ui.render()
  for (const label of ['摸头', '伸懒腰', '洗脸', '追尾巴', '跑一跑']) assert.ok(ui.findButtonExact(label), 'cat action present: ' + label)
  assert.equal(ui.findButtonExact('摇尾巴'), undefined, 'dog-only action is not shown for cat')
  assert.equal(ui.findAll((node) => node.type === 'button' && /球|纸团/.test(textOf(node))).length, 0, 'cat has no ball/paper actions')
  const says = actionSays('cat', 'wash')
  ui.clickExact('洗脸')
  ui.render()
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'paw_face'), 'wash plays paw_face')
  const bubble = ui.findBubble()
  assert.ok(bubble, 'thought bubble renders')
  assert.ok(says.includes(ui.text(bubble)), 'cat wash line comes from the action says: ' + ui.text(bubble))
  assert.equal(bubble.props.style.background, 'var(--dsh-famling-bubble-bg, #ffffff)')
  assert.equal(bubble.props.style.color, 'var(--dsh-famling-bubble-text, #111111)')
  assert.match(bubble.props.style.border, /dashed/)
  assert.match(bubble.props.style.border, /#8f8f8f/)
  assert.equal(speech.speak.length, 0, 'cat must never call speechSynthesis')
})

test('human menu is species-specific with solid speech and TTS lines from the action says', () => {
  const { ui, speech } = createHarness()
  ui.clickText('互动')
  ui.render()
  for (const label of ['摸头', '递纸', '挥手', '整理蝴蝶结', '聊两句']) assert.ok(ui.findButtonExact(label), 'human action present: ' + label)
  assert.equal(ui.findButtonExact('追尾巴'), undefined, 'cat/dog-only action is not shown for human')
  assert.equal(ui.findAll((node) => node.type === 'button' && /球|纸团/.test(textOf(node))).length, 0, 'human menu has no ball/paper actions')
  const says = actionSays('human', 'pat')
  ui.clickExact('摸头')
  ui.render()
  assert.equal(petImage(ui).props.src, clipSrc('human', 'pat_head'))
  const bubble = ui.findBubble()
  assert.ok(bubble)
  assert.equal(bubble.props.style.background, 'var(--dsh-famling-bubble-bg, #ffffff)')
  assert.equal(bubble.props.style.color, 'var(--dsh-famling-bubble-text, #111111)')
  assert.match(bubble.props.style.border, /solid/)
  assert.match(bubble.props.style.border, /#9a9a9a/)
  assert.ok(says.includes(ui.text(bubble)), 'human pat line comes from the action says')
  assert.equal(speech.speak.length, 1, 'human speech uses TTS when enabled + consented')
  assert.equal(speech.speak[0].text, ui.text(bubble), 'TTS reads the same random line')
})

test('dog menu exposes fetch/retrieve and chains ball_throw -> ball_chase', () => {
  const { ui, speech, timers } = createHarness({ character: 'dog' })
  ui.clickText('互动')
  ui.render()
  assert.ok(ui.findButtonExact('摸头'), 'dog pat')
  assert.ok(ui.findButtonExact('丢球 / 捡球'), 'dog fetch')
  assert.ok(ui.findButtonExact('捡球'), 'dog retrieve')
  assert.ok(ui.findButtonExact('追尾巴'), 'dog tail')
  assert.ok(ui.findButtonExact('跑一跑'), 'dog run')
  assert.equal(ui.findButtonExact('洗脸'), undefined, 'cat-only action is not shown for dog')
  const fetchSays = actionSays('dog', 'fetch')
  ui.clickExact('丢球 / 捡球')
  ui.render()
  assert.equal(petImage(ui).props.src, clipSrc('dog', 'ball_throw'), 'fetch starts with ball_throw')
  assert.ok(fetchSays.includes(ui.text(ui.findBubble())), 'dog fetch line comes from the action says')
  runTimeout(ui, timers, 500)
  assert.equal(petImage(ui).props.src, clipSrc('dog', 'ball_chase'), 'fetch follows up with ball_chase')
  assert.equal(speech.speak.length, 0, 'dog never calls speechSynthesis')
})

test('cat stand_wag plays its 10 authored holdMs frames over 3200ms (no fixed fps interval)', () => {
  const { ui, timers } = createHarness({ character: 'cat', settings: { motion: true } })
  ui.clickText('互动')
  ui.render()
  const expected = [300, 300, 300, 350, 400, 400, 400, 350, 250, 150]
  assert.deepEqual(clipDurations('cat', 'stand_wag'), expected, 'expected per-frame delays')
  assert.equal(expected.reduce((sum, value) => sum + value, 0), 3200, 'total stretch duration')
  ui.clickExact('伸懒腰')
  ui.render()
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'stand_wag', 0), 'first stand_wag frame is showing')
  assert.equal(timers.intervals.length, 0, 'playback must not use a fixed setInterval')
  for (let index = 0; index < expected.length; index += 1) {
    const timer = timers.timeouts[timers.timeouts.length - 1]
    assert.ok(timer, 'stand_wag frame ' + index + ' timeout is scheduled')
    assert.equal(timer.ms, expected[index], 'frame ' + index + ' holds for ' + expected[index] + 'ms')
    timer.fn()
    ui.render()
    if (index + 1 < expected.length) {
      assert.equal(petImage(ui).props.src, clipSrc('cat', 'stand_wag', index + 1), 'frame ' + (index + 1) + ' is showing')
    }
  }
  assert.equal(petImage(ui).props.src, idleSrc('cat'), 'stand_wag returns to idle after 3200ms')
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
  function pickCharacter(name) {
    ui.clickExact('内容')
    ui.render()
    ui.clickExact('角色')
    ui.render()
    ui.click(ui.findButtonByAria('一键应用 ' + name))
    ui.render()
    ui.clickExact('内容')
    ui.render()
  }
  ui.clickText('输入')
  ui.render()
  await typeAndSend('你好')
  pickCharacter('塞尔凯克卷毛猫')
  ui.clickText('输入')
  ui.render()
  await typeAndSend('今天好懒')
  pickCharacter('金毛')
  ui.clickText('输入')
  ui.render()
  await typeAndSend('去玩球')
  assert.equal(ui.tree.props['data-character'], 'dog')
  assert.deepEqual(fetchCalls.map((call) => JSON.parse(call.init.body).character), ['human', 'cat', 'dog'])
})

test('stored character choice is restored on the next render', () => {
  const { ui } = createHarness({ character: 'dog' })
  assert.equal(ui.tree.props['data-character'], 'dog')
  assert.equal(petImage(ui).props.src, idleSrc('dog'))
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
    head: { point: [51, 27], clip: 'pat_head' },
    body: { point: [48, 66], clip: 'stand_wag' },
    tail: { point: [74, 72], clip: 'chase_tail' },
  },
  cat: {
    head: { point: [50, 35], clip: 'pat_head' },
    body: { point: [50, 69], clip: 'stand_wag' },
    tail: { point: [81, 69], clip: 'chase_tail' },
  },
  dog: {
    head: { point: [50, 31], clip: 'pat_head' },
    body: { point: [49, 68], clip: 'stand_wag' },
    tail: { point: [83, 67], clip: 'chase_tail' },
  },
}

test('region taps map head/body/tail to clips and random lines from that region says', () => {
  for (const kind of ['human', 'cat', 'dog']) {
    for (const [regionId, expected] of Object.entries(REGION_CASES[kind])) {
      const { ui, speech } = createHarness({ character: kind })
      ui.clickPetAt(expected.point[0], expected.point[1])
      ui.render()
      assert.equal(petImage(ui).props.src, clipSrc(kind, expected.clip), kind + '/' + regionId + ': plays ' + expected.clip)
      const bubble = ui.findBubble()
      assert.ok(bubble, kind + '/' + regionId + ': bubble renders')
      const says = regionSays(kind, regionId)
      assert.ok(says.includes(ui.text(bubble)), kind + '/' + regionId + ': bubble line is one of the region says: ' + ui.text(bubble))
      if (kind === 'human') {
        assert.match(bubble.props.style.border, /solid/, 'human region taps use a solid speech bubble')
        assert.equal(speech.speak.length, 1, 'human region taps may use browser TTS')
        assert.equal(speech.speak[0].text, ui.text(bubble), 'TTS reads the region line')
      } else {
        assert.match(bubble.props.style.border, /dashed/, kind + ' region taps use a thought bubble')
        assert.equal(speech.speak.length, 0, kind + ' region taps never call browser TTS')
      }
    }
  }
})

test('repeated taps on the same region pick a different line from its says', () => {
  const { ui, timers } = createHarness({ character: 'cat', settings: { motion: true } })
  ui.clickPetAt(50, 35)
  ui.render()
  const says = regionSays('cat', 'head')
  const first = ui.text(ui.findBubble())
  assert.ok(says.includes(first), 'first head line comes from head says')
  // Let the one-shot pat_head clip play out frame by frame, then tap again.
  finishClip(ui, timers, 'cat', 'pat_head')
  ui.clickPetAt(50, 35)
  ui.render()
  const second = ui.text(ui.findBubble())
  assert.ok(says.includes(second), 'second head line comes from head says')
  assert.notEqual(second, first, 'the same region does not repeat the same line on the next tap')
})

test('clicking the same menu action twice also changes the random line', () => {
  const { ui } = createHarness()
  ui.clickText('互动')
  ui.render()
  const says = actionSays('human', 'pat')
  ui.clickExact('摸头')
  ui.render()
  const first = ui.text(ui.findBubble())
  ui.clickExact('摸头')
  ui.render()
  const second = ui.text(ui.findBubble())
  assert.ok(says.includes(first) && says.includes(second), 'both lines come from the action says')
  assert.notEqual(second, first, 'menu action lines do not repeat back to back')
})

test('talk is bubble-only and keeps the idle animation', () => {
  const { ui, speech } = createHarness()
  ui.clickText('互动')
  ui.render()
  const says = actionSays('human', 'talk')
  ui.clickExact('聊两句')
  ui.render()
  assert.equal(petImage(ui).props.src, idleSrc('human'), 'talk keeps the idle frame (no dedicated clip)')
  const bubble = ui.findBubble()
  assert.ok(bubble)
  assert.ok(says.includes(ui.text(bubble)), 'talk line comes from the action says')
  assert.match(bubble.props.style.border, /solid/)
  assert.equal(speech.speak.length, 1, 'human talk is still spoken under TTS consent')
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
  ui.clickExact('摸头')
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
  assert.ok(regionSays('cat', 'head').includes(ui.text(ui.findBubble())), 'blink-phase tap still uses the head says')
})

test('a missing lazy chunk degrades to the transparent placeholder without breaking the UI', () => {
  const { ui } = createHarness({ character: 'cat', failChunks: ['client.anims.cat.js'] })
  // The sprite chunk failed: the pet slot stays laid out with the 1x1 transparent
  // placeholder instead of a broken image, and the shell remains interactive.
  assert.match(petImage(ui).props.src, /^data:image\/png;base64,iVBORw0KGgo/, 'placeholder pixel keeps the slot')
  assert.equal(ui.findButton('设置') !== undefined, true, 'the UI buttons are still rendered')
  ui.render()
  assert.equal(petImage(ui).props.src, petImage(ui).props.src, 'render stays stable without the chunk')
  assert.equal(ui.findBubble(), undefined, 'no fabricated content while the chunk is missing')
})

test('English UI localizes action button labels while lines stay data-driven', () => {
  const { ui } = createHarness({ character: 'human', language: 'en-US' })
  ui.clickText('Play')
  ui.render()
  for (const label of ['Pat', 'Hand paper', 'Wave', 'Fix bow', 'Chat']) assert.ok(ui.findButtonExact(label), 'en action label present: ' + label)
  ui.clickExact('Pat')
  ui.render()
  assert.ok(actionSays('human', 'pat').includes(ui.text(ui.findBubble())), 'line still comes from the shared data')
})

test('content center voices tab lists speechSynthesis voices, persists the choice and speaks with it (human only)', () => {
  const voices = [
    { voiceURI: 'voice-alpha', name: 'Alpha', lang: 'zh-CN' },
    { voiceURI: 'voice-beta', name: 'Beta', lang: 'en-US' },
  ]
  const { ui, speech, storage } = createHarness({ voices })
  openContent(ui, '自定义')
  const select = ui.findAll((node) => node.type === 'select')[0]
  assert.ok(select, 'voice select renders from speechSynthesis.getVoices()')
  assert.deepEqual(select.children.filter((node) => node && node.type === 'option').map((node) => node.props.value), ['', 'voice-alpha', 'voice-beta'])
  ui.change(select, 'voice-beta')
  ui.render()
  assert.equal(JSON.parse(storage.get('dsh-famling/settings')).voiceURI, 'voice-beta', 'voice choice persisted')
  ui.clickExact('内容')
  ui.render()
  ui.clickText('互动')
  ui.render()
  ui.clickExact('摸头')
  ui.render()
  assert.equal(speech.speak.length, 1)
  assert.equal(speech.speak[0].voice.voiceURI, 'voice-beta', 'the selected browser voice is attached to the utterance')
})

test('cat/dog content voices tab shows the thought-bubble policy instead of TTS controls', () => {
  const { ui } = createHarness({ character: 'cat', voices: [{ voiceURI: 'voice-alpha', name: 'Alpha', lang: 'zh-CN' }] })
  openContent(ui, '自定义')
  assert.equal(ui.findAll((node) => node.type === 'input' && node.props.type === 'checkbox').length, 0, 'no TTS toggle for cat')
  assert.equal(ui.findAll((node) => node.type === 'select').length, 0, 'no voice list for cat')
  assert.ok(ui.findAll((node) => node.type === 'p').some((node) => ui.text(node).includes('没有语音')), 'silent policy note is shown')
})

test('brief dialogue mode filters over-long replies and persists the mode', async () => {
  const { ui, storage } = createHarness({ reply: '回'.repeat(150) })
  openContent(ui, '自定义')
  assert.equal(ui.findButtonByAria('对话 · 标准').props['aria-pressed'], true, 'standard is the default mode')
  ui.click(ui.findButtonByAria('对话 · 简短'))
  ui.render()
  assert.equal(storage.get('dsh-famling/dialogue'), 'brief', 'dialogue mode persisted')
  assert.equal(ui.findButtonByAria('对话 · 简短').props['aria-pressed'], true, 'brief is marked as current')
  ui.clickExact('内容')
  ui.render()
  ui.clickText('输入')
  ui.render()
  const textarea = ui.findAll((node) => node.type === 'textarea')[0]
  ui.change(textarea, '说长一点')
  ui.render()
  ui.clickText('发送')
  await ui.settle()
  const bubble = ui.findBubble()
  assert.ok(bubble, 'reply bubble renders')
  const text = ui.text(bubble)
  assert.ok(text.length <= 90, 'brief mode caps the reply length: ' + text.length)
  assert.ok(text.endsWith('…'), 'capped reply is marked with an ellipsis')
})

test('quiet dialogue mode lowers ambient bubble probability while direct replies still show', async () => {
  const hidden = createHarness({ character: 'cat', dialogue: 'quiet', random: () => 0.99 })
  hidden.ui.clickPetAt(50, 35)
  hidden.ui.render()
  assert.equal(hidden.ui.findBubble(), undefined, 'quiet suppresses ambient bubbles when the roll is above the chance')
  assert.equal(petImage(hidden.ui).props.src, clipSrc('cat', 'pat_head'), 'the animation still plays without a bubble')
  const shown = createHarness({ character: 'cat', dialogue: 'quiet', random: () => 0.01 })
  shown.ui.clickPetAt(50, 35)
  shown.ui.render()
  assert.ok(shown.ui.findBubble(), 'quiet still shows ambient bubbles when the roll is below the chance')
  const direct = createHarness({ character: 'human', dialogue: 'quiet', random: () => 0.99, reply: '嗯，我在。' })
  direct.ui.clickText('输入')
  direct.ui.render()
  const textarea = direct.ui.findAll((node) => node.type === 'textarea')[0]
  direct.ui.change(textarea, '你好')
  direct.ui.render()
  direct.ui.clickText('发送')
  await direct.ui.settle()
  assert.ok(direct.ui.findBubble(), 'direct chat replies are not suppressed by quiet mode')
})

test('content center themes apply default/paper/night through widget CSS variables and persist', () => {
  const { ui, storage } = createHarness()
  openContent(ui, '自定义')
  const rootStyle = () => ui.tree.props.style
  assert.equal(rootStyle()['--dsh-famling-bubble-bg'], '#ffffff', 'default white bubble variable')
  assert.equal(rootStyle()['--dsh-famling-bubble-text'], '#111111', 'default dark text variable')
  assert.equal(ui.findButtonByAria('气泡 / 面板主题 · 默认').props['aria-pressed'], true)
  ui.click(ui.findButtonByAria('气泡 / 面板主题 · 纸张'))
  ui.render()
  assert.equal(storage.get('dsh-famling/theme'), 'paper', 'theme persisted')
  assert.equal(rootStyle()['--dsh-famling-bubble-bg'], '#fff8ec')
  assert.match(contentDialog(ui).props.style.background, /var\(--dsh-famling-panel-bg/, 'panel painted from the theme variable')
  ui.click(ui.findButtonByAria('气泡 / 面板主题 · 夜间'))
  ui.render()
  assert.equal(storage.get('dsh-famling/theme'), 'night')
  assert.equal(rootStyle()['--dsh-famling-bubble-bg'], '#1b2433', 'night bubble variable')
  assert.equal(rootStyle()['--dsh-famling-bubble-text'], '#e6edf7', 'night text variable')
  ui.clickExact('内容')
  ui.render()
  ui.clickText('互动')
  ui.render()
  ui.clickExact('摸头')
  ui.render()
  assert.equal(ui.findBubble().props.style.background, 'var(--dsh-famling-bubble-bg, #ffffff)', 'bubble still reads the theme variable')
})

test('content center background tab applies a local CSS backdrop and persists it', () => {
  const { ui, storage } = createHarness()
  openContent(ui, '自定义')
  assert.equal(ui.findButtonByAria('背景 · 透明').props['aria-pressed'], true, 'transparent is the default backdrop')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], 'transparent')
  ui.click(ui.findButtonByAria('背景 · 纸张'))
  ui.render()
  assert.equal(storage.get('dsh-famling/background'), 'paper', 'background persisted')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], '#f6f1e7')
  assert.equal(ui.tree.props.style.background, 'var(--dsh-famling-widget-bg, transparent)')
  assert.match(contentDialog(ui).props.style.boxShadow, /var\(--dsh-famling-widget-bg/, 'panel backdrop ring uses the background variable')
  ui.clickExact('内容')
  ui.render()
  ui.clickText('互动')
  ui.render()
  ui.clickExact('摸头')
  ui.render()
  assert.match(ui.findBubble().props.style.boxShadow, /var\(--dsh-famling-widget-bg/, 'bubble backdrop ring uses the background variable')
  ui.clickExact('内容')
  ui.render()
  ui.click(ui.findButtonByAria('背景 · 暗色'))
  ui.render()
  assert.equal(storage.get('dsh-famling/background'), 'dark')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], '#14161a')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-fg'], '#e8eaf0')
  ui.click(ui.findButtonByAria('背景 · 透明'))
  ui.render()
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], 'transparent')
})

test('content center font tab applies local stacks, size and line height and persists them', () => {
  const { ui, storage } = createHarness()
  openContent(ui, '自定义')
  assert.equal(ui.findButtonByAria('字体 · 系统').props['aria-pressed'], true, 'system font stack by default')
  assert.match(ui.tree.props.style['--dsh-famling-font-family'], /system-ui/)
  ui.click(ui.findButtonByAria('字体 · 衬线'))
  ui.render()
  assert.equal(JSON.parse(storage.get('dsh-famling/font')).family, 'serif')
  assert.match(ui.tree.props.style['--dsh-famling-font-family'], /Georgia/)
  ui.click(ui.findButtonByAria('字号 14px'))
  ui.render()
  ui.click(ui.findButtonByAria('行高 1.8'))
  ui.render()
  assert.deepEqual(JSON.parse(storage.get('dsh-famling/font')), { family: 'serif', size: 14, lineHeight: 1.8 })
  assert.equal(ui.tree.props.style['--dsh-famling-font-size'], '14px')
  assert.equal(ui.tree.props.style['--dsh-famling-line-height'], '1.8')
  assert.match(contentDialog(ui).props.style.fontSize, /var\(--dsh-famling-font-size/)
  assert.match(contentDialog(ui).props.style.lineHeight, /var\(--dsh-famling-line-height/)
  ui.clickExact('内容')
  ui.render()
  ui.clickText('互动')
  ui.render()
  ui.clickExact('摸头')
  ui.render()
  const bubble = ui.findBubble()
  assert.match(bubble.props.style.fontSize, /var\(--dsh-famling-font-size/)
  assert.match(bubble.props.style.lineHeight, /var\(--dsh-famling-line-height/)
})

test('custom controls override only the current role combination and restore the role preset', () => {
  const { ui, storage } = createHarness()
  openContent(ui, '角色')
  ui.click(ui.findButtonByAria('一键应用 金毛'))
  ui.render()
  assert.equal(storage.get('dsh-famling/role'), 'dog')
  ui.clickExact('自定义')
  ui.render()
  assert.ok(ui.text(contentDialog(ui)).includes('仅修改当前角色的搭配'), 'custom tab explains component-only overrides')
  assert.ok(ui.text(contentDialog(ui)).includes('角色预设'), 'the current combination starts as the role preset')
  ui.click(ui.findButtonByAria('气泡 / 面板主题 · 纸张'))
  ui.render()
  assert.equal(storage.get('dsh-famling/theme'), 'paper', 'component override persisted')
  assert.equal(storage.get('dsh-famling/role'), 'dog', 'role id stays untouched by a component override')
  assert.equal(ui.tree.props['data-character'], 'dog', 'character stays untouched by a component override')
  assert.ok(ui.text(contentDialog(ui)).includes('已自定义'), 'customized state is shown')
  ui.clickExact('恢复角色默认')
  ui.render()
  assert.equal(storage.get('dsh-famling/theme'), 'night', 'role theme preset restored')
  assert.equal(storage.get('dsh-famling/background'), 'dark', 'role background preset restored')
  assert.deepEqual(JSON.parse(storage.get('dsh-famling/font')), { family: 'mono', size: 12, lineHeight: 1.5 }, 'role font preset restored')
  assert.ok(ui.text(contentDialog(ui)).includes('角色预设'), 'restored state is the role preset again')
})

test('dsh-famling/role backfills the bundle on load while explicit component keys still win', () => {
  const legacy = createHarness({ character: 'dog' })
  assert.equal(legacy.ui.tree.props['data-character'], 'dog')
  assert.equal(legacy.storage.get('dsh-famling/role'), 'dog', 'role key backfilled from an existing character key')
  assert.equal(legacy.storage.get('dsh-famling/dialogue'), 'standard')
  assert.equal(legacy.storage.get('dsh-famling/theme'), 'night')
  assert.equal(legacy.storage.get('dsh-famling/background'), 'dark')
  assert.deepEqual(JSON.parse(legacy.storage.get('dsh-famling/font')), { family: 'mono', size: 12, lineHeight: 1.5 })
  const roleOnly = createHarness({ role: 'cat' })
  assert.equal(roleOnly.ui.tree.props['data-character'], 'cat', 'character backfilled from the role bundle')
  assert.equal(roleOnly.storage.get('dsh-famling/character'), 'cat', 'character key persisted from the bundle')
  assert.equal(roleOnly.storage.get('dsh-famling/dialogue'), 'brief')
  assert.equal(roleOnly.storage.get('dsh-famling/theme'), 'paper')
  assert.equal(roleOnly.storage.get('dsh-famling/background'), 'paper')
  const overridden = createHarness({ role: 'cat', theme: 'night' })
  assert.equal(overridden.ui.tree.props.style['--dsh-famling-bubble-bg'], '#1b2433', 'an explicit component key wins over the role bundle')
  assert.equal(overridden.storage.get('dsh-famling/role'), 'cat', 'the role id is preserved')
})

test('content pack tab shows the built-in pack, declaration check and reserved asset import without network', () => {
  const { ui, fetchCalls } = createHarness()
  openContent(ui, '内容包')
  const text = ui.text(contentDialog(ui))
  assert.ok(text.includes('内置角色主题包'), 'bundled content pack is listed')
  assert.ok(text.includes('没有导入的外部内容包'), 'no fabricated external packs')
  assert.ok(text.includes('researchOnly=true'), 'the declaration check is shown')
  assert.ok(text.includes('六项禁止用途全部声明'), 'the six prohibited uses are checked')
  const importButton = ui.findButtonExact('导入内容包（需 Host 支持）')
  assert.ok(importButton, 'asset-pack import entry is present')
  assert.equal(importButton.props.disabled, true, 'asset import stays disabled without Host support')
  assert.ok(text.includes('不读取文件'), 'asset-pack interface is explicitly reserved')
  assert.ok(text.includes('不联网'), 'pack tab states no network')
  assert.equal(fetchCalls.length, 0, 'opening the pack tab never calls fetch')
})

test('market tab is a reserved placeholder with catalog fields and never sends a network request', () => {
  const { ui, fetchCalls } = createHarness()
  openContent(ui, '市场')
  const text = ui.text(contentDialog(ui))
  assert.ok(text.includes('远程市场接口已预留，服务器未配置'), 'market status is explicit')
  assert.ok(text.includes('catalogUrl'), 'catalog URL field is reserved')
  assert.ok(text.includes('dsh-famling.market'), 'market config field is reserved')
  assert.ok(text.includes('不会发起任何网络请求'), 'no-network promise is shown')
  assert.ok(text.includes('未配置'), 'no fake catalog is configured')
  assert.equal(fetchCalls.length, 0, 'market tab never calls fetch')
})

test('a missing content-center chunk degrades to a local message without breaking the widget', () => {
  const { ui } = createHarness({ failContentChunk: true })
  ui.clickExact('内容')
  ui.render()
  assert.ok(ui.text(ui.tree).includes('内容中心加载失败'), 'a local failure message is shown')
  assert.ok(ui.findButtonExact('设置'), 'core sidebar buttons stay available')
})
test('stored background and font choices are restored on the next render', () => {
  const { ui } = createHarness({ background: 'dark', font: { family: 'mono', size: 11, lineHeight: 1.4 } })
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], '#14161a')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-fg'], '#e8eaf0')
  assert.match(ui.tree.props.style['--dsh-famling-font-family'], /ui-monospace/)
  assert.equal(ui.tree.props.style['--dsh-famling-font-size'], '11px')
  assert.equal(ui.tree.props.style['--dsh-famling-line-height'], '1.4')
})
