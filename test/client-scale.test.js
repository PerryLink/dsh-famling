import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

import { CLIENT_PATH } from '../scripts/embed-anims.mjs'

const clientSource = readFileSync(CLIENT_PATH, 'utf8')
const contentSource = readFileSync(join(dirname(CLIENT_PATH), 'client.content.js'), 'utf8')

/* ==================== pure four-level scale model ==================== */

const SCALE_BEGIN = '// <dsh-famling:scale:begin>'
const SCALE_END = '// <dsh-famling:scale:end>'

/** Extract the marked pure model block and expose its constants/functions. */
function loadScaleModel() {
  const start = clientSource.indexOf(SCALE_BEGIN)
  const stop = clientSource.indexOf(SCALE_END)
  assert.ok(start >= 0 && stop > start, 'scale model markers exist in client.js')
  const block = clientSource.slice(start + SCALE_BEGIN.length, stop)
  const exports = [
    'SCALE_MODEL_VERSION', 'SCALE_KEY', 'SCALE_MODEL_KEY', 'SCALE_GLOBAL_KEY', 'SCALE_UI_TEXT_KEY', 'SCALE_IMAGE_KEY', 'SCALE_COMPONENT_PREFIX',
    'LEGACY_SCALE_KEY', 'LEGACY_TEXT_KEY',
    'GLOBAL_SCALE_MIN', 'GLOBAL_SCALE_MAX', 'GLOBAL_SCALE_DEFAULT', 'GLOBAL_SCALE_STEP',
    'UI_TEXT_SCALE_MIN', 'UI_TEXT_SCALE_MAX', 'UI_TEXT_SCALE_DEFAULT',
    'IMAGE_SCALE_MIN', 'IMAGE_SCALE_MAX', 'IMAGE_SCALE_DEFAULT',
    'COMPONENT_SCALE_MIN', 'COMPONENT_SCALE_MAX', 'BUBBLE_MAX_WIDTH',
    'SCALE_COMPONENTS', 'SCALE_COMPONENT_IDS', 'SCALE_CATALOG',
    'defaultScaleSettings', 'normalizeScaleSettings', 'loadScaleSettings', 'persistScaleSettings',
    'resetScaleSettings', 'resolveScaleSettings', 'fitScaleToViewport', 'formatScalePercent', 'formatScaleMultiplier',
    'scaleStorageKeys', 'clampScale', 'readScaleSettings', 'hasStoredScaleModel', 'migrateLegacyScaleSettings',
  ]
  return new Function(block + '\nreturn {' + exports.join(', ') + '}')()
}

