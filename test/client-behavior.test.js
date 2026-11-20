import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

import { dirname, join } from 'node:path'

import { CLIENT_PATH } from '../scripts/embed-anims.mjs'
import { loadClientData } from '../scripts/verify-anims.mjs'

const clientSource = readFileSync(CLIENT_PATH, 'utf8')
const embedded = loadClientData(clientSource)
// The shown version must follow package.json (the single version truth).
const PLUGIN_VERSION = JSON.parse(readFileSync(join(dirname(CLIENT_PATH), 'package.json'), 'utf8')).version
// MB-014: the entry pins the versioned consent declaration; seed records from it.
const CONSENT_ANCHOR = /const CONSENT_DECLARATION = \{ version: '([^']+)', hash: '([0-9a-f]{64})' \}/.exec(clientSource)
assert.ok(CONSENT_ANCHOR, 'client.js pins the versioned consent declaration')
const CONSENT_VERSION = CONSENT_ANCHOR[1]
const CONSENT_HASH = CONSENT_ANCHOR[2]
function consentRecord() { return { version: CONSENT_VERSION, hash: CONSENT_HASH, acceptedAt: '2026-05-01T04:00:00.000Z', withdrawn: false } }

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
    menuLabels() { return findAll((node) => node.type === 'button' && node.props.role === 'menuitem').map((node) => textOf(node)) },
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
  const consent = { tts: true, asr: false, ...(options.consent || {}) }
  if (options.legacyConsent !== undefined) {
    storage.set('dsh-famling/consent/v1', JSON.stringify(options.legacyConsent))
  } else if (options.consentRecords !== undefined) {
    storage.set('dsh-famling/consent/v2', JSON.stringify(options.consentRecords))
  } else {
    const records = { schema: 2 }
    if (consent.tts) records.tts = consentRecord()
    if (consent.asr) records.asr = consentRecord()
    storage.set('dsh-famling/consent/v2', JSON.stringify(records))
  }
  if (options.character) storage.set('dsh-famling/character', options.character)
  if (options.role) storage.set('dsh-famling/role', options.role)
  if (options.dialogue) storage.set('dsh-famling/dialogue', options.dialogue)
  if (options.theme) storage.set('dsh-famling/theme', options.theme)
  if (options.background) storage.set('dsh-famling/background', options.background)
  if (options.font) storage.set('dsh-famling/font', JSON.stringify(options.font))
  if (options.menu) storage.set('dsh-famling/menu', JSON.stringify(options.menu))
  if (options.hiddenUntil) storage.set('dsh-famling/hidden-until', String(options.hiddenUntil))
  // Most tests start after the one-time first-run notice was acknowledged; the
  // first-run tests opt out to exercise the fresh-install path.
  if (!options.firstRun) storage.set('dsh-famling/first-run/v1', '1')
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
    visibilityState: 'visible',
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
  }
  let definition = null
  const chunkDefinitions = new Map()
  // Deterministic clock: quiet hours/hide deadlines must not depend on the hour
  // the suite happens to run. Default is a daytime instant (quiet hours off).
  const RealDate = Date
  let currentNow = options.now ? new RealDate(options.now).getTime() : new RealDate(2026, 4, 1, 12, 0, 0, 0).getTime()
  function FakeDate(...args) { return args.length === 0 ? new RealDate(currentNow) : new RealDate(...args) }
  FakeDate.prototype = RealDate.prototype
  FakeDate.now = () => currentNow
  FakeDate.parse = RealDate.parse
  FakeDate.UTC = RealDate.UTC
  // Host hello/probe replies used by the capability handshake. A test can pass
  // hostHello: null for an older Host (404) or a function to shape one reply.
  const defaultHostHello = () => ({
    v: 2, ok: true, op: 'hello',
    plugin: { name: 'dsh-famling', version: options.hostPluginVersion || PLUGIN_VERSION },
    wire: { version: options.hostWireVersion || 2, min: 1, accepts: [1, 2] },
    contract: { bridge: 2, contentExtension: options.hostContentExtension || 3, contentExtensionSchema: 3 },
    host: { version: (options.bootRelease && options.bootRelease.version) || '0.2.2-rc.4', commit: null, source: 'client-boot' },
    client: { version: PLUGIN_VERSION, wireVersion: 2, contentExtension: 3 },
    capabilities: { llm: true, schedule: true, agentDefaultModel: true, brief: true, bridge: true, ...(options.hostCapabilities || {}) },
    probes: [], degraded: options.hostDegraded || [], compatible: options.hostCompatible !== false,
    versionMismatch: Boolean(options.hostPluginVersion && options.hostPluginVersion !== PLUGIN_VERSION),
  })
  const windowStub = {
    __DSH_BOOT__: options.bootRelease ? { release: options.bootRelease } : undefined,
    matchMedia(query) {
      return {
        matches: Boolean(options.reduceMotion) && String(query).includes('prefers-reduced-motion'),
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      }
    },
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
    addEventListener(type, fn) { windowListeners.set(type, fn) },
    removeEventListener(type) { windowListeners.delete(type) },
  }
  const windowListeners = new Map()
  const timers = { intervals: [], timeouts: [], cleared: 0 }
  const sandbox = {
    window: windowStub,
    localStorage,
    document: documentStub,
    navigator: { language: options.language || 'zh-CN' },
    Date: FakeDate,
    URL,
    SpeechSynthesisUtterance: class SpeechSynthesisUtterance { constructor(text) { this.text = text } },
    fetch: async (url, init) => {
      fetchCalls.push({ url: String(url), init })
      let payload = {}
      try { payload = JSON.parse(init && init.body) } catch {}
      if (payload.op === 'hello' || payload.op === 'probe') {
        const reply = typeof options.hostHello === 'function' ? options.hostHello(payload) : (options.hostHello === undefined ? defaultHostHello() : options.hostHello)
        if (!reply) return { ok: false, status: 404, async json() { return { v: 1, ok: false, code: 'E_OP', message: 'Unsupported operation.' } } }
        return { ok: true, async json() { return reply } }
      }
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
  const random = { fn: options.random || (() => 0) }
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
  // Business bridge calls only: the mount hello (and a manual probe) are the
  // capability handshake, not user data traffic.
  const businessCalls = () => fetchCalls.filter((call) => {
    try { const op = JSON.parse(call.init && call.init.body).op; return op !== 'hello' && op !== 'probe' } catch { return true }
  })
  return { ui, speech, fetchCalls, businessCalls, hostCalls: () => fetchCalls.filter((call) => businessCalls().indexOf(call) === -1), storage, timers, asyncCalls, module: moduleObject, document: documentStub, documentListeners: listeners, windowListeners, setRandom(fn) { random.fn = fn }, setNow(value) { currentNow = new RealDate(value).getTime() } }
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


/* ---------- minimal UI / right-click menu helpers (0.10.2) ---------- */
function menuNode(ui) { return ui.findAll((node) => node.type === 'div' && node.props.role === 'menu')[0] }
function menuItemNodes(ui) { return ui.findAll((node) => node.type === 'button' && node.props.role === 'menuitem') }
function menuLabels(ui) { return menuItemNodes(ui).map((node) => ui.text(node)) }
function activeMenuItem(ui) { return menuItemNodes(ui).find((node) => node.props.tabIndex === 0) }
function activeLabel(ui) { const node = activeMenuItem(ui); return node ? ui.text(node) : '' }
function openMenuAt(ui, x = 120, y = 200) {
  const pet = ui.findPetButton()
  assert.ok(pet, 'pet button exists')
  pet.props.onContextMenu({ preventDefault() {}, nativeEvent: { clientX: x, clientY: y } })
  ui.render()
  const node = menuNode(ui)
  assert.ok(node, 'menu is open')
  return node
}
function pressMenuKey(ui, key) {
  const node = menuNode(ui)
  assert.ok(node, 'menu is open for key ' + key)
  node.props.onKeyDown({ key, preventDefault() {} })
  ui.render()
}
function clickMenu(ui, label) {
  const node = menuItemNodes(ui).find((item) => ui.text(item).includes(label))
  assert.ok(node, 'menu item exists: ' + label)
  ui.click(node)
  ui.render()
}
function clickMenuItemExact(ui, label) {
  const node = menuItemNodes(ui).find((item) => ui.text(item) === label)
  assert.ok(node, 'menu item exists exactly: ' + label)
  ui.click(node)
  ui.render()
}
function openInputPanel(ui) { openMenuAt(ui); clickMenu(ui, '聊两句') }
function openInteractions(ui) { openMenuAt(ui); clickMenu(ui, '互动') }
function openContent(ui, tab) {
  openMenuAt(ui)
  clickMenu(ui, '内容与角色')
  if (tab) { ui.clickExact(tab); ui.render() }
}
function openSettings(ui) { openMenuAt(ui); clickMenu(ui, '设置') }
function contentDialog(ui) { return ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-label'] === '内容中心')[0] }
function settingsDialog(ui) { return ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-label'] === '设置')[0] }
function consentDialog(ui) { return ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-modal'] === true)[0] }
function closeActiveDialog(ui) { ui.click(ui.findButtonByAria('关闭')); ui.render() }
function checkboxByLabel(ui, label) {
  const wrap = ui.findAll((node) => node.type === 'label' && ui.text(node).includes(label))[0]
  assert.ok(wrap, 'checkbox row exists: ' + label)
  const input = wrap.children.find((child) => child && child.type === 'input' && child.props.type === 'checkbox')
  assert.ok(input, 'checkbox exists in row: ' + label)
  return input
}

/* ==================== minimal zero-button UI ==================== */
test('default render is Tinglan with the idle frame and zero buttons outside the character', () => {
  const { ui, speech, storage } = createHarness()
  assert.equal(ui.tree.props['data-character'], 'human')
  const image = petImage(ui)
  assert.ok(image, 'pet image renders')
  assert.equal(image.props.width, 72)
  assert.equal(image.props.height, 72)
  assert.equal(image.props.src, idleSrc('human'))
  assert.equal(image.props.style.imageRendering, 'pixelated')
  assert.equal(ui.findAll((node) => node.type === 'button').length, 1, 'the keyboard-focusable pet is the only permanent button')
  assert.equal(menuNode(ui), undefined, 'no menu is mounted before the user asks for it')
  const pet = ui.findPetButton()
  assert.equal(pet.props['aria-haspopup'], 'menu', 'pet advertises the menu')
  assert.equal(pet.props['aria-expanded'], false)
  assert.equal(typeof pet.props.onContextMenu, 'function', 'right click opens the menu')
  assert.equal(typeof pet.props.onKeyDown, 'function', 'keyboard can open the menu')
  assert.deepEqual(JSON.parse(storage.get('dsh-famling/menu')), { button: false }, 'menu button is off by default and persisted')
  assert.equal(speech.speak.length, 0, 'nothing is spoken before an interaction')
})

test('right click opens six level-one entries in the restrained order', () => {
  const { ui } = createHarness()
  const node = openMenuAt(ui)
  assert.equal(node.props.role, 'menu')
  assert.equal(node.props['aria-label'], '菜单')
  assert.deepEqual(menuLabels(ui), ['聊两句…', '互动 ▸', '内容与角色…', '设置…', '更多 ▸', '退出（隐藏，刷新恢复）'], 'six level-one items')
  assert.equal(menuItemNodes(ui)[0].props.tabIndex, 0, 'first item owns the roving tabIndex')
  assert.equal(menuItemNodes(ui)[1].props['aria-haspopup'], 'menu', '互动 declares a submenu')
  assert.equal(menuItemNodes(ui)[1].props['aria-expanded'], false)
  clickMenu(ui, '内容与角色')
  assert.equal(menuNode(ui), undefined, 'menu closes when a popup opens')
  assert.ok(contentDialog(ui), 'content center opens from level one')
})

test('Shift+F10 and the ContextMenu key open the menu; Escape and Tab close it', () => {
  const { ui } = createHarness({ character: 'cat' })
  ui.findPetButton().props.onKeyDown({ key: 'F10', shiftKey: true, preventDefault() {} })
  ui.render()
  assert.ok(menuNode(ui), 'Shift+F10 opens the menu')
  pressMenuKey(ui, 'Escape')
  assert.equal(menuNode(ui), undefined, 'Escape closes the menu')
  ui.findPetButton().props.onKeyDown({ key: 'ContextMenu', preventDefault() {} })
  ui.render()
  assert.ok(menuNode(ui), 'ContextMenu key opens the menu')
  pressMenuKey(ui, 'Tab')
  assert.equal(menuNode(ui), undefined, 'Tab closes the menu')
})

test('arrow keys, Home/End and Enter drive the menu with aria-activedescendant', () => {
  const { ui } = createHarness()
  const node = openMenuAt(ui)
  assert.equal(node.props['aria-activedescendant'], 'dsh-famling-menu-item-0')
  pressMenuKey(ui, 'ArrowDown')
  assert.equal(menuNode(ui).props['aria-activedescendant'], 'dsh-famling-menu-item-1')
  assert.equal(activeLabel(ui), '互动 ▸')
  pressMenuKey(ui, 'End')
  assert.equal(activeLabel(ui), '退出（隐藏，刷新恢复）')
  pressMenuKey(ui, 'ArrowDown')
  assert.equal(activeLabel(ui), '聊两句…', 'ArrowDown wraps around')
  pressMenuKey(ui, 'ArrowUp')
  assert.equal(activeLabel(ui), '退出（隐藏，刷新恢复）', 'ArrowUp wraps around')
  pressMenuKey(ui, 'Home')
  assert.equal(activeLabel(ui), '聊两句…')
  pressMenuKey(ui, 'Enter')
  assert.equal(menuNode(ui), undefined, 'Enter activates the focused item')
  assert.ok(ui.findAll((item) => item.type === 'textarea')[0], 'Enter opened the chat panel')
})

test('互动 and 更多 are second-level pages with a back item instead of crowded level one', () => {
  const { ui } = createHarness({ character: 'cat' })
  openInteractions(ui)
  const actionLabels = menuLabels(ui)
  assert.equal(actionLabels[0], '« 返回', 'submenu has a back item')
  for (const label of ['摸头', '伸懒腰', '洗脸', '追尾巴', '跑一跑']) assert.ok(actionLabels.includes(label), 'cat action in the submenu: ' + label)
  clickMenu(ui, '« 返回')
  assert.deepEqual(menuLabels(ui), ['聊两句…', '互动 ▸', '内容与角色…', '设置…', '更多 ▸', '退出（隐藏，刷新恢复）'], 'back returns to level one')
  clickMenu(ui, '更多')
  assert.deepEqual(menuLabels(ui), ['« 返回', '提醒…', '暂时隐藏 1 小时', '暂时隐藏到明天', '使用限制与版本'], 'more page stays restrained')
  clickMenu(ui, '使用限制与版本')
  const notice = ui.findAll((item) => item.type === 'div' && item.props.role === 'dialog' && item.props['aria-label'] === '使用限制与版本')[0]
  assert.ok(notice, 'usage notice popup opens')
  assert.ok(ui.text(notice).includes('研究'), 'notice carries the research-only restriction')
  assert.ok(ui.text(notice).includes(PLUGIN_VERSION), 'notice shows the plugin version from package.json')
  closeActiveDialog(ui)
  openMenuAt(ui)
  clickMenu(ui, '更多')
  clickMenu(ui, '提醒…')
  assert.ok(ui.findAll((item) => item.type === 'input' && item.props.type === 'datetime-local')[0], 'reminder form opens from 更多')
})

test('arrow left/right move between the root and a submenu page', () => {
  const { ui } = createHarness()
  openMenuAt(ui)
  pressMenuKey(ui, 'ArrowDown')
  pressMenuKey(ui, 'ArrowRight')
  assert.equal(menuLabels(ui)[0], '« 返回', 'ArrowRight opens the submenu')
  pressMenuKey(ui, 'ArrowLeft')
  assert.equal(menuLabels(ui)[0], '聊两句…', 'ArrowLeft goes back to the root page')
})

test('the fixed menu is clamped into the viewport with an 8px margin', () => {
  const { ui } = createHarness()
  openMenuAt(ui, 1390, 890)
  const style = menuNode(ui).props.style
  assert.equal(style.position, 'fixed')
  // six root items -> height 8 + 6*30 = 188, width 200, margin 8
  assert.equal(style.left, 1400 - 200 - 8, 'right edge is clamped')
  assert.equal(style.top, 900 - 188 - 8, 'bottom edge is clamped')
  pressMenuKey(ui, 'Escape')
  openMenuAt(ui, 4, 3)
  const topLeft = menuNode(ui).props.style
  assert.equal(topLeft.left, 8, 'left margin is kept')
  assert.equal(topLeft.top, 8, 'top margin is kept')
})

test('outside pointer down and window blur close the menu', () => {
  const { ui, documentListeners, windowListeners } = createHarness()
  openMenuAt(ui)
  assert.ok(menuNode(ui))
  documentListeners.get('pointerdown')({ target: {} })
  ui.render()
  assert.equal(menuNode(ui), undefined, 'pointer outside the menu closes it')
  openMenuAt(ui)
  assert.ok(menuNode(ui))
  windowListeners.get('blur')()
  ui.render()
  assert.equal(menuNode(ui), undefined, 'window blur closes it')
})
test('the menu button is off by default, can be enabled in settings and persists', () => {
  const first = createHarness()
  assert.equal(first.ui.findButtonByAria('菜单'), undefined, 'no ⋯ trigger before the user enables it')
  openSettings(first.ui)
  assert.ok(settingsDialog(first.ui), 'settings popup opens')
  const toggle = checkboxByLabel(first.ui, '显示菜单按钮')
  assert.equal(toggle.props.checked, false, 'menu button switch defaults to off')
  first.ui.change(toggle, true)
  first.ui.render()
  assert.equal(JSON.parse(first.storage.get('dsh-famling/menu')).button, true, 'trigger preference persisted')
  closeActiveDialog(first.ui)
  const trigger = first.ui.findButtonByAria('菜单')
  assert.ok(trigger, 'the small ⋯ trigger appears once enabled')
  assert.equal(trigger.props['aria-haspopup'], 'menu')
  trigger.props.onClick({ preventDefault() {} })
  first.ui.render()
  assert.ok(menuNode(first.ui), 'the ⋯ trigger opens the same menu')
  pressMenuKey(first.ui, 'Escape')
  const restored = createHarness({ menu: { button: true } })
  assert.ok(restored.ui.findButtonByAria('菜单'), 'enabled trigger is restored from dsh-famling/menu')
})

test('every open starts at level one and the submenu page is never sticky', () => {
  const { ui, storage } = createHarness()
  openMenuAt(ui)
  clickMenu(ui, '更多')
  assert.deepEqual(menuLabels(ui), ['« 返回', '提醒…', '暂时隐藏 1 小时', '暂时隐藏到明天', '使用限制与版本'])
  pressMenuKey(ui, 'Escape')
  assert.deepEqual(JSON.parse(storage.get('dsh-famling/menu')), { button: false }, 'only the trigger preference persists')
  openMenuAt(ui)
  assert.deepEqual(menuLabels(ui), ['聊两句…', '互动 ▸', '内容与角色…', '设置…', '更多 ▸', '退出（隐藏，刷新恢复）'], 'reopening always shows level one')
})

test('settings popup centralizes every adjustable item and folds advanced/debug', () => {
  const { ui } = createHarness({ voices: [{ voiceURI: 'voice-alpha', name: 'Alpha', lang: 'zh-CN' }] })
  openSettings(ui)
  const dialog = settingsDialog(ui)
  assert.ok(dialog, 'settings dialog renders from the lazy chunk')
  const full = ui.text(dialog)
  for (const label of ['常用', '说话气泡', '显示菜单按钮', '低打扰', '安静时段', '动画偏好', '跟随系统', '允许动画', '减少动态', '隐藏 1 小时', '隐藏到明天', '数据与边界', 'AI 聊天', '清除本机设置与同意', '声音', '读取 Advisers 摘要', '外观', '对话', '气泡 / 面板主题', '背景', '字体', '字号', '行高', '角色与内容', '内容与角色…', '恢复角色默认', '高级 / 调试']) {
    assert.ok(full.includes(label), 'settings includes: ' + label)
  }
  assert.ok(full.includes('研究'), 'usage restriction stays visible')
  assert.equal(ui.findAll((node) => node.type === 'input' && node.props.type === 'checkbox').length, 1 + 1 + 1 + 1 + 1, 'sound + bubble + menu button + AI chat + quiet hours')
  assert.ok(ui.findAll((node) => node.type === 'select')[0], 'voice list lives in settings')
  const advanced = ui.findAll((node) => node.type === 'button' && ui.text(node).includes('高级 / 调试'))[0]
  assert.equal(advanced.props['aria-expanded'], false, 'advanced group is folded by default')
  assert.ok(!full.includes('dsh-famling/menu'), 'debug storage keys are hidden while folded')
  ui.click(advanced)
  ui.render()
  const expanded = ui.text(settingsDialog(ui))
  assert.ok(expanded.includes('本地存储键'), 'advanced/debug group expands')
  assert.ok(expanded.includes('dsh-famling/menu'), 'debug lists the storage keys')
  assert.ok(expanded.includes(PLUGIN_VERSION), 'advanced shows the version from package.json')
})

test('settings toggles persist and the content entry opens the content center', () => {
  const { ui, storage } = createHarness()
  openSettings(ui)
  const bubble = checkboxByLabel(ui, '说话气泡')
  assert.equal(bubble.props.checked, true, 'bubble starts enabled in the harness')
  ui.change(bubble, false)
  ui.render()
  assert.equal(JSON.parse(storage.get('dsh-famling/settings')).bubble, false, 'bubble persists through the settings popup')
  ui.click(ui.findButtonExact('允许动画'))
  ui.render()
  assert.equal(JSON.parse(storage.get('dsh-famling/settings')).motionMode, 'on', 'animation preference persists through the settings popup')
  const themeButton = ui.findButtonByAria('气泡 / 面板主题 · 纸张')
  assert.ok(themeButton, 'theme presets live in settings too')
  ui.click(themeButton)
  ui.render()
  assert.equal(storage.get('dsh-famling/theme'), 'paper', 'theme persists from settings')
  ui.click(ui.findButtonExact('内容与角色…'))
  ui.render()
  assert.ok(contentDialog(ui), 'content center opens from the settings popup')
})

test('enabling voice from settings shows the consent dialog and only then saves sound', () => {
  const { ui, storage } = createHarness({ consent: { tts: false }, settings: { sound: false } })
  openSettings(ui)
  ui.change(checkboxByLabel(ui, '声音'), true)
  ui.render()
  const consent = ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-modal'] === true)[0]
  assert.ok(consent, 'TTS consent dialog is mounted')
  assert.ok(ui.text(consent).includes('独立确认'), 'consent explains the browser voice and the independent confirmation')
  assert.equal(JSON.parse(storage.get('dsh-famling/settings')).sound, false, 'sound stays off before consent')
  ui.click(ui.findButtonExact('同意并开启'))
  ui.render()
  assert.equal(JSON.parse(storage.get('dsh-famling/settings')).sound, true, 'sound is enabled after consent')
})

test('English menu localizes level one and the species action submenu', () => {
  const { ui } = createHarness({ language: 'en-US' })
  openMenuAt(ui)
  assert.deepEqual(menuLabels(ui), ['Chat…', 'Play ▸', 'Content & characters…', 'Settings…', 'More ▸', 'Quit (hide; refresh to restore)'])
  clickMenu(ui, 'Play')
  for (const label of ['Pat', 'Hand paper', 'Wave', 'Fix bow', 'Chat']) assert.ok(menuLabels(ui).includes(label), 'en action label: ' + label)
  openMenuAt(ui)
  clickMenu(ui, 'Settings')
  const englishSettings = ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-label'] === 'Settings')[0]
  assert.ok(englishSettings, 'English settings dialog opens')
  assert.ok(ui.text(englishSettings).includes('Show menu button'), 'English menu button switch')
})

/* ==================== E7 剩余 / P-04: low disturbance ==================== */
test('mute only silences the voice: captions stay and a running utterance is cancelled', () => {
  const harness = createHarness({ settings: { sound: true }, consent: { tts: true } })
  openInteractions(harness.ui)
  harness.ui.click(harness.ui.findButtonExact('摸头'))
  harness.ui.render()
  assert.equal(harness.speech.speak.length, 1, 'an explicit action speaks while unmuted')
  assert.ok(harness.ui.findBubble(), 'the caption bubble is shown')
  openSettings(harness.ui)
  harness.ui.change(checkboxByLabel(harness.ui, '声音'), false)
  harness.ui.render()
  assert.equal(storedSettings(harness).sound, false, 'mute persists')
  assert.ok(harness.speech.cancel >= 1, 'a running utterance is cancelled immediately on mute')
  closeActiveDialog(harness.ui)
  const spoken = harness.speech.speak.length
  harness.ui.clickPetAt(50, 35)
  harness.ui.render()
  assert.ok(harness.ui.findBubble(), 'captions remain visible while muted')
  assert.equal(harness.speech.speak.length, spoken, 'no new TTS utterance while muted')
})

function localTime(hours, minutes) { return new Date(2026, 4, 1, hours, minutes, 0, 0) }
function storedSettings(harness) { return JSON.parse(harness.storage.get('dsh-famling/settings')) }
function microTimer(harness) { return [...harness.timers.timeouts].reverse().find((timer) => timer.ms >= 60000 && timer.ms <= 90000) }
function idleFrameDelay(harness) {
  const idle = embedded.ANIMS.human.clips.idle
  return Math.max(30, Math.round(1000 / (idle.fps || 6)))
}
function hasFrameTimer(harness) { return harness.timers.timeouts.some((timer) => timer.ms === idleFrameDelay(harness)) }

test('quiet hours default 22:00-08:00 and the settings popup shows the pinned state', () => {
  const quiet = createHarness({ now: localTime(23, 0) })
  openSettings(quiet.ui)
  const quietText = quiet.ui.text(settingsDialog(quiet.ui))
  assert.ok(quietText.includes('低打扰'), 'low-disturb group is in the unified settings popup')
  assert.ok(quietText.includes('安静时段'), 'quiet-hours control')
  assert.ok(quietText.includes('当前在安静时段内'), 'status reflects the 23:00 clock')
  assert.equal(storedSettings(quiet).quietHours.enabled, true, 'quiet hours default on')
  assert.equal(storedSettings(quiet).quietHours.start, '22:00')
  assert.equal(storedSettings(quiet).quietHours.end, '08:00')
  closeActiveDialog(quiet.ui)
  const day = createHarness({ now: localTime(12, 0) })
  openSettings(day.ui)
  assert.ok(day.ui.text(settingsDialog(day.ui)).includes('当前不在安静时段'), 'daytime status is explicit')
})

test('quiet hours toggle and time inputs persist; malformed times keep the previous value', () => {
  const harness = createHarness({ now: localTime(12, 0) })
  openSettings(harness.ui)
  const toggle = checkboxByLabel(harness.ui, '开启安静时段')
  assert.equal(toggle.props.checked, true, 'default on')
  harness.ui.change(toggle, false)
  harness.ui.render()
  assert.equal(storedSettings(harness).quietHours.enabled, false, 'disable persists')
  assert.ok(harness.ui.text(settingsDialog(harness.ui)).includes('已关闭'), 'off status is explicit')
  harness.ui.change(toggle, true)
  harness.ui.render()
  const timeInput = (label) => harness.ui.findAll((node) => node.type === 'input' && node.props.type === 'time' && String(node.props['aria-label'] || '').includes(label))[0]
  harness.ui.change(timeInput('开始'), '21:30')
  harness.ui.render()
  harness.ui.change(timeInput('结束'), '07:15')
  harness.ui.render()
  assert.deepEqual(storedSettings(harness).quietHours, { enabled: true, start: '21:30', end: '07:15' }, 'custom window persists')
  harness.ui.change(timeInput('开始'), '')
  harness.ui.render()
  assert.equal(storedSettings(harness).quietHours.start, '21:30', 'an empty/invalid time does not reset the window')
  assert.equal(timeInput('开始').props.value, '21:30', 'the controlled input keeps the stored value')
})

test('quiet hours stop automatic micro actions but explicit taps still answer', () => {
  const quiet = createHarness({ now: localTime(23, 0), settings: { motion: true } })
  const idle = petImage(quiet.ui).props.src
  const timer = microTimer(quiet)
  assert.ok(timer, 'a micro-action timer is scheduled')
  timer.fn()
  quiet.ui.render()
  assert.equal(petImage(quiet.ui).props.src, idle, 'no automatic micro action during quiet hours')
  assert.ok(microTimer(quiet) && microTimer(quiet) !== timer, 'the timer re-checks and retries after the window')
  quiet.ui.clickPetAt(50, 35)
  quiet.ui.render()
  assert.ok(quiet.ui.findBubble(), 'a user tap still answers during quiet hours')
  const day = createHarness({ now: localTime(12, 0), settings: { motion: true } })
  const dayIdle = petImage(day.ui).props.src
  const dayTimer = microTimer(day)
  assert.ok(dayTimer)
  dayTimer.fn()
  day.ui.render()
  assert.notEqual(petImage(day.ui).props.src, dayIdle, 'micro actions play outside quiet hours')
})

test('motion preference follows prefers-reduced-motion by default and explicit on/off wins', () => {
  const reducedAuto = createHarness({ reduceMotion: true, settings: { motionMode: 'auto' } })
  assert.equal(hasFrameTimer(reducedAuto), false, 'auto + reduce -> frame animation off')
  const plainAuto = createHarness({ reduceMotion: false, settings: { motionMode: 'auto' } })
  assert.ok(hasFrameTimer(plainAuto), 'auto + no reduce -> frame animation on')
  const forcedOn = createHarness({ reduceMotion: true, settings: { motionMode: 'on' } })
  assert.ok(hasFrameTimer(forcedOn), 'explicit on overrides the system preference')
  const forcedOff = createHarness({ reduceMotion: false, settings: { motionMode: 'off' } })
  assert.equal(hasFrameTimer(forcedOff), false, 'explicit off overrides the system preference')
  assert.equal(storedSettings(forcedOff).motionMode, 'off', 'explicit preference persists')
  // Legacy boolean migration: motion:false -> off, motion:true -> auto.
  assert.equal(storedSettings(createHarness()).motionMode, 'off', 'legacy motion:false migrates to off')
  const legacyOn = createHarness({ reduceMotion: false, settings: { motion: true } })
  assert.equal(storedSettings(legacyOn).motionMode, 'auto', 'legacy motion:true migrates to auto')
  assert.ok(hasFrameTimer(legacyOn), 'migrated auto respects the system (no reduce here)')
})

test('settings exposes the animation preference with the system state and persists a choice', () => {
  const harness = createHarness({ reduceMotion: true, settings: { motionMode: 'auto' } })
  openSettings(harness.ui)
  const text = harness.ui.text(settingsDialog(harness.ui))
  assert.ok(text.includes('动画偏好'), 'animation preference row')
  assert.ok(text.includes('系统已请求减少动态'), 'system preference is disclosed')
  assert.ok(text.includes('减少动态'), 'the effective state is visible')
  const offChoice = harness.ui.findButtonByAria('动画偏好 · 减少动态')
  assert.equal(offChoice.props['aria-pressed'], false, 'auto is not the same as explicit off')
  harness.ui.click(harness.ui.findButtonExact('允许动画'))
  harness.ui.render()
  assert.equal(storedSettings(harness).motionMode, 'on', 'explicit allow persists')
  assert.ok(hasFrameTimer(harness), 'the animation starts after choosing allow')
})

test('temporary hide persists a deadline, shows one restore control and restores early', () => {
  const now = localTime(12, 0)
  const harness = createHarness({ now })
  openMenuAt(harness.ui)
  clickMenu(harness.ui, '更多')
  clickMenu(harness.ui, '暂时隐藏 1 小时')
  assert.equal(harness.ui.findPetButton(), undefined, 'the pet is hidden')
  const restore = harness.ui.findButtonByAria('显示')
  assert.ok(restore, 'one visible/keyboard restore control replaces the pet')
  assert.equal(Number(harness.storage.get('dsh-famling/hidden-until')), now.getTime() + 3600000, 'hidden deadline persisted')
  harness.ui.click(restore)
  harness.ui.render()
  assert.ok(harness.ui.findPetButton(), 'restore brings the pet back')
  assert.equal(harness.storage.has('dsh-famling/hidden-until'), false, 'early restore clears the deadline')
})

test('hide until tomorrow targets the next quiet-hours end and auto-restores at the deadline', () => {
  const now = localTime(12, 0)
  const harness = createHarness({ now })
  openMenuAt(harness.ui)
  clickMenu(harness.ui, '更多')
  clickMenu(harness.ui, '暂时隐藏到明天')
  const deadline = new Date(Number(harness.storage.get('dsh-famling/hidden-until')))
  assert.equal(deadline.getDate(), 2, 'tomorrow')
  assert.equal(deadline.getHours(), 8, 'quiet-hours end 08:00')
  const timer = harness.timers.timeouts.find((item) => item.ms === deadline.getTime() - now.getTime())
  assert.ok(timer, 'auto-restore timer is scheduled for the deadline')
  timer.fn()
  harness.ui.render()
  assert.ok(harness.ui.findPetButton(), 'the pet comes back at the deadline')
  assert.equal(harness.storage.has('dsh-famling/hidden-until'), false, 'expired deadline is cleared')
})

test('a stored future hidden deadline is restored on the next mount', () => {
  const now = localTime(12, 0)
  const harness = createHarness({ now, hiddenUntil: now.getTime() + 120000 })
  assert.equal(harness.ui.findPetButton(), undefined, 'reload keeps the pet hidden')
  assert.ok(harness.ui.findButtonByAria('显示'), 'restore control is available after reload')
  const expired = createHarness({ now, hiddenUntil: now.getTime() - 1000 })
  assert.ok(expired.ui.findPetButton(), 'an expired stored deadline does not hide the pet')
})

test('settings can start a temporary hide and the same restore control recovers it', () => {
  const harness = createHarness({ now: localTime(12, 0) })
  openSettings(harness.ui)
  harness.ui.click(harness.ui.findButtonExact('隐藏 1 小时'))
  harness.ui.render()
  assert.equal(harness.ui.findPetButton(), undefined, 'hiding from settings works')
  const restore = harness.ui.findButtonByAria('显示')
  assert.ok(restore)
  harness.ui.click(restore)
  harness.ui.render()
  assert.ok(harness.ui.findPetButton(), 'restored')
})

/* ==================== existing animation / interaction behavior ==================== */
test('idle loop advances frame by frame using the per-frame delays', () => {
  const { ui, timers } = createHarness({ character: 'cat', settings: { motion: true } })
  const idle = embedded.ANIMS.cat.clips.idle
  const expectedDelay = Math.max(30, Math.round(1000 / (idle.fps || 6)))
  for (let frame = 1; frame < idle.frames.length; frame += 1) {
    const timer = [...timers.timeouts].reverse().find((item) => item.ms === expectedDelay)
    assert.ok(timer, 'idle frame timeout is scheduled')
    timer.fn()
    ui.render()
    assert.equal(petImage(ui).props.src, clipSrc('cat', 'idle', frame), 'idle frame ' + frame)
  }
  runTimeout(ui, timers, expectedDelay)
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'idle', 0), 'idle loop wraps back to frame 0')
})

test('content center exposes exactly four first-level tabs and role bundles are the theme', () => {
  const { ui } = createHarness()
  openContent(ui, '角色')
  const tabs = ui.findAll((node) => node.type === 'button' && node.props.role === 'tab').map((node) => ui.text(node))
  assert.deepEqual(tabs, ['角色', '自定义', '内容包', '市场'], 'four first-level tabs only')
  const text = ui.text(contentDialog(ui))
  assert.ok(text.includes('角色就是主题'), 'the role-is-theme model is explained')
  assert.ok(text.includes('声音: 浏览器 TTS'), 'role card shows the voice summary')
  assert.ok(text.includes('外观: 默认 / 透明 / 系统'), 'human role card shows the default appearance')
  for (const oldTab of ['声音', '对话', '主题', '背景', '字体']) {
    const row = ui.findAll((node) => node.type === 'button' && node.props.role === 'tab' && ui.text(node) === oldTab)
    assert.equal(row.length, 0, 'old six-category tab is gone: ' + oldTab)
  }
})

test('English content center localizes the tabs, role apply and market placeholder', () => {
  const { ui } = createHarness({ language: 'en-US' })
  openMenuAt(ui)
  clickMenu(ui, 'Content & characters')
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

test('one-click role applies character + voice + dialogue + theme/background/font atomically', () => {
  const { ui, speech, storage } = createHarness()
  openContent(ui, '角色')
  assert.ok(ui.text(contentDialog(ui)).includes('✓ 当前'), 'the current role is marked')
  ui.click(ui.findButtonByAria('一键应用 布偶猫'))
  ui.render()
  assert.equal(ui.tree.props['data-character'], 'cat', 'character component applied')
  assert.equal(storage.get('dsh-famling/role'), 'cat', 'role bundle persisted')
  assert.equal(storage.get('dsh-famling/character'), 'cat')
  assert.equal(storage.get('dsh-famling/dialogue'), 'standard', 'cat bundle dialogue is standard (shared rolePresets)')
  assert.equal(storage.get('dsh-famling/theme'), 'night', 'cat bundle theme is night')
  assert.equal(storage.get('dsh-famling/background'), 'transparent', 'cat bundle background is transparent')
  assert.deepEqual(JSON.parse(storage.get('dsh-famling/font')), { family: 'serif', size: 12, lineHeight: 1.5 }, 'cat bundle font is serif')
  assert.equal(ui.tree.props.style['--dsh-famling-bubble-bg'], '#1b2433', 'night bubble variable is live')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], 'transparent', 'transparent backdrop keeps the host behind the pet visible')
  assert.match(ui.tree.props.style['--dsh-famling-font-family'], /Georgia/, 'serif font variable is live')
  assert.equal(ui.findPetButton().props['aria-label'], '布偶猫')
  assert.equal(petImage(ui).props.src, idleSrc('cat'))
  assert.equal(speech.speak.length, 0, 'a silent role policy never speaks')
  assert.ok(speech.cancel >= 1, 'switching to a silent role cancels browser speech')
  assert.ok(ui.text(contentDialog(ui)).includes('✓ 当前'), 'the current marker moves with the bundle')
})

test('role application never bypasses the TTS consent gate', () => {
  const consented = createHarness()
  openContent(consented.ui, '角色')
  consented.ui.click(consented.ui.findButtonByAria('一键应用 布偶猫'))
  consented.ui.render()
  assert.equal(JSON.parse(consented.storage.get('dsh-famling/settings')).sound, false, 'a silent role turns sound off')
  consented.ui.click(consented.ui.findButtonByAria('一键应用 汀岚'))
  consented.ui.render()
  assert.equal(JSON.parse(consented.storage.get('dsh-famling/settings')).sound, true, 'a speech role turns sound on when TTS is consented')
  const noConsent = createHarness({ consent: { tts: false } })
  openContent(noConsent.ui, '角色')
  noConsent.ui.click(noConsent.ui.findButtonByAria('一键应用 布偶猫'))
  noConsent.ui.render()
  noConsent.ui.click(noConsent.ui.findButtonByAria('一键应用 汀岚'))
  noConsent.ui.render()
  assert.equal(JSON.parse(noConsent.storage.get('dsh-famling/settings')).sound, false, 'the consent gate is never bypassed')
})

test('role cards keep glyph avatars and load only the applied character chunk', () => {
  const { ui, asyncCalls } = createHarness()
  openContent(ui, '角色')
  const animCalls = asyncCalls.filter((name) => name.startsWith('client.anims.'))
  assert.deepEqual(animCalls, ['client.anims.human.js'], 'only the current role chunk is loaded before applying a role')
  assert.ok(asyncCalls.includes('client.content.js'), 'the content/settings UI chunk loads on first panel open')
  assert.equal(ui.findAll((node) => node.type === 'span' && node.props['aria-hidden'] === true && ['🧑', '🐱', '🐶'].includes(ui.text(node))).length >= 3, true, 'role cards keep their glyph avatars')
  ui.click(ui.findButtonByAria('一键应用 金毛'))
  ui.render()
  assert.ok(asyncCalls.includes('client.anims.dog.js'), 'the applied role chunk is lazy-loaded')
  assert.equal(asyncCalls.includes('client.anims.cat.js'), false, 'unapplied role chunks stay unloaded')
})

test('cat submenu is species-specific (no ball/fetch) and bubbles stay silent thoughts', () => {
  const { ui, speech } = createHarness({ character: 'cat' })
  assert.equal(ui.tree.props['data-character'], 'cat')
  openInteractions(ui)
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
  assert.equal(speech.speak.length, 0, 'cat must never call speechSynthesis')
})

test('human submenu keeps solid speech plus TTS lines from the action says', () => {
  const { ui, speech } = createHarness()
  openInteractions(ui)
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

test('dog submenu exposes fetch/retrieve and chains ball_throw -> ball_chase', () => {
  const { ui, speech, timers } = createHarness({ character: 'dog' })
  openInteractions(ui)
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

test('cat stand_wag plays its 10 authored holdMs frames over 3200ms', () => {
  const { ui, timers } = createHarness({ character: 'cat', settings: { motion: true } })
  openInteractions(ui)
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
  const { ui, businessCalls } = createHarness()
  async function typeAndSend(text) {
    const textarea = ui.findAll((node) => node.type === 'textarea')[0]
    assert.ok(textarea, 'chat input panel is open')
    ui.change(textarea, text)
    ui.render()
    ui.clickText('发送')
    await ui.settle()
  }
  function pickCharacter(name) {
    openContent(ui, '角色')
    ui.click(ui.findButtonByAria('一键应用 ' + name))
    ui.render()
    closeActiveDialog(ui)
  }
  openInputPanel(ui)
  await typeAndSend('你好')
  pickCharacter('布偶猫')
  openInputPanel(ui)
  await typeAndSend('今天好懒')
  pickCharacter('金毛')
  openInputPanel(ui)
  await typeAndSend('去玩球')
  assert.equal(ui.tree.props['data-character'], 'dog')
  assert.deepEqual(businessCalls().map((call) => JSON.parse(call.init.body).character), ['human', 'cat', 'dog'])
})

test('chat bridge still works from the menu-driven input panel (op:chat, same endpoint)', async () => {
  const { ui, businessCalls, speech } = createHarness({ reply: '嗯，我在。' })
  openInputPanel(ui)
  const textarea = ui.findAll((node) => node.type === 'textarea')[0]
  ui.change(textarea, '你好')
  ui.render()
  ui.clickText('发送')
  await ui.settle()
  assert.equal(businessCalls().length, 1)
  assert.match(businessCalls()[0].url, /\/api\/famling\/bridge$/)
  const payload = JSON.parse(businessCalls()[0].init.body)
  assert.deepEqual(payload, { v: 1, op: 'chat', text: '你好', character: 'human' })
  const bubble = ui.findBubble()
  assert.ok(bubble)
  assert.equal(ui.text(bubble), '嗯，我在。')
  assert.equal(speech.speak.length, 1, 'human reply is read aloud under TTS consent')
})

// Art-canvas points (96x96) inside each character's head/body/tail region.
const REGION_CASES = {
  human: { head: { point: [51, 27], clip: 'pat_head' }, body: { point: [48, 66], clip: 'stand_wag' }, tail: { point: [74, 72], clip: 'chase_tail' } },
  cat: { head: { point: [50, 35], clip: 'pat_head' }, body: { point: [50, 69], clip: 'stand_wag' }, tail: { point: [81, 69], clip: 'chase_tail' } },
  dog: { head: { point: [50, 31], clip: 'pat_head' }, body: { point: [49, 68], clip: 'stand_wag' }, tail: { point: [83, 67], clip: 'chase_tail' } },
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
  const { ui, timers, setNow } = createHarness({ character: 'cat', settings: { motion: true } })
  ui.clickPetAt(50, 35)
  ui.render()
  const says = regionSays('cat', 'head')
  const first = ui.text(ui.findBubble())
  assert.ok(says.includes(first), 'first head line comes from head says')
  finishClip(ui, timers, 'cat', 'pat_head')
  // The repeat-tap cooldown is 1.2s, so the second tap happens in real time.
  setNow(new Date(2026, 4, 1, 12, 0, 2, 0))
  ui.clickPetAt(50, 35)
  ui.render()
  const second = ui.text(ui.findBubble())
  assert.ok(says.includes(second), 'second head line comes from head says')
  assert.notEqual(second, first, 'the same region does not repeat the same line on the next tap')
})

test('clicking the same submenu action twice also changes the random line', () => {
  const { ui } = createHarness()
  openInteractions(ui)
  const says = actionSays('human', 'pat')
  ui.clickExact('摸头')
  ui.render()
  const first = ui.text(ui.findBubble())
  openInteractions(ui)
  ui.clickExact('摸头')
  ui.render()
  const second = ui.text(ui.findBubble())
  assert.ok(says.includes(first) && says.includes(second), 'both lines come from the action says')
  assert.notEqual(second, first, 'menu action lines do not repeat back to back')
})

test('talk action is bubble-only and keeps the idle animation', () => {
  const { ui, speech } = createHarness()
  openInteractions(ui)
  const says = actionSays('human', 'talk')
  clickMenuItemExact(ui, '聊两句')
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
  openInteractions(ui)
  ui.clickExact('摸头')
  ui.render()
  const playing = petImage(ui).props.src
  const playingBubble = ui.text(ui.findBubble())
  assert.equal(playing, clipSrc('human', 'pat_head'), 'pat_head clip is playing')
  ui.clickPetAt(74, 72)
  ui.render()
  assert.equal(petImage(ui).props.src, playing, 'animation is unchanged while non-idle')
  assert.equal(ui.text(ui.findBubble()), playingBubble, 'bubble is unchanged while non-idle')
  assert.equal(speech.speak.length, 1, 'no extra narration while non-idle')
})

test('a tap outside every region is a no-op', () => {
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

test('a hidden tab pauses frame scheduling and resumes on the idle clip', () => {
  const harness = createHarness({ character: 'cat', settings: { motion: true } })
  const { ui, documentListeners, timers } = harness
  const pet = () => petImage(ui).props.src
  assert.equal(pet(), idleSrc('cat'), 'the idle clip starts on the first frame')
  ui.clickPetAt(50, 35)
  ui.render()
  assert.equal(pet(), clipSrc('cat', 'pat_head'), 'a region clip is playing before the tab hides')
  const staleTimers = timers.timeouts.slice()
  const scheduled = timers.timeouts.length
  harness.document.visibilityState = 'hidden'
  documentListeners.get('visibilitychange')()
  ui.render()
  const frozen = pet()
  for (const timer of staleTimers) timer.fn()
  ui.render()
  assert.equal(pet(), frozen, 'frame timers left over from before the hide never repaint')
  assert.equal(timers.timeouts.length, scheduled, 'no frame timer is re-armed while hidden')
  harness.document.visibilityState = 'visible'
  documentListeners.get('visibilitychange')()
  ui.render()
  assert.equal(pet(), idleSrc('cat'), 'resuming shows the idle clip, not the interrupted one')
  assert.ok(timers.timeouts.length > scheduled, 'frame scheduling resumes when the tab is visible again')
})

test('repeat region taps are coalesced and saturate into the subtle blink reaction', () => {
  const { ui, timers, setNow } = createHarness({ character: 'cat', settings: { motion: true } })
  const start = new Date(2026, 4, 1, 12, 0, 0, 0).getTime()
  const at = (offset) => setNow(start + offset)
  // Region taps only react from idle, so each full clip is played to its end.
  const tap = () => { ui.clickPetAt(50, 35); ui.render() }
  tap()
  finishClip(ui, timers, 'cat', 'pat_head')
  const says = regionSays('cat', 'head')
  const first = ui.text(ui.findBubble())
  assert.ok(says.includes(first), 'the first tap answers with the region clip and line')
  at(300)
  tap()
  assert.equal(ui.text(ui.findBubble()), first, 'a repeat tap inside 1.2s is ignored')
  at(1300)
  tap()
  finishClip(ui, timers, 'cat', 'pat_head')
  assert.notEqual(ui.text(ui.findBubble()), first, 'after 1.2s the tap answers with a fresh line')
  at(2600)
  tap()
  finishClip(ui, timers, 'cat', 'pat_head')
  at(3900)
  tap()
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'idle_blink'), 'the 4th tap in 10s degrades to the existing blink clip')
  const saturated = ui.text(ui.findBubble())
  assert.ok(says.includes(saturated), 'the saturated reaction keeps an existing region line')
  finishClip(ui, timers, 'cat', 'idle_blink')
  at(5000)
  tap()
  assert.equal(ui.text(ui.findBubble()), saturated, 'saturated taps coalesce for 2.5s')
  at(6400)
  tap()
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'idle_blink'), 'saturated taps keep the subtle reaction')
})

test('menu actions always answer while region taps are cooling down', () => {
  const { ui, setNow } = createHarness({ character: 'cat', settings: { motion: true } })
  const tap = () => { ui.clickPetAt(50, 35); ui.render() }
  tap()
  tap()
  setNow(new Date(2026, 4, 1, 12, 0, 5, 0))
  openInteractions(ui)
  const says = actionSays('cat', 'pat')
  clickMenuItemExact(ui, '摸头')
  assert.equal(petImage(ui).props.src, clipSrc('cat', 'pat_head'), 'the menu action always plays its clip')
  assert.ok(says.includes(ui.text(ui.findBubble())), 'the menu action always answers with its line')
})

test('a missing lazy chunk degrades to the transparent placeholder and the menu still works', () => {
  const { ui } = createHarness({ character: 'cat', failChunks: ['client.anims.cat.js'] })
  assert.match(petImage(ui).props.src, /^data:image\/png;base64,iVBORw0KGgo/, 'placeholder pixel keeps the slot')
  assert.equal(ui.findAll((node) => node.type === 'button').length, 1, 'no stray buttons without the chunk')
  openMenuAt(ui)
  assert.equal(menuItemNodes(ui).length, 6, 'right-click menu still opens')
  assert.equal(ui.findBubble(), undefined, 'no fabricated content while the chunk is missing')
})

test('content center voices list persists the browser voice and uses it for speech', () => {
  const voices = [
    { voiceURI: 'voice-alpha', name: 'Alpha', lang: 'zh-CN' },
    { voiceURI: 'voice-beta', name: 'Beta', lang: 'en-US' },
  ]
  const { ui, speech, storage } = createHarness({ voices })
  openContent(ui, '自定义')
  const select = ui.findAll((node) => node.type === 'select' && node.props['aria-label'] !== '声音（系统）')[0] || ui.findAll((node) => node.type === 'select')[0]
  assert.ok(select, 'voice select renders from speechSynthesis.getVoices()')
  assert.deepEqual(select.children.filter((node) => node && node.type === 'option').map((node) => node.props.value), ['', 'voice-alpha', 'voice-beta'])
  ui.change(select, 'voice-beta')
  ui.render()
  assert.equal(JSON.parse(storage.get('dsh-famling/settings')).voiceURI, 'voice-beta', 'voice choice persisted')
  closeActiveDialog(ui)
  openInteractions(ui)
  ui.clickExact('摸头')
  ui.render()
  assert.equal(speech.speak.length, 1)
  assert.equal(speech.speak[0].voice.voiceURI, 'voice-beta', 'the selected browser voice is attached to the utterance')
})

test('cat/dog content customize shows the thought-bubble policy instead of TTS controls', () => {
  const { ui } = createHarness({ character: 'cat', voices: [{ voiceURI: 'voice-alpha', name: 'Alpha', lang: 'zh-CN' }] })
  openContent(ui, '自定义')
  assert.equal(ui.findAll((node) => node.type === 'input' && node.props.type === 'checkbox').length, 0, 'no TTS toggle for cat')
  assert.equal(ui.findAll((node) => node.type === 'select').length, 0, 'no voice list for cat')
  assert.ok(ui.findAll((node) => node.type === 'p').some((node) => ui.text(node).includes('没有语音')), 'silent policy note is shown')
})

test('brief dialogue mode caps replies at the shared 80 chars and persists the mode', async () => {
  const { ui, storage } = createHarness({ reply: '回'.repeat(150) })
  openContent(ui, '自定义')
  assert.equal(ui.findButtonByAria('对话 · 标准').props['aria-pressed'], true, 'standard is the default mode')
  ui.click(ui.findButtonByAria('对话 · 简短'))
  ui.render()
  assert.equal(storage.get('dsh-famling/dialogue'), 'brief', 'dialogue mode persisted')
  assert.equal(ui.findButtonByAria('对话 · 简短').props['aria-pressed'], true, 'brief is marked as current')
  closeActiveDialog(ui)
  openInputPanel(ui)
  const textarea = ui.findAll((node) => node.type === 'textarea')[0]
  ui.change(textarea, '说长一点')
  ui.render()
  ui.clickText('发送')
  await ui.settle()
  const bubble = ui.findBubble()
  assert.ok(bubble, 'reply bubble renders')
  const text = ui.text(bubble)
  assert.ok(text.length <= 80, 'brief mode caps the reply at 80 chars: ' + text.length)
  assert.ok(text.endsWith('…'), 'capped reply is marked with an ellipsis')
})

test('standard dialogue mode caps replies at the shared 240 chars', async () => {
  const { ui } = createHarness({ reply: '回'.repeat(300) })
  openInputPanel(ui)
  const textarea = ui.findAll((node) => node.type === 'textarea')[0]
  ui.change(textarea, '说长一点')
  ui.render()
  ui.clickText('发送')
  await ui.settle()
  const text = ui.text(ui.findBubble())
  assert.ok(text.length <= 240, 'standard mode caps the reply at 240 chars: ' + text.length)
  assert.ok(text.endsWith('…'))
})

test('quiet dialogue mode suppresses only ambient lines; explicit interactions and direct replies still show', async () => {
  // Shared famling dialoguePack semantics: bubbleChance applies to AUTOMATIC
  // bubbles only; explicit interaction bubbles may still show (quiet = no
  // automatic ambient bubbles, brief/quiet still clamp every line).
  const tapped = createHarness({ character: 'cat', dialogue: 'quiet', random: () => 0.99 })
  tapped.ui.clickPetAt(50, 35)
  tapped.ui.render()
  assert.ok(tapped.ui.findBubble(), 'explicit region taps keep their bubble in quiet mode regardless of the ambient roll')
  assert.ok(regionSays('cat', 'head').includes(tapped.ui.text(tapped.ui.findBubble())), 'the tap bubble comes from the region says')
  const standard = createHarness({ character: 'human', dialogue: 'standard', random: () => 0.99 })
  openInteractions(standard.ui)
  const label = standard.ui.findButtonExact('摸头')
  standard.ui.click(label)
  standard.ui.render()
  assert.ok(standard.ui.findBubble(), 'explicit menu actions are not chance-gated in standard mode')
  const direct = createHarness({ character: 'human', dialogue: 'quiet', random: () => 0.99, reply: '嗯，我在。' })
  openInputPanel(direct.ui)
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
  closeActiveDialog(ui)
  openInteractions(ui)
  ui.clickExact('摸头')
  ui.render()
  assert.equal(ui.findBubble().props.style.background, 'var(--dsh-famling-bubble-bg, #ffffff)', 'bubble still reads the theme variable')
})

test('content center background applies a local CSS backdrop and persists it', () => {
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
  closeActiveDialog(ui)
  openInteractions(ui)
  ui.clickExact('摸头')
  ui.render()
  assert.match(ui.findBubble().props.style.boxShadow, /var\(--dsh-famling-widget-bg/, 'bubble backdrop ring uses the background variable')
  openContent(ui, '自定义')
  ui.click(ui.findButtonByAria('背景 · 暗色'))
  ui.render()
  assert.equal(storage.get('dsh-famling/background'), 'dark')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], '#14161a')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-fg'], '#e8eaf0')
})

test('right-click menu follows the DSH host day/night tokens, never the role theme', () => {
  const surfaces = new Set()
  for (const role of ['human', 'cat', 'dog']) {
    const { ui } = createHarness({ role })
    const style = openMenuAt(ui).props.style
    assert.match(style.background, /var\(--dsw-alias-bg-layer-1, light-dark\(#ffffff, #1f2329\)\)/, role + ': host layer-1 surface with a light/dark fallback')
    assert.match(style.color, /var\(--dsw-alias-label-primary, light-dark\(/, role + ': host primary label colour')
    assert.match(style.border, /var\(--dsw-alias-border-l2, light-dark\(/, role + ': host border with a light/dark fallback')
    assert.equal(style.background.includes('--dsh-famling-panel-bg'), false, role + ': menu never inherits the role panel theme')
    assert.equal(style.color.includes('--dsh-famling-panel-text'), false, role + ': menu never inherits the role panel text')
    const active = activeMenuItem(ui)
    assert.match(active.props.style.background, /var\(--dsw-alias-state-business-primary, light-dark\(/, role + ': host accent fills the active item')
    assert.match(active.props.style.color, /var\(--dsw-alias-label-primary-inverted, light-dark\(/, role + ': inverted host label keeps the active item readable')
    surfaces.add(style.background + '|' + style.color + '|' + style.border)
  }
  assert.equal(surfaces.size, 1, 'human/cat/dog render the same host-driven menu surface')
  const { ui } = createHarness()
  assert.equal(ui.tree.props.style.colorScheme, 'inherit', 'the widget root inherits the host color-scheme instead of forcing one')
})

test('content center font group applies local stacks, size and line height and persists them', () => {
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
  closeActiveDialog(ui)
  openInteractions(ui)
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
  ui.click(ui.findButtonByAria('气泡 / 面板主题 · 夜间'))
  ui.render()
  assert.equal(storage.get('dsh-famling/theme'), 'night', 'component override persisted')
  assert.equal(storage.get('dsh-famling/role'), 'dog', 'role id stays untouched by a component override')
  assert.equal(ui.tree.props['data-character'], 'dog', 'character stays untouched by a component override')
  assert.ok(ui.text(contentDialog(ui)).includes('已自定义'), 'customized state is shown')
  ui.clickExact('恢复角色默认')
  ui.render()
  assert.equal(storage.get('dsh-famling/theme'), 'paper', 'dog role theme preset (paper) restored')
  assert.equal(storage.get('dsh-famling/background'), 'transparent', 'dog role background preset restored (transparent)')
  assert.deepEqual(JSON.parse(storage.get('dsh-famling/font')), { family: 'system', size: 12, lineHeight: 1.5 }, 'dog role font preset restored')
  assert.ok(ui.text(contentDialog(ui)).includes('角色预设'), 'restored state is the role preset again')
})

test('dsh-famling/role backfills the shared bundle on load while explicit component keys win', () => {
  const legacy = createHarness({ character: 'dog' })
  assert.equal(legacy.ui.tree.props['data-character'], 'dog')
  assert.equal(legacy.storage.get('dsh-famling/role'), 'dog', 'role key backfilled from an existing character key')
  assert.equal(legacy.storage.get('dsh-famling/dialogue'), 'standard')
  assert.equal(legacy.storage.get('dsh-famling/theme'), 'paper')
  assert.equal(legacy.storage.get('dsh-famling/background'), 'transparent')
  assert.deepEqual(JSON.parse(legacy.storage.get('dsh-famling/font')), { family: 'system', size: 12, lineHeight: 1.5 })
  const roleOnly = createHarness({ role: 'cat' })
  assert.equal(roleOnly.ui.tree.props['data-character'], 'cat', 'character backfilled from the role bundle')
  assert.equal(roleOnly.storage.get('dsh-famling/character'), 'cat', 'character key persisted from the bundle')
  assert.equal(roleOnly.storage.get('dsh-famling/dialogue'), 'standard')
  assert.equal(roleOnly.storage.get('dsh-famling/theme'), 'night')
  assert.equal(roleOnly.storage.get('dsh-famling/background'), 'transparent')
  assert.deepEqual(JSON.parse(roleOnly.storage.get('dsh-famling/font')), { family: 'serif', size: 12, lineHeight: 1.5 })
  const overridden = createHarness({ role: 'cat', theme: 'paper' })
  assert.equal(overridden.ui.tree.props.style['--dsh-famling-bubble-bg'], '#fff8ec', 'an explicit component key wins over the role bundle')
  assert.equal(overridden.storage.get('dsh-famling/role'), 'cat', 'the role id is preserved')
})

test('content pack tab shows the built-in pack, declaration check and reserved import without network', () => {
  const { ui, businessCalls } = createHarness()
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
  assert.equal(businessCalls().length, 0, 'opening the pack tab never calls bridge business ops')
})

test('market tab is a reserved placeholder with catalog fields and never sends a network request', () => {
  const { ui, businessCalls } = createHarness()
  openContent(ui, '市场')
  const text = ui.text(contentDialog(ui))
  assert.ok(text.includes('远程市场接口已预留，服务器未配置'), 'market status is explicit')
  assert.ok(text.includes('catalogUrl'), 'catalog URL field is reserved')
  assert.ok(text.includes('dsh-famling.market'), 'market config field is reserved')
  assert.ok(text.includes('不会发起任何网络请求'), 'no-network promise is shown')
  assert.ok(text.includes('未配置'), 'no fake catalog is configured')
  assert.equal(businessCalls().length, 0, 'market tab never calls bridge business ops')
})

test('a missing content/settings chunk degrades locally without breaking the widget', () => {
  const { ui } = createHarness({ failContentChunk: true })
  openMenuAt(ui)
  clickMenu(ui, '内容与角色')
  assert.ok(ui.text(ui.tree).includes('内容中心加载失败'), 'a local failure message is shown for the content center')
  closeActiveDialog(ui)
  openSettings(ui)
  assert.ok(ui.text(ui.tree).includes('设置面板加载失败'), 'a local failure message is shown for settings')
  closeActiveDialog(ui)
  openMenuAt(ui)
  assert.equal(menuItemNodes(ui).length, 6, 'the right-click menu keeps working without the chunk')
  ui.clickPetAt(51, 27)
  ui.render()
  assert.ok(petImage(ui).props.src.startsWith('data:image/png;base64,'), 'region interaction stays local')
})


/* ==================== plugin safety floor (MB-020/021/022/024) ==================== */
function firstRunDialog(ui) {
  return ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-label'] === '首次使用说明')[0]
}
function firstRunDialogEn(ui) {
  return ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-label'] === 'First-run notice')[0]
}

test('first run shows a dismissible safety card exactly once and keeps a local ack flag', () => {
  const { ui, storage, businessCalls } = createHarness({ firstRun: true })
  const card = firstRunDialog(ui)
  assert.ok(card, 'the one-time safety card is shown on a fresh install')
  const text = ui.text(card)
  assert.ok(text.includes('模型供应商'), 'card states where chat text goes')
  assert.ok(text.includes('12356') && text.includes('110') && text.includes('120'), 'card lists crisis resources')
  assert.ok(text.includes('请勿发送密码'), 'card warns against secrets/private data')
  assert.ok(text.includes('点角色 = 互动') && text.includes('Shift+F10'), 'card coaches the two core interactions')
  assert.equal(storage.has('dsh-famling/first-run/v1'), false, 'nothing is acknowledged before the click')
  assert.equal(businessCalls().length, 0, 'the card makes no bridge business request')
  ui.clickText('我知道了')
  ui.render()
  assert.equal(firstRunDialog(ui), undefined, 'dismissing the card removes it')
  assert.equal(storage.get('dsh-famling/first-run/v1'), '1', 'the ack flag is stored locally')
  assert.equal(ui.findAll((node) => node.type === 'button').length, 1, 'only the pet button remains')
  // A later render (same storage already acked) does not show it again.
  const second = createHarness()
  assert.equal(firstRunDialog(second.ui), undefined, 'an acked install does not show the card again')
})

test('the first-run card also exists in English with the same disclosure and resources', () => {
  const { ui } = createHarness({ firstRun: true, language: 'en-US' })
  const card = firstRunDialogEn(ui)
  assert.ok(card, 'English first-run card')
  const text = ui.text(card)
  assert.ok(text.includes('model provider'), 'sending destination is disclosed')
  assert.ok(text.includes('12356') && text.includes('110') && text.includes('120'), 'crisis resources are listed')
  assert.ok(text.includes('Click the character to play') && text.includes('Shift+F10'), 'English coach line matches the Chinese one')
})

test('the chat input panel discloses the sending destination and crisis resources', () => {
  const { ui } = createHarness()
  openInputPanel(ui)
  const text = ui.text(ui.tree)
  assert.ok(text.includes('DSH'), 'disclosure names the DSH host path')
  assert.ok(text.includes('模型供应商'), 'disclosure names the configured model provider')
  assert.ok(text.includes('密码') && text.includes('隐私') && text.includes('客户资料'), 'disclosure warns about secrets/private data')
  assert.ok(text.includes('12356') && text.includes('110') && text.includes('120'), 'crisis resources stay visible in the chat panel')
  const english = createHarness({ language: 'en-US' })
  openMenuAt(english.ui)
  clickMenu(english.ui, 'Chat')
  const enText = english.ui.text(english.ui.tree)
  assert.ok(enText.includes('model provider'), 'English sending disclosure')
  assert.ok(enText.includes('never send passwords'), 'English secrets warning')
})

test('turning AI chat off in settings blocks the bridge while reminders stay available', () => {
  const { ui, storage, businessCalls } = createHarness()
  openSettings(ui)
  const toggle = checkboxByLabel(ui, 'AI 聊天')
  ui.change(toggle, false)
  ui.render()
  assert.equal(JSON.parse(storage.get('dsh-famling/settings')).chat, false, 'chat switch persists in the plugin settings')
  closeActiveDialog(ui)
  openInputPanel(ui)
  const textarea = ui.findAll((node) => node.type === 'textarea')[0]
  ui.change(textarea, '你好')
  ui.render()
  ui.clickExact('发送')
  ui.render()
  assert.equal(businessCalls().length, 0, 'no chat request is sent while the switch is off')
  assert.ok(ui.text(ui.findBubble()).includes('AI 聊天已关闭'), 'the local chat-off note is shown')
})


/* ==================== 0.10.7 host hello/probe capability negotiation ==================== */
function hostOpCalls(fetchCalls, op) {
  return fetchCalls.filter((call) => { try { return JSON.parse(call.init.body).op === op } catch { return false } })
}
function advancedToggle(ui) {
  return ui.findAll((node) => node.type === 'button' && ui.text(node).includes('高级 / 调试'))[0]
}
function openAdvancedSettings(ui) {
  openSettings(ui)
  const toggle = advancedToggle(ui)
  assert.ok(toggle, 'advanced toggle exists')
  ui.click(toggle)
  ui.render()
  return settingsDialog(ui)
}

test('mount sends one hello handshake with version, wire revision, contract and the boot release', async () => {
  const { ui, fetchCalls, businessCalls } = createHarness({ bootRelease: { version: '0.2.2-rc.4', commit: 'abc123' } })
  await ui.settle()
  const hellos = hostOpCalls(fetchCalls, 'hello')
  assert.equal(hellos.length, 1, 'exactly one mount handshake')
  const payload = JSON.parse(hellos[0].init.body)
  assert.deepEqual(
    { v: payload.v, op: payload.op, clientVersion: payload.clientVersion, wireVersion: payload.wireVersion, contentExtension: payload.contentExtension },
    { v: 2, op: 'hello', clientVersion: PLUGIN_VERSION, wireVersion: 2, contentExtension: 3 },
    'handshake carries the client version, bridge wire 2 and content-extension v3',
  )
  assert.equal(payload.hostVersion, '0.2.2-rc.4', 'the client reports the Host release it booted from')
  assert.equal(payload.hostCommit, 'abc123')
  assert.equal(businessCalls().length, 0, 'the handshake sends no chat/brief/reminder payload')
  const dialog = openAdvancedSettings(ui)
  const text = ui.text(dialog)
  assert.ok(text.includes('已握手（hello）'), 'settings states the handshake succeeded')
  assert.ok(text.includes('0.2.2-rc.4'), 'settings shows the Host version')
  assert.ok(text.includes('桥接契约 v2'), 'settings shows the bridge contract revision')
  assert.ok(text.includes('内容扩展契约 v3'), 'settings shows the content-extension v3 contract')
  assert.ok(text.includes('模型服务 可用'), 'settings shows the capability matrix')
})

test('hello omits an unreported hostVersion instead of inventing one', async () => {
  const { ui, fetchCalls } = createHarness()
  await ui.settle()
  const payload = JSON.parse(hostOpCalls(fetchCalls, 'hello')[0].init.body)
  assert.equal('hostVersion' in payload, false, 'no boot release means no guessed Host version')
  assert.equal('hostCommit' in payload, false)
})

test('missing Host llm/schedule degrades the input panel and never fakes a reply', async () => {
  const { ui, businessCalls } = createHarness({ hostCapabilities: { llm: false, schedule: false }, hostDegraded: ['llm', 'schedule'] })
  await ui.settle()
  openInputPanel(ui)
  const panelText = ui.text(ui.tree)
  assert.ok(panelText.includes('未连接模型服务'), 'the chat degradation is explained in the panel')
  assert.ok(panelText.includes('不支持提醒'), 'the reminder degradation is explained in the panel')
  const send = ui.findButtonExact('发送')
  assert.equal(send.props.disabled, true, 'send is disabled without an LLM service')
  assert.equal(ui.findAll((node) => node.type === 'button' && ui.text(node) === '提醒').length, 0, 'reminder entry is not rendered without schedule')
  const textarea = ui.findAll((node) => node.type === 'textarea')[0]
  ui.change(textarea, '你好')
  ui.render()
  ui.clickExact('发送')
  ui.render()
  assert.equal(businessCalls().length, 0, 'no chat request is sent without an LLM service')
  assert.ok(ui.text(ui.findBubble()).includes('未连接模型'), 'the local degradation note is shown')
  closeActiveDialog(ui)
  const dialog = openAdvancedSettings(ui)
  const text = ui.text(dialog)
  assert.ok(text.includes('模型服务 不可用'), 'settings matrix reports the missing LLM service')
  assert.ok(text.includes('提醒服务 不可用'), 'settings matrix reports the missing schedule service')
  assert.ok(text.includes('降级项: llm, schedule'), 'settings lists the degraded capabilities')
})

test('an older Host without hello degrades to compatible mode and keeps chat working', async () => {
  const { ui, fetchCalls, businessCalls } = createHarness({ hostHello: null })
  await ui.settle()
  assert.equal(hostOpCalls(fetchCalls, 'hello').length, 1, 'the probe still runs once')
  openInputPanel(ui)
  const textarea = ui.findAll((node) => node.type === 'textarea')[0]
  ui.change(textarea, '你好')
  ui.render()
  ui.clickText('发送')
  await ui.settle()
  assert.equal(businessCalls().length, 1, 'a legacy Host keeps the previous chat behavior')
  assert.equal(ui.text(ui.findBubble()), '我在这里。')
  closeActiveDialog(ui)
  const dialog = openAdvancedSettings(ui)
  assert.ok(ui.text(dialog).includes('兼容模式'), 'settings states the legacy/compatible handshake')
})

test('a stale client/host version mismatch and contract drift are reported without crashing', async () => {
  const { ui } = createHarness({ hostPluginVersion: '0.9.9', hostContentExtension: 2, hostDegraded: ['content-extension'], hostCompatible: false })
  await ui.settle()
  const dialog = openAdvancedSettings(ui)
  const text = ui.text(dialog)
  assert.ok(text.includes('插件版本与宿主不一致'), 'a stale cached client is reported')
  assert.ok(text.includes('内容扩展契约 v2'), 'the Host contract is shown even when it differs')
  assert.ok(text.includes('降级项: content-extension'), 'contract drift is listed as a degradation')
  assert.ok(petImage(ui), 'the pet still renders after a mismatch')
})

test('settings can re-probe the Host with op:probe', async () => {
  const { ui, fetchCalls } = createHarness()
  await ui.settle()
  openAdvancedSettings(ui)
  ui.clickText('重新检测 Host 能力')
  await ui.settle()
  const probes = hostOpCalls(fetchCalls, 'probe')
  assert.equal(probes.length, 1, 'the manual re-probe uses op:probe')
  assert.equal(JSON.parse(probes[0].init.body).v, 2, 'probe uses the new wire revision')
})

test('clearing local settings and consent empties only dsh-famling/* keys and withdraws consent', () => {
  const { ui, storage } = createHarness()
  assert.ok(storage.get('dsh-famling/consent/v2'), 'versioned consent exists before the clear')
  openSettings(ui)
  ui.clickText('清除本机设置与同意')
  ui.render()
  const remaining = [...storage.keys()].filter((key) => key.startsWith('dsh-famling/'))
  assert.deepEqual(remaining, [], 'every dsh-famling/* key is gone (settings + consent withdrawn)')
  assert.ok(ui.text(settingsDialog(ui)).includes('已清除'), 'the settings panel reports the clear')
  assert.ok(ui.text(settingsDialog(ui)).includes('DSH'), 'the DSH boundary note stays visible')
})

/* ==================== MB-014: versioned TTS/ASR consent ==================== */
test('accepting TTS consent stores a versioned, hashed and timestamped record', () => {
  const { ui, storage } = createHarness({ consent: { tts: false }, settings: { sound: false } })
  openSettings(ui)
  ui.change(checkboxByLabel(ui, '声音'), true)
  ui.render()
  const dialog = consentDialog(ui)
  assert.ok(dialog, 'TTS consent dialog is mounted')
  assert.ok(ui.text(dialog).includes(CONSENT_VERSION), 'dialog shows the declaration version')
  assert.ok(ui.text(dialog).includes(CONSENT_HASH.slice(0, 16)), 'dialog shows the declaration SHA-256 prefix')
  ui.click(ui.findButtonExact('同意并开启'))
  ui.render()
  const stored = JSON.parse(storage.get('dsh-famling/consent/v2'))
  assert.equal(stored.schema, 2)
  assert.deepEqual(Object.keys(stored.tts).sort(), ['acceptedAt', 'hash', 'version', 'withdrawn'])
  assert.equal(stored.tts.version, CONSENT_VERSION)
  assert.equal(stored.tts.hash, CONSENT_HASH)
  assert.match(stored.tts.acceptedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(stored.tts.withdrawn, false)
  assert.equal(storage.has('dsh-famling/consent/v1'), false, 'the legacy boolean key is not written')
})

test('legacy boolean consent is migrated to withdrawn records and re-prompts', () => {
  const { ui, storage, speech } = createHarness({ legacyConsent: { tts: true, asr: true }, settings: { sound: false } })
  openSettings(ui)
  assert.equal(storage.has('dsh-famling/consent/v1'), false, 'legacy v1 is removed after migration')
  const migrated = JSON.parse(storage.get('dsh-famling/consent/v2'))
  for (const kind of ['tts', 'asr']) {
    assert.equal(migrated[kind].version, 'legacy-v1')
    assert.equal(migrated[kind].withdrawn, true, kind + ': unverifiable consent is withdrawn (fail-closed)')
    assert.equal(migrated[kind].acceptedAt, null)
  }
  assert.ok(ui.text(settingsDialog(ui)).includes('独立确认'), 'settings asks for independent confirmation again')
  ui.change(checkboxByLabel(ui, '声音'), true)
  ui.render()
  assert.ok(consentDialog(ui), 'enabling voice re-prompts after the migration')
  assert.equal(speech.speak.length, 0, 'nothing is spoken from an unverified legacy consent')
})

test('a stale version or hash invalidates stored consent instead of granting it', () => {
  for (const broken of [{ version: 'stale-version' }, { hash: 'f'.repeat(64) }]) {
    const { ui, speech } = createHarness({ consentRecords: { schema: 2, tts: { ...consentRecord(), ...broken } }, settings: { sound: false } })
    openSettings(ui)
    ui.change(checkboxByLabel(ui, '声音'), true)
    ui.render()
    assert.ok(consentDialog(ui), 'a stale record re-prompts: ' + Object.keys(broken)[0])
    assert.equal(speech.speak.length, 0)
  }
})

test('ASR consent is recorded independently with the same versioned shape', () => {
  const { ui, storage } = createHarness()
  openInputPanel(ui)
  ui.click(ui.findButtonByAria('语音输入'))
  ui.render()
  assert.ok(consentDialog(ui), 'ASR consent dialog is mounted')
  ui.click(ui.findButtonExact('同意并开启'))
  ui.render()
  const stored = JSON.parse(storage.get('dsh-famling/consent/v2'))
  assert.equal(stored.asr.withdrawn, false, 'ASR gets its own non-withdrawn record')
  assert.equal(stored.asr.hash, CONSENT_HASH)
  assert.equal(stored.tts.version, CONSENT_VERSION, 'the existing TTS consent record is preserved')
})

test('withdrawing voice consent keeps a withdrawn record, switches voice off and stops TTS', () => {
  const { ui, storage, speech } = createHarness({ consent: { asr: true }, settings: { sound: true } })
  openSettings(ui)
  ui.clickText('撤回语音同意')
  ui.render()
  const stored = JSON.parse(storage.get('dsh-famling/consent/v2'))
  assert.equal(stored.tts.withdrawn, true, 'the TTS record is marked withdrawn')
  assert.equal(stored.asr.withdrawn, true, 'the ASR record is withdrawn too')
  assert.equal(stored.tts.version, CONSENT_VERSION, 'withdrawal keeps the evidence fields')
  assert.equal(stored.tts.acceptedAt, consentRecord().acceptedAt, 'acceptedAt is preserved')
  assert.equal(JSON.parse(storage.get('dsh-famling/settings')).sound, false, 'voice is switched off')
  assert.ok(speech.cancel >= 1, 'a running utterance is cancelled')
  closeActiveDialog(ui)
  const spoken = speech.speak.length
  ui.clickPetAt(50, 35)
  ui.render()
  assert.ok(ui.findBubble(), 'the caption bubble still works')
  assert.equal(speech.speak.length, spoken, 'withdrawn TTS is never called again')
})

test('stored background and font choices are restored on the next render', () => {
  const { ui } = createHarness({ background: 'dark', font: { family: 'mono', size: 11, lineHeight: 1.4 } })
  assert.equal(ui.tree.props.style['--dsh-famling-widget-bg'], '#14161a')
  assert.equal(ui.tree.props.style['--dsh-famling-widget-fg'], '#e8eaf0')
  assert.match(ui.tree.props.style['--dsh-famling-font-family'], /ui-monospace/)
  assert.equal(ui.tree.props.style['--dsh-famling-font-size'], '11px')
  assert.equal(ui.tree.props.style['--dsh-famling-line-height'], '1.4')
})