/** Minimal localStorage-like store shared by the pure-model tests. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]))
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) { map.set(key, String(value)) },
    removeItem(key) { map.delete(key) },
    keys() { return [...map.keys()] },
    map,
  }
}

const model = loadScaleModel()

test('scale model markers, version and defaults are stable', () => {
  assert.equal(model.SCALE_MODEL_VERSION, 1, 'model version marker')
  assert.equal(model.SCALE_KEY, 'dsh-famling/scale', 'namespaced key root')
  assert.equal(model.SCALE_MODEL_KEY, 'dsh-famling/scale/model')
  assert.equal(model.LEGACY_SCALE_KEY, 'dsh-famling/scale', 'legacy absolute pet scale is read from the old key')
  assert.equal(model.LEGACY_TEXT_KEY, 'dsh-famling/text-scale', 'legacy absolute text scale')
  assert.deepEqual(model.defaultScaleSettings(), { global: 1, uiText: 1, image: 1, components: {} }, '100% everywhere')
  assert.deepEqual(model.SCALE_COMPONENT_IDS, ['bubble', 'menu', 'panel', 'contentHub', 'settings'], 'four levels: bubble/menu/panel/content/settings components')
  assert.deepEqual(model.SCALE_COMPONENTS.map((item) => item.zh), ['气泡', '右键菜单', '面板', '内容中心', '设置弹窗'])
  assert.equal(model.BUBBLE_MAX_WIDTH, 240, 'bubble never exceeds the 240px sidebar budget')
  assert.deepEqual(
    [model.GLOBAL_SCALE_MIN, model.GLOBAL_SCALE_MAX, model.GLOBAL_SCALE_DEFAULT, model.GLOBAL_SCALE_STEP],
    [0.5, 2, 1, 0.05],
  )
  assert.deepEqual([model.UI_TEXT_SCALE_MIN, model.UI_TEXT_SCALE_MAX], [0.4, 1.5], 'UI+text relative axis')
  assert.deepEqual([model.IMAGE_SCALE_MIN, model.IMAGE_SCALE_MAX], [0.5, 2], 'image relative axis')
  assert.deepEqual([model.COMPONENT_SCALE_MIN, model.COMPONENT_SCALE_MAX], [0.75, 1.5], 'component override range')
})

test('normalizeScaleSettings clamps every axis and drops non-numeric/1x components', () => {
  assert.deepEqual(model.normalizeScaleSettings(null), model.defaultScaleSettings(), 'null -> defaults')
  assert.deepEqual(model.normalizeScaleSettings({ global: 'nope', uiText: NaN, image: Infinity }), model.defaultScaleSettings(), 'malformed -> defaults')
  const clamped = model.normalizeScaleSettings({ global: 9, uiText: 0.01, image: -3, components: { bubble: 9, menu: 0.01, panel: 1, settings: 'x', contentHub: NaN } })
  assert.equal(clamped.global, 2, 'global clamped to 200%')
  assert.equal(clamped.uiText, 0.4, 'uiText clamped to 40%')
  assert.equal(clamped.image, 0.5, 'image clamped to 50%')
  assert.deepEqual(clamped.components, { bubble: 1.5, menu: 0.75 }, 'component clamped; 1x/non-numeric dropped (inherit)')
  assert.deepEqual(model.normalizeScaleSettings({ components: null }).components, {}, 'components null -> inherit')
  assert.deepEqual(Object.keys(model.normalizeScaleSettings({ components: { __proto__: 2 } }).components), [], 'unknown component ids ignored')
})

test('resolveScaleSettings: 100% is the shipped look and the global scale moves everything', () => {
  const baseline = model.resolveScaleSettings(model.defaultScaleSettings())
  assert.equal(baseline.uiScale, 1, 'UI scale 100%')
  assert.equal(baseline.imageScale, 1, 'image scale 100%')
  for (const id of model.SCALE_COMPONENT_IDS) assert.equal(baseline.components[id], 1, id + ' inherits 100%')
  const global = model.resolveScaleSettings({ global: 1.5, uiText: 1, image: 1, components: {} })
  assert.equal(global.uiScale, 1.5, 'global scales UI/text')
  assert.equal(global.imageScale, 1.5, 'global scales image')
  for (const id of model.SCALE_COMPONENT_IDS) assert.equal(global.components[id], 1.5, 'global scales component ' + id)
})

test('resolveScaleSettings: UI+文本 and 图像 are independent axes', () => {
  const uiOnly = model.resolveScaleSettings({ global: 1.2, uiText: 1.25, image: 1, components: {} })
  assert.equal(uiOnly.uiScale, 1.5, 'UI/text = global x uiText')
  assert.equal(uiOnly.imageScale, 1.2, 'image follows the global scale only')
  assert.equal(uiOnly.components.bubble, 1.5, 'components inherit the resolved UI scale')
  const imageOnly = model.resolveScaleSettings({ global: 1.2, uiText: 1, image: 0.5, components: {} })
  assert.equal(imageOnly.uiScale, 1.2, 'UI/text follows the global scale only')
  assert.equal(imageOnly.imageScale, 0.6, 'image = global x image')
})

test('resolveScaleSettings applies effective caps at extreme slider combinations', () => {
  const bigText = model.resolveScaleSettings({ global: 2, uiText: 1.5, image: 1, components: {} })
  assert.equal(bigText.uiScale, 2.5, 'UI/text capped at 2.5x (30px at 12px base)')
  const smallText = model.resolveScaleSettings({ global: 0.5, uiText: 0.4, image: 1, components: {} })
  assert.equal(smallText.uiScale, 0.6, 'UI/text floored at 0.6x')
  const bigImage = model.resolveScaleSettings({ global: 2, uiText: 1, image: 2, components: {} })
  assert.equal(bigImage.imageScale, 2, 'image capped at 2x (144px), inside the sidebar budget')
  const zoomedComponent = model.resolveScaleSettings({ global: 2, uiText: 1.25, image: 1, components: { bubble: 1.5 } })
  assert.equal(zoomedComponent.uiScale, 2.5)
  assert.equal(zoomedComponent.components.bubble, 2, 'component zoom capped at 2x')
})

test('component overrides are multipliers of the inherited UI scale', () => {
  const resolved = model.resolveScaleSettings({ global: 1.2, uiText: 1, image: 1, components: { bubble: 1.25, menu: 0.75 } })
  assert.equal(resolved.components.bubble, 1.5, 'bubble = 1.2 x 1.25')
  assert.ok(Math.abs(resolved.components.menu - 0.9) < 1e-9, 'menu = 1.2 x 0.75')
  assert.equal(resolved.components.panel, 1.2, 'unset component inherits UI scale')
  const following = model.resolveScaleSettings({ global: 1.2, uiText: 1, image: 1, components: {} })
  assert.equal(following.components.bubble, resolved.components.panel, 'default inherits exactly')
})

test('persist/load round-trips the model and removes default axis keys', () => {
  const store = memoryStorage()
  const settings = { global: 1.5, uiText: 1.25, image: 0.75, components: { bubble: 1.5, settings: 0.75 } }
  model.persistScaleSettings(settings, store)
  assert.equal(store.getItem(model.SCALE_MODEL_KEY), '1', 'version marker written')
  assert.equal(store.getItem(model.SCALE_GLOBAL_KEY), '1.5')
  assert.equal(store.getItem(model.SCALE_UI_TEXT_KEY), '1.25')
  assert.equal(store.getItem(model.SCALE_IMAGE_KEY), '0.75')
  assert.equal(store.getItem(model.SCALE_COMPONENT_PREFIX + 'bubble'), '1.5')
  assert.equal(store.getItem(model.SCALE_COMPONENT_PREFIX + 'settings'), '0.75')
  assert.equal(store.getItem(model.SCALE_COMPONENT_PREFIX + 'menu'), null, 'inherit components are not written')
  const loaded = model.loadScaleSettings(store)
  assert.equal(loaded.migrated, false)
  assert.deepEqual(loaded.settings, model.normalizeScaleSettings(settings), 'exact round-trip')
  // Back to defaults: every non-global key is removed, the marker/global stay.
  model.persistScaleSettings(model.defaultScaleSettings(), store)
  assert.equal(store.getItem(model.SCALE_UI_TEXT_KEY), null)
  assert.equal(store.getItem(model.SCALE_IMAGE_KEY), null)
  assert.equal(store.getItem(model.SCALE_COMPONENT_PREFIX + 'bubble'), null)
  assert.equal(store.getItem(model.SCALE_GLOBAL_KEY), '1')
  assert.equal(store.getItem(model.SCALE_MODEL_KEY), '1')
  assert.deepEqual(model.loadScaleSettings(store).settings, model.defaultScaleSettings())
})

test('legacy absolute pet/text scales migrate exactly once and keep effective values', () => {
  const store = memoryStorage({ 'dsh-famling/scale': JSON.stringify({ pet: 1.5, text: 1.25 }) })
  const loaded = model.loadScaleSettings(store)
  assert.equal(loaded.migrated, true, 'legacy pair is migrated')
  assert.deepEqual(loaded.settings, { global: 1, uiText: 1.25, image: 1.5, components: {} }, 'absolute values preserved at global 100%')
  model.persistScaleSettings(loaded.settings, store)
  assert.equal(store.getItem(model.LEGACY_SCALE_KEY), JSON.stringify({ pet: 1.5, text: 1.25 }), 'legacy key left in place as backup')
  assert.equal(store.getItem(model.SCALE_MODEL_KEY), '1')
  const again = model.loadScaleSettings(store)
  assert.equal(again.migrated, false, 'the version marker makes the migration one-time')
  assert.deepEqual(again.settings, loaded.settings)
  const numeric = memoryStorage({ 'dsh-famling/scale': '1.75' })
  assert.deepEqual(model.loadScaleSettings(numeric).settings, { global: 1, uiText: 1, image: 1.75, components: {} })
  const text = memoryStorage({ 'dsh-famling/text-scale': '1.4' })
  assert.deepEqual(model.loadScaleSettings(text).settings, { global: 1, uiText: 1.4, image: 1, components: {} })
  const clamp = memoryStorage({ 'dsh-famling/scale': '9', 'dsh-famling/text-scale': '9' })
  assert.deepEqual(model.loadScaleSettings(clamp).settings, { global: 1, uiText: 1.5, image: 2, components: {} }, 'legacy values are clamped')
})

test('new-model keys and valid stored values win over legacy keys (no double migration)', () => {
  const store = memoryStorage({
    'dsh-famling/scale': '2',
    'dsh-famling/text-scale': '1.5',
    'dsh-famling/scale/model': '1',
    'dsh-famling/scale/global': '1.2',
    'dsh-famling/scale/ui-text': '1.1',
    'dsh-famling/scale/image': '0.9',
    'dsh-famling/scale/component/bubble': '1.25',
  })
  const loaded = model.loadScaleSettings(store)
  assert.equal(loaded.migrated, false, 'version marker short-circuits migration')
  assert.deepEqual(loaded.settings, { global: 1.2, uiText: 1.1, image: 0.9, components: { bubble: 1.25 } })
  // Malformed stored values clamp/fall back instead of throwing.
  const malformed = memoryStorage({ 'dsh-famling/scale/model': '1', 'dsh-famling/scale/global': 'abc', 'dsh-famling/scale/component/bubble': '9' })
  assert.deepEqual(model.loadScaleSettings(malformed).settings, { global: 1, uiText: 1, image: 1, components: { bubble: 1.5 } })
})

test('resetScaleSettings restores defaults, persists the marker and keeps legacy keys inert', () => {
  const store = memoryStorage({ 'dsh-famling/scale': '1.5', 'dsh-famling/scale/model': '1', 'dsh-famling/scale/global': '1.5' })
  const settings = model.resetScaleSettings(store)
  assert.deepEqual(settings, model.defaultScaleSettings())
  assert.equal(store.getItem(model.SCALE_GLOBAL_KEY), '1')
  assert.equal(store.getItem(model.SCALE_MODEL_KEY), '1', 'marker survives a reset, so legacy keys never re-apply')
  assert.equal(model.loadScaleSettings(store).migrated, false)
})

test('storage failures are silent (denied localStorage never breaks the scale model)', () => {
  const denied = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.deepEqual(model.loadScaleSettings(denied).settings, model.defaultScaleSettings())
  model.persistScaleSettings({ global: 1.5, uiText: 1, image: 1, components: {} }, denied)
  assert.deepEqual(model.loadScaleSettings(null).settings, model.defaultScaleSettings(), 'null storage -> defaults')
})

test('fitScaleToViewport and the display helpers clamp usable output', () => {
  assert.equal(model.fitScaleToViewport(3, { width: 100, height: 100 }, { width: 400, height: 400 }, { x: 8, top: 8, bottom: 8 }), 3, 'fits when there is room')
  assert.ok(Math.abs(model.fitScaleToViewport(3, { width: 100, height: 100 }, { width: 200, height: 400 }, { x: 8, top: 8, bottom: 8 }) - 1.84) < 1e-9, 'width clamps')
  assert.ok(Math.abs(model.fitScaleToViewport(3, { width: 100, height: 100 }, { width: 400, height: 200 }, { x: 0, top: 8, bottom: 8 }) - 1.84) < 1e-9, 'height clamps')
  assert.equal(model.fitScaleToViewport(Number.NaN, { width: 0, height: 0 }, { width: 0, height: 0 }, { x: 0, top: 0, bottom: 0 }), 1, 'invalid input falls back to 1')
  assert.equal(model.formatScalePercent(1.256), '126%', 'percent rounding')
  assert.equal(model.formatScaleMultiplier(1.5), '1.5×')
  assert.equal(model.formatScaleMultiplier(1.23456), '1.235×')
})

test('scaleStorageKeys covers the model, every component and both legacy keys', () => {
  const keys = model.scaleStorageKeys()
  for (const key of ['dsh-famling/scale/model', 'dsh-famling/scale/global', 'dsh-famling/scale/ui-text', 'dsh-famling/scale/image', 'dsh-famling/scale/component/bubble', 'dsh-famling/scale/component/settings', 'dsh-famling/scale', 'dsh-famling/text-scale']) {
    assert.ok(keys.includes(key), 'storage keys include ' + key)
  }
  assert.equal(keys.length, 4 + model.SCALE_COMPONENT_IDS.length + 2)
  assert.deepEqual(model.SCALE_CATALOG.storageKeys, keys, 'settings chunk receives the same clear/debug list')
  assert.deepEqual(model.SCALE_CATALOG.components, model.SCALE_COMPONENTS, 'catalog exposes the component list')
})

test('the scale block stays pure: no network, no DOM, no storage global access at load', () => {
  const start = clientSource.indexOf(SCALE_BEGIN)
  const stop = clientSource.indexOf(SCALE_END)
  const block = clientSource.slice(start, stop)
  assert.equal(/(?:^|[^.\w])fetch\s*\(/.test(block), false, 'model never calls fetch')
  assert.equal(/https?:\/\//.test(block), false, 'model references no external URL')
  assert.equal(/document\.|window\./.test(block), false, 'model never touches the DOM')
  assert.equal(/eval\s*\(|new Function\s*\(/.test(block), false, 'model has no dynamic code execution')
})

/* ==================== fake React / DOM behavior harness ==================== */

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
        if (!slot) { slot = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }; slots[index] = slot }
        if (slot.kind !== 'state') throw new Error('hook order changed at slot ' + index)
        const setValue = (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true }
        return [slot.value, setValue]
      },
      useRef(initial) {
        const index = controller.cursor
        controller.cursor += 1
        let slot = slots[index]
        if (!slot) { slot = { kind: 'ref', value: { current: initial } }; slots[index] = slot }
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
      if (!slot) { slot = { kind: 'effect', deps: null, cleanup: null }; slots[effect.index] = slot }
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
  const ui = {
    render,
    get tree() { return element },
    text(node) { return textOf(node) },
    findAll(predicate) {
      const found = []
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        if (node.type && predicate(node)) found.push(node)
        if (Array.isArray(node.children)) for (const child of node.children) walk(child)
      }
      walk(element)
      return found
    },
    findButton(label) { return ui.findAll((node) => node.type === 'button' && textOf(node).includes(label))[0] },
    findButtonExact(label) { return ui.findAll((node) => node.type === 'button' && textOf(node) === label)[0] },
    findButtonByAria(label) { return ui.findAll((node) => node.type === 'button' && node.props['aria-label'] === label)[0] },
    findBubble() { return ui.findAll((node) => node.type === 'div' && node.props.role === 'status')[0] },
    findPetButton() { return ui.findAll((node) => node.type === 'button' && typeof node.props.title === 'string' && node.props.title.startsWith('Famling ·'))[0] },
    click(node) {
      assert.ok(node, 'clickable node exists')
      assert.equal(typeof node.props.onClick, 'function', 'node has onClick')
      node.props.onClick({ target: node, preventDefault() {} })
    },
    clickText(label) { ui.click(ui.findButton(label)) },
    clickByAria(label) { ui.click(ui.findButtonByAria(label)) },
    change(node, value) {
      assert.ok(node, 'input node exists')
      node.props.onChange({ target: { value } })
    },
    clickPetAt(artX, artY, display = 72) {
      const button = ui.findPetButton()
      assert.ok(button, 'pet button exists')
      const scale = display / 96
      const rect = { left: 0, top: 0, right: display, bottom: display, width: display, height: display }
      const target = { width: display, height: display, getBoundingClientRect: () => rect }
      button.props.onClick({ target, currentTarget: target, nativeEvent: { offsetX: artX * scale, offsetY: artY * scale }, preventDefault() {} })
    },
  }
  return ui
}

function createHarness(options = {}) {
  const storage = new Map()
  storage.set('dsh-famling/settings', JSON.stringify({ sound: true, motion: false, bubble: true, ...(options.settings || {}) }))
  storage.set('dsh-famling/consent/v1', JSON.stringify({ tts: true, asr: false, ...(options.consent || {}) }))
  if (options.character) storage.set('dsh-famling/character', options.character)
  if (options.menu) storage.set('dsh-famling/menu', JSON.stringify(options.menu))
  if (!options.firstRun) storage.set('dsh-famling/first-run/v1', '1')
  for (const [key, value] of Object.entries(options.storage || {})) storage.set(key, String(value))
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null },
    setItem(key, value) { storage.set(key, String(value)) },
    removeItem(key) { storage.delete(key) },
  }
  const speech = { speak: [], cancel: 0 }
  const listeners = new Map()
  const windowListeners = new Map()
  const fetchCalls = []
  const timers = { timeouts: [], intervals: [], cleared: 0 }
  const documentStub = {
    baseURI: 'http://localhost/',
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
  }
  const windowStub = {
    __ModuleLoader__: { load(loaded) { if (loaded && typeof loaded.chunk === 'string') chunkDefinitions.set(loaded.chunk, loaded); else definition = loaded } },
    speechSynthesis: { cancel() { speech.cancel += 1 }, speak(utterance) { speech.speak.push(utterance) }, getVoices() { return options.voices || [] } },
    innerWidth: options.width || 1400,
    innerHeight: options.height || 900,
    addEventListener(type, fn) { windowListeners.set(type, fn) },
    removeEventListener(type) { windowListeners.delete(type) },
  }
  let definition = null
  const chunkDefinitions = new Map()
  const sandbox = {
    window: windowStub, localStorage, document: documentStub,
    navigator: { language: options.language || 'zh-CN' },
    URL,
    SpeechSynthesisUtterance: class SpeechSynthesisUtterance { constructor(text) { this.text = text } },
    fetch: async (url, init) => { fetchCalls.push({ url: String(url), init }); return { ok: true, async json() { return { v: 1, ok: true, reply: '我在这里。' } } } },
    setTimeout(fn, ms) { timers.timeouts.push({ fn, ms }); return timers.timeouts.length },
    clearTimeout() { timers.cleared += 1 },
    setInterval(fn, ms) { timers.intervals.push({ fn, ms }); return timers.intervals.length },
    clearInterval() { timers.cleared += 1 },
    console,
  }
  sandbox.globalThis = sandbox
  // Deterministic randomness: ambient bubbles always pass the dialogue-mode
  // probability, so the bubble tests are not flaky.
  const mathStub = Object.create(Math)
  mathStub.random = options.random || (() => 0)
  sandbox.Math = mathStub
  vm.createContext(sandbox)
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' })
  assert.ok(definition, 'client.js registers a module')
  const React = createFakeReact()
  const requireModule = (name) => {
    if (name !== 'react') throw new Error('unexpected require: ' + name)
    return React.api
  }
  const asyncCalls = []
  requireModule.async = (spec) => {
    const fileName = String(spec).replace(/^\.\//, '')
    asyncCalls.push(fileName)
    if (!chunkDefinitions.has(fileName)) {
      const chunkSource = readFileSync(join(dirname(CLIENT_PATH), fileName), 'utf8')
      vm.runInContext(chunkSource, sandbox, { filename: fileName })
    }
    const registration = chunkDefinitions.get(fileName)
    assert.ok(registration, 'chunk registered: ' + fileName)
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
  // Business bridge calls only; the mount hello/probe handshake is not user traffic.
  const businessCalls = () => fetchCalls.filter((call) => {
    try { const op = JSON.parse(call.init && call.init.body).op; return op !== 'hello' && op !== 'probe' } catch { return true }
  })
  return { ui, storage, fetchCalls, businessCalls, asyncCalls, speech, module: moduleObject, documentListeners: listeners, windowListeners, window: windowStub }
}

/* ---------------- behavior helpers ---------------- */

function petImage(ui) { return ui.findAll((node) => node.type === 'img')[0] }
function settingsDialog(ui) { return ui.findAll((node) => node.type === 'div' && node.props.role === 'dialog' && node.props['aria-label'] === '设置')[0] }
function menuNode(ui) { return ui.findAll((node) => node.type === 'div' && node.props.role === 'menu')[0] }
function menuItemNodes(ui) { return ui.findAll((node) => node.type === 'button' && node.props.role === 'menuitem') }
function openMenuAt(ui, x = 120, y = 200) {
  const pet = ui.findPetButton()
  assert.ok(pet, 'pet button exists')
  pet.props.onContextMenu({ preventDefault() {}, nativeEvent: { clientX: x, clientY: y } })
  ui.render()
  return menuNode(ui)
}
function clickMenuItem(ui, label) {
  const node = menuItemNodes(ui).find((item) => ui.text(item).includes(label))
  assert.ok(node, 'menu item exists: ' + label)
  ui.click(node)
  ui.render()
}
function openSettings(ui) { openMenuAt(ui); clickMenuItem(ui, '设置') }
function rangeByLabel(ui, label) { return ui.findAll((node) => node.type === 'input' && node.props.type === 'range' && node.props['aria-label'] === label)[0] }
function setRange(ui, label, value) {
  const node = rangeByLabel(ui, label)
  assert.ok(node, 'range slider exists: ' + label)
  ui.change(node, value)
  ui.render()
}
function advancedToggle(ui) { return ui.findAll((node) => node.type === 'button' && ui.text(node).includes('高级 / 调试'))[0] }
function componentSelect(ui, label) { return ui.findAll((node) => node.type === 'select' && String(node.props['aria-label'] || '').startsWith(label + ' '))[0] }
function closeDialog(ui) { ui.click(ui.findButtonByAria('关闭')); ui.render() }
function storedOrNull(storage, key) { return storage.has(key) ? storage.get(key) : null }

/* ---------------- behavior tests ---------------- */

test('fresh profile renders the 100% shipped look without writing scale keys', () => {
  const { ui, storage, businessCalls } = createHarness()
  const image = petImage(ui)
  assert.equal(image.props.width, 72, 'shipped 72px pet')
  assert.equal(image.props.height, 72)
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '1', 'UI scale 100%')
  assert.equal(ui.tree.props.style['--dsh-famling-bubble-zoom'], '1', 'bubble 100%')
  assert.equal(storage.has('dsh-famling/scale/model'), false, 'no scale write before the user changes anything')
  assert.equal(storage.has('dsh-famling/scale/global'), false)
  assert.equal(businessCalls().length, 0, 'scale load never makes a bridge business call')
})

test('settings IA: 整体缩放 first, UI+文本/图像 independent second, component scaling folded in 高级', () => {
  const { ui, businessCalls } = createHarness()
  openSettings(ui)
  const dialog = settingsDialog(ui)
  assert.ok(dialog, 'settings dialog renders from the lazy chunk')
  const text = ui.text(dialog)
  assert.ok(text.includes('整体缩放（所有内容一并缩放）'), 'first level: 整体缩放')
  assert.ok(text.indexOf('整体缩放（所有内容一并缩放）') < text.indexOf('缩放（独立轴）'), '整体缩放 is above the independent axes')
  const globalSlider = rangeByLabel(ui, '整体缩放（所有内容一并缩放）')
  assert.ok(globalSlider, 'global scale slider is a native range input')
  assert.deepEqual([globalSlider.props.min, globalSlider.props.max, globalSlider.props.step, globalSlider.props.value], [50, 200, 5, 100], 'global 50%-200% step 5')
  const uiTextSlider = rangeByLabel(ui, 'UI + 文本')
  assert.deepEqual([uiTextSlider.props.min, uiTextSlider.props.max, uiTextSlider.props.value], [40, 150, 100], 'UI+text 40%-150%, follows the overall scale at 100%')
  const imageSlider = rangeByLabel(ui, '图像')
  assert.deepEqual([imageSlider.props.min, imageSlider.props.max, imageSlider.props.value], [50, 200, 100], 'image 50%-200%, follows the overall scale at 100%')
  for (const slider of [globalSlider, uiTextSlider, imageSlider]) {
    assert.equal(slider.props.type, 'range', 'native range keeps keyboard operation free')
    assert.equal(slider.props.tabIndex, undefined, 'slider is not removed from the tab order')
    assert.match(String(slider.props['aria-valuetext']), /%/, 'the value is announced as a percentage')
  }
  assert.equal(text.includes('组件缩放（默认全部继承）'), false, 'component scaling is folded by default')
  const toggle = advancedToggle(ui)
  assert.ok(toggle, 'advanced group toggle exists')
  assert.equal(toggle.props['aria-expanded'], false, 'advanced is collapsed')
  ui.click(toggle)
  ui.render()
  const expanded = ui.text(settingsDialog(ui))
  assert.ok(expanded.includes('组件缩放（默认全部继承）'), 'advanced expands the component scaling')
  assert.ok(expanded.includes('默认继承 UI + 文本'), 'the inherit default is explained')
  const selects = ui.findAll((node) => node.type === 'select' && String(node.props['aria-label'] || '').includes('组件缩放'))
  assert.equal(selects.length, 5, 'bubble / menu / panel / contentHub / settings')
  for (const select of selects) {
    assert.equal(select.props.value, '1', 'every component inherits by default')
    const options = select.children.filter((child) => child && child.type === 'option').map((option) => textOf(option))
    assert.ok(options.includes('继承（跟随 UI + 文本）'), 'inherit option')
    assert.ok(options.some((option) => option === '125%'), 'override options')
  }
  assert.equal(businessCalls().length, 0, 'opening settings and expanding advanced never makes a bridge business call')
})

test('整体缩放 scales image + UI + components together and persists dsh-famling/scale', () => {
  const { ui, storage, businessCalls } = createHarness()
  openSettings(ui)
  setRange(ui, '整体缩放（所有内容一并缩放）', '150')
  assert.equal(petImage(ui).props.width, 108, '72px x 150% = 108px')
  assert.equal(petImage(ui).props.height, 108)
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '1.5', 'UI/text follows the overall scale')
  assert.equal(ui.tree.props.style['--dsh-famling-bubble-zoom'], '1.5', 'bubble follows the overall scale')
  assert.equal(storage.get('dsh-famling/scale/model'), '1', 'model version persisted')
  assert.equal(storage.get('dsh-famling/scale/global'), '1.5')
  assert.equal(storedOrNull(storage, 'dsh-famling/scale/ui-text'), null, 'following axes are not written')
  assert.equal(storedOrNull(storage, 'dsh-famling/scale/image'), null)
  assert.equal(businessCalls().length, 0, 'changing the scale never makes a bridge business call')
  setRange(ui, '整体缩放（所有内容一并缩放）', '50')
  assert.equal(petImage(ui).props.width, 36, '72px x 50%')
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '0.6', 'UI/text is floored at the readability cap 0.6x')
})

test('UI+文本 and 图像 are independent and 跟随整体 restores one axis', () => {
  const { ui, storage } = createHarness()
  openSettings(ui)
  setRange(ui, '整体缩放（所有内容一并缩放）', '150')
  setRange(ui, 'UI + 文本', '125')
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '1.875', 'UI/text = 1.5 x 1.25')
  assert.equal(ui.tree.props.style['--dsh-famling-bubble-zoom'], '1.875')
  assert.equal(petImage(ui).props.width, 108, 'the image does not move with the text axis')
  assert.equal(storage.get('dsh-famling/scale/ui-text'), '1.25')
  const follow = ui.findButtonByAria('UI + 文本 跟随整体')
  assert.ok(follow, 'follow-overall button for UI+text')
  assert.equal(follow.props.disabled, false, 'follow is enabled once decoupled')
  ui.click(follow)
  ui.render()
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '1.5')
  assert.equal(storedOrNull(storage, 'dsh-famling/scale/ui-text'), null, 'following again removes the override key')
  assert.equal(ui.findButtonByAria('UI + 文本 跟随整体').props.disabled, true, 'follow is disabled while following')
  setRange(ui, '图像', '50')
  assert.equal(petImage(ui).props.width, 54, '72px x 1.5 x 0.5 = 54px')
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '1.5', 'the text axis does not move with the image')
  assert.equal(storage.get('dsh-famling/scale/image'), '0.5')
  ui.click(ui.findButtonByAria('图像 跟随整体'))
  ui.render()
  assert.equal(petImage(ui).props.width, 108)
  assert.equal(storedOrNull(storage, 'dsh-famling/scale/image'), null)
})

test('恢复默认缩放 resets every axis/component and keeps the version marker', () => {
  const { ui, storage } = createHarness({ storage: { 'dsh-famling/scale/model': '1', 'dsh-famling/scale/global': '1.5', 'dsh-famling/scale/ui-text': '1.25', 'dsh-famling/scale/image': '0.75', 'dsh-famling/scale/component/bubble': '1.5' } })
  openSettings(ui)
  assert.equal(rangeByLabel(ui, '整体缩放（所有内容一并缩放）').props.value, 150, 'stored scale restored into the dialog')
  ui.click(ui.findButtonByAria('恢复默认缩放'))
  ui.render()
  assert.equal(petImage(ui).props.width, 72)
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '1')
  assert.equal(storage.get('dsh-famling/scale/global'), '1')
  assert.equal(storage.get('dsh-famling/scale/model'), '1', 'reset keeps the marker so legacy keys stay inert')
  assert.equal(storedOrNull(storage, 'dsh-famling/scale/ui-text'), null)
  assert.equal(storedOrNull(storage, 'dsh-famling/scale/image'), null)
  assert.equal(storedOrNull(storage, 'dsh-famling/scale/component/bubble'), null)
})

test('component overrides scale one component, default to inherit and restore inherit', () => {
  const { ui, storage } = createHarness()
  openSettings(ui)
  ui.click(advancedToggle(ui))
  ui.render()
  const bubbleSelect = componentSelect(ui, '气泡')
  assert.ok(bubbleSelect, 'bubble component select')
  assert.equal(bubbleSelect.props.value, '1', 'bubble inherits by default')
  ui.change(bubbleSelect, '1.25')
  ui.render()
  assert.equal(storage.get('dsh-famling/scale/component/bubble'), '1.25')
  assert.equal(ui.tree.props.style['--dsh-famling-bubble-zoom'], '1.25', 'only the bubble zoom changes')
  assert.ok(ui.text(settingsDialog(ui)).includes('实际 1.25×'), 'the actual resolved zoom is shown')
  ui.change(componentSelect(ui, '气泡'), '1')
  ui.render()
  assert.equal(storedOrNull(storage, 'dsh-famling/scale/component/bubble'), null, 'restoring inherit removes the override key')
  assert.equal(ui.tree.props.style['--dsh-famling-bubble-zoom'], '1')
})

test('the scaled context menu is clamped inside the viewport', () => {
  const { ui, storage } = createHarness({ storage: { 'dsh-famling/scale/model': '1', 'dsh-famling/scale/global': '1', 'dsh-famling/scale/component/menu': '1.5' } })
  openMenuAt(ui, 1390, 890)
  const menu = menuNode(ui)
  assert.ok(menu, 'menu opens')
  assert.equal(menu.props.style.transform, 'scale(1.5)', 'menu is scaled as one unit')
  assert.equal(menu.props.style.left, 1400 - 300 - 8, 'scaled width participates in the right-edge clamp')
  assert.equal(menu.props.style.top, 900 - 282 - 8, 'scaled height participates in the bottom-edge clamp')
  assert.ok(menu.props.style.left + 300 <= 1400 - 8)
  assert.ok(menu.props.style.top + 282 <= 900 - 8)
})

test('slider/model clamps keep extreme values inside the declared bounds', () => {
  const { ui, storage } = createHarness()
  openSettings(ui)
  setRange(ui, '整体缩放（所有内容一并缩放）', '999')
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '2', 'global capped at 200%')
  assert.equal(petImage(ui).props.width, 144)
  assert.equal(storage.get('dsh-famling/scale/global'), '2')
  setRange(ui, 'UI + 文本', '999')
  assert.equal(ui.tree.props.style['--dsh-famling-ui-scale'], '2.5', 'UI/text effective cap 2.5x')
  assert.equal(storage.get('dsh-famling/scale/ui-text'), '1.5')
  const narrow = createHarness()
  openSettings(narrow.ui)
  setRange(narrow.ui, '图像', '0')
  assert.equal(petImage(narrow.ui).props.width, 36, 'image floored at 50%')
  assert.equal(narrow.storage.get('dsh-famling/scale/image'), '0.5')
})

test('bubble stays within the 240px sidebar budget and the viewport', () => {
  const wide = createHarness()
  wide.ui.clickPetAt(51, 27)
  wide.ui.render()
  let bubble = wide.ui.findBubble()
  assert.ok(bubble, 'tapping the head shows the bubble')
  assert.equal(bubble.props.style.maxWidth, 240, 'bubble is capped to the 240px sidebar budget')
  assert.match(String(bubble.props.style.fontSize), /var\(--dsh-famling-font-size/, 'bubble font follows the stored font size')
  assert.match(String(bubble.props.style.fontSize), /var\(--dsh-famling-bubble-zoom/, 'bubble font follows the bubble component zoom')
  const narrow = createHarness({ width: 260, height: 700 })
  openSettings(narrow.ui)
  setRange(narrow.ui, '整体缩放（所有内容一并缩放）', '200')
  closeDialog(narrow.ui)
  narrow.ui.clickPetAt(51, 27)
  narrow.ui.render()
  bubble = narrow.ui.findBubble()
  assert.ok(bubble)
  assert.equal(narrow.ui.tree.props.style['--dsh-famling-bubble-zoom'], '2', 'bubble text scales with the overall scale')
  assert.equal(bubble.props.style.maxWidth, 240)
  assert.ok(bubble.props.style.left + bubble.props.style.maxWidth <= 260 - 8, 'bubble never overflows the viewport')
  assert.ok(Number.isFinite(bubble.props.style.maxHeight) && bubble.props.style.maxHeight > 0, 'bubble is height-capped')
})

test('scale controls are keyboard/ARIA operable and component selects are labelled', () => {
  const { ui } = createHarness()
  openSettings(ui)
  const dialog = settingsDialog(ui)
  assert.equal(dialog.props.role, 'dialog', 'settings dialog semantics')
  const slider = rangeByLabel(ui, '整体缩放（所有内容一并缩放）')
  assert.equal(slider.props.type, 'range', 'native range is keyboard operable')
  assert.ok(slider.props['aria-label'], 'slider has an accessible name')
  assert.ok(slider.props['aria-valuetext'], 'slider announces a value text')
  const toggle = advancedToggle(ui)
  assert.equal(toggle.props['aria-expanded'], false)
  ui.click(toggle)
  ui.render()
  assert.equal(advancedToggle(ui).props['aria-expanded'], true, 'advanced toggle announces its state')
  for (const label of ['气泡', '右键菜单', '面板', '内容中心', '设置弹窗']) {
    assert.ok(componentSelect(ui, label), 'component select: ' + label)
  }
  assert.equal(ui.findButtonByAria('UI + 文本 跟随整体').props.disabled, true, 'follow control is disabled while inheriting')
  assert.equal(ui.findButtonByAria('图像 跟随整体').props.disabled, true)
  assert.ok(ui.findButtonByAria('恢复默认缩放'), 'reset has an accessible name')
})

test('stored scale choices restore on the next mount', () => {
  const { ui, storage } = createHarness()
  openSettings(ui)
  setRange(ui, '整体缩放（所有内容一并缩放）', '175')
  ui.click(advancedToggle(ui))
  ui.render()
  ui.change(componentSelect(ui, '气泡'), '1.25')
  ui.render()
  const seeded = Object.fromEntries(storage.entries())
  const second = createHarness({ storage: seeded })
  assert.equal(petImage(second.ui).props.width, 126, '72px x 175% = 126px')
  assert.equal(second.ui.tree.props.style['--dsh-famling-ui-scale'], '1.75')
  assert.equal(second.ui.tree.props.style['--dsh-famling-bubble-zoom'], '2', '1.75 x 1.25 bubble override clamped to 2x')
  assert.equal(second.businessCalls().length, 0, 'restoring the scale never makes a bridge business call')
})

test('legacy absolute pet/text scales migrate once on mount and are then inert', () => {
  const legacy = createHarness({ storage: { 'dsh-famling/scale': JSON.stringify({ pet: 1.5, text: 1.25 }) } })
  assert.equal(petImage(legacy.ui).props.width, 108, 'legacy pet scale 1.5 preserved as image 150%')
  assert.equal(legacy.ui.tree.props.style['--dsh-famling-ui-scale'], '1.25', 'legacy text scale preserved as UI/text 125%')
  assert.equal(legacy.storage.get('dsh-famling/scale/model'), '1', 'migration writes the model marker')
  assert.equal(legacy.storage.get('dsh-famling/scale/image'), '1.5')
  assert.equal(legacy.storage.get('dsh-famling/scale/ui-text'), '1.25')
  assert.equal(legacy.storage.get('dsh-famling/scale'), JSON.stringify({ pet: 1.5, text: 1.25 }), 'legacy keys are left in place as backup')
  const seeded = Object.fromEntries(legacy.storage.entries())
  seeded['dsh-famling/scale'] = '2'
  const again = createHarness({ storage: seeded })
  assert.equal(petImage(again.ui).props.width, 108, 'the new image key wins; the legacy 2 is inert')
  assert.equal(again.storage.get('dsh-famling/scale/image'), '1.5')
})

test('清除本机设置与同意 removes every scale key and does not write them back', () => {
  const { ui, storage } = createHarness({ storage: { 'dsh-famling/scale/model': '1', 'dsh-famling/scale/global': '1.5', 'dsh-famling/scale/ui-text': '1.25', 'dsh-famling/scale/component/bubble': '1.5', 'dsh-famling/text-scale': '1.2' } })
  openSettings(ui)
  ui.clickText('清除本机设置与同意')
  ui.render()
  const remaining = [...storage.keys()].filter((key) => key.startsWith('dsh-famling/'))
  assert.deepEqual(remaining, [], 'every dsh-famling/* key is gone, including the scale model')
})

test('scale interactions never fetch and load only the lazy content UI chunk', () => {
  const { ui, businessCalls, asyncCalls } = createHarness()
  openSettings(ui)
  setRange(ui, '整体缩放（所有内容一并缩放）', '150')
  setRange(ui, 'UI + 文本', '125')
  ui.click(advancedToggle(ui))
  ui.render()
  ui.change(componentSelect(ui, '面板'), '1.25')
  ui.render()
  assert.equal(businessCalls().length, 0, 'no bridge business request for any scale interaction')
  assert.ok(asyncCalls.includes('client.content.js'), 'the scale controls come from the lazy package-local chunk')
  assert.equal(asyncCalls.filter((name) => name.startsWith('client.anims.')).length, 1, 'opening settings does not download other characters')
})

test('the scale UI never touches the DSH global theme and stays offline', () => {
  assert.equal(clientSource.includes('document.documentElement'), false, 'the widget never writes host root variables')
  assert.equal(contentSource.includes('document.documentElement'), false)
  assert.equal(contentSource.includes('fetch('), false, 'the settings/content chunk never fetches')
  for (const label of ['整体缩放（所有内容一并缩放）', '缩放（独立轴）', '组件缩放（默认全部继承）', '恢复默认缩放', '继承（跟随 UI + 文本）']) {
    assert.ok(contentSource.includes(label), 'scale UI string: ' + label)
  }
  assert.ok(contentSource.includes("type: 'range'"), 'scale controls are native range inputs')
  assert.ok(contentSource.includes("'aria-valuetext'"), 'scale controls carry aria-valuetext')
  assert.ok(contentSource.includes('panelDialogStyle'), 'panels use the zoom-fitted box')
  assert.ok(contentSource.includes('scaleCatalog.storageKeys'), 'clear-local-data covers every scale key')
  assert.ok(clientSource.includes("'--dsh-famling-ui-scale'") && clientSource.includes("'--dsh-famling-bubble-zoom'"), 'resolved scales are widget-scoped CSS variables')
})

test('scaled panels fit a narrow DSH sidebar/window and re-fit on resize', () => {
  const narrow = createHarness({ width: 360, height: 480 })
  openSettings(narrow.ui)
  const dialog = settingsDialog(narrow.ui)
  assert.ok(dialog, 'settings dialog opens on a narrow window')
  assert.ok(dialog.props.style.width <= 360 - 12 - 8, 'panel layout width fits the viewport')
  assert.equal(dialog.props.style.width, dialog.props.style.maxWidth, 'width and maxWidth stay in sync with the zoom')
  assert.ok(dialog.props.style.maxHeight <= 480 - 90 - 8, 'panel max height fits above the anchor')
  assert.equal(dialog.props.style.transform, 'scale(1)')
  closeDialog(narrow.ui)
  // Resize the window: the widget re-renders so the fitted image follows it.
  const resized = createHarness()
  openSettings(resized.ui)
  setRange(resized.ui, '整体缩放（所有内容一并缩放）', '200')
  closeDialog(resized.ui)
  assert.equal(petImage(resized.ui).props.width, 144)
  resized.window.innerHeight = 120
  resized.windowListeners.get('resize')()
  resized.ui.render()
  assert.equal(petImage(resized.ui).props.width, 104, 'the pet re-fits the shorter viewport (104px from 120px height)')
})
