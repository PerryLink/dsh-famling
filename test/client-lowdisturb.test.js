/**
 * E7 剩余 / P-04: quiet hours, motion preference and temporary hide.
 *
 * Pure model tests extract the marked low-disturb block from client.js (the same
 * way test/client-scale.test.js covers the scale model) so clock/storage edges
 * are pinned without a DOM. The rendered/settings behaviour is covered in
 * test/client-behavior.test.js.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientSource = readFileSync(join(ROOT, 'client.js'), 'utf8')
const contentSource = readFileSync(join(ROOT, 'client.content.js'), 'utf8')
const BEGIN = '// <dsh-famling:lowdisturb:begin>'
const END = '// <dsh-famling:lowdisturb:end>'

/** Extract the marked pure block and expose its constants/functions. */
function loadLowDisturbModel() {
  const start = clientSource.indexOf(BEGIN)
  const stop = clientSource.indexOf(END)
  assert.ok(start >= 0 && stop > start, 'low-disturb model markers exist in client.js')
  const block = clientSource.slice(start + BEGIN.length, stop)
  const exports = ['HIDDEN_KEY', 'QUIET_HOURS_DEFAULT', 'MOTION_MODES', 'clockMinutes', 'normalizeQuietHours', 'isQuietHoursActive', 'systemPrefersReducedMotion', 'resolveMotionPreference', 'loadHiddenUntil', 'hideDeadline']
  return new Function(block + '\nreturn {' + exports.join(', ') + '}')()
}
const model = loadLowDisturbModel()

/** Fixed local dates keep the boundary tests independent of the runner's hour. */
function at(hours, minutes) { return new Date(2026, 4, 1, hours, minutes, 0, 0) }
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]))
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) { map.set(key, String(value)) },
    removeItem(key) { map.delete(key) },
    map,
  }
}

test('low-disturb defaults and storage key are stable', () => {
  assert.equal(model.HIDDEN_KEY, 'dsh-famling/hidden-until', 'namespaced hidden deadline key')
  assert.deepEqual(model.QUIET_HOURS_DEFAULT, { enabled: true, start: '22:00', end: '08:00' }, 'DEC-05: 22:00-08:00, default on')
  assert.deepEqual(model.MOTION_MODES, ['auto', 'on', 'off'], 'auto (system) / on / off')
  assert.equal(typeof model.systemPrefersReducedMotion(), 'boolean', 'system preference probe is safe without a DOM')
})

test('clockMinutes parses HH:MM and rejects malformed values', () => {
  assert.equal(model.clockMinutes('00:00'), 0)
  assert.equal(model.clockMinutes('08:00'), 480)
  assert.equal(model.clockMinutes('22:30'), 1350)
  assert.equal(model.clockMinutes('8:05'), 485, 'one-digit hour accepted')
  for (const bad of ['', null, undefined, 2200, '24:00', '12:60', '12:5', 'ab:cd', ' 22:00']) assert.equal(model.clockMinutes(bad), null, 'rejects ' + String(bad))
})

test('normalizeQuietHours keeps a safe window and falls back on corruption', () => {
  assert.deepEqual(model.normalizeQuietHours(null), { enabled: true, start: '22:00', end: '08:00' }, 'null -> defaults (never a 24h silence)')
  assert.deepEqual(model.normalizeQuietHours({ start: '23:15', end: '07:30', enabled: false }), { enabled: false, start: '23:15', end: '07:30' }, 'custom window + explicit off')
  assert.deepEqual(model.normalizeQuietHours({ enabled: false }), { enabled: false, start: '22:00', end: '08:00' })
  assert.deepEqual(model.normalizeQuietHours({ enabled: 'false', start: '9:00', end: 'nope' }), { enabled: true, start: '9:00', end: '08:00' }, 'only boolean false disables; malformed end falls back')
})

test('isQuietHoursActive pins the 22:00/08:00 boundaries and wraparound', () => {
  const quiet = model.normalizeQuietHours()
  assert.equal(model.isQuietHoursActive(quiet, at(21, 59)), false, '21:59 is not quiet')
  assert.equal(model.isQuietHoursActive(quiet, at(22, 0)), true, '22:00 is quiet')
  assert.equal(model.isQuietHoursActive(quiet, at(0, 0)), true, 'midnight is quiet')
  assert.equal(model.isQuietHoursActive(quiet, at(7, 59)), true, '07:59 is quiet')
  assert.equal(model.isQuietHoursActive(quiet, at(8, 0)), false, '08:00 is not quiet')
  assert.equal(model.isQuietHoursActive(quiet, at(12, 0)), false, 'daytime is not quiet')
  const custom = model.normalizeQuietHours({ start: '13:00', end: '14:00' })
  assert.equal(model.isQuietHoursActive(custom, at(12, 59)), false)
  assert.equal(model.isQuietHoursActive(custom, at(13, 30)), true)
  assert.equal(model.isQuietHoursActive(custom, at(14, 0)), false)
  assert.equal(model.isQuietHoursActive(model.normalizeQuietHours({ enabled: false }), at(23, 0)), false, 'disabled window is inert')
  assert.equal(model.isQuietHoursActive(model.normalizeQuietHours({ start: '10:00', end: '10:00' }), at(10, 0)), false, 'start === end disables (no accidental 24h silence)')
})

test('resolveMotionPreference: auto follows the system, explicit on/off wins', () => {
  assert.equal(model.resolveMotionPreference('auto', true), false, 'auto + prefers-reduced-motion -> no motion')
  assert.equal(model.resolveMotionPreference('auto', false), true, 'auto + no preference -> motion')
  assert.equal(model.resolveMotionPreference('on', true), true, 'explicit on overrides the system')
  assert.equal(model.resolveMotionPreference('off', false), false, 'explicit off overrides the system')
  assert.equal(model.resolveMotionPreference('bogus', false), true, 'unknown modes fall back to auto')
})

test('loadHiddenUntil accepts only a future stored deadline', () => {
  const now = at(12, 0).getTime()
  const store = memoryStorage()
  store.setItem(model.HIDDEN_KEY, String(now + 3600000))
  const RealNow = Date.now
  Date.now = () => now
  try {
    assert.equal(model.loadHiddenUntil(store), now + 3600000, 'future deadline is restored')
    store.setItem(model.HIDDEN_KEY, String(now - 1))
    assert.equal(model.loadHiddenUntil(store), 0, 'expired deadline is dropped')
    store.setItem(model.HIDDEN_KEY, 'not-a-number')
    assert.equal(model.loadHiddenUntil(store), 0, 'non-numeric deadline is dropped')
    assert.equal(model.loadHiddenUntil(null), 0, 'missing storage is safe')
    assert.equal(model.loadHiddenUntil({ getItem() { throw new Error('denied') } }), 0, 'throwing storage is safe')
  } finally { Date.now = RealNow }
})

test('hideDeadline: one hour or the next quiet-hours end', () => {
  const now = at(12, 0).getTime()
  assert.equal(model.hideDeadline('hour', null, now), now + 3600000, 'hide for one hour')
  const tomorrow = new Date(model.hideDeadline('tomorrow', model.normalizeQuietHours(), now))
  assert.equal(tomorrow.getDate(), 2, 'tomorrow is the next calendar day')
  assert.equal(tomorrow.getHours(), 8, 'default quiet-hours end (08:00)')
  assert.equal(tomorrow.getMinutes(), 0)
  const custom = new Date(model.hideDeadline('tomorrow', { start: '23:00', end: '07:30' }, now))
  assert.equal(custom.getHours(), 7, 'custom quiet-hours end hour')
  assert.equal(custom.getMinutes(), 30, 'custom quiet-hours end minute')
})

test('quiet hours / motion / hide stay wired in the entry and lazy settings chunk', () => {
  // Runtime gates in client.js: ambient suppression is time-aware, automatic
  // micro actions are >=60s apart and re-check quiet hours, hidden persists.
  assert.ok(clientSource.includes("source === 'ambient' && (dialogueMode === 'quiet' || isQuietHoursActive(settings.quietHours)"), 'ambient output is gated by quiet hours')
  assert.ok(clientSource.includes('isQuietHoursActive(settings.quietHours) || hostStatus.current?.busy'), 'a busy host agent reuses the quiet-hour suppression')
  assert.ok(clientSource.includes('60000 + Math.random() * 30000'), 'automatic micro actions are >=60s apart')
  assert.ok(clientSource.includes('if (isQuietHoursActive(settings.quietHours) || hostStatus.current?.busy || window.__famlingFocus?.until > Date.now()) { schedule(); return }'), 'micro actions re-check quiet hours, host busy and a memory-only focus session at fire time')
  assert.ok(clientSource.includes('const HIDDEN_KEY = \'dsh-famling/hidden-until\''), 'hidden deadline storage key')
  assert.ok(clientSource.includes('function restoreHidden()'), 'early restore exists')
  assert.ok(clientSource.includes('panelChunk.createInputPanel('), 'input panel renders from the lazy chunk')
  assert.ok(clientSource.includes('panelChunk.createConsentDialog('), 'consent dialog renders from the lazy chunk')
  assert.ok(clientSource.includes('panelChunk.createNoticePanel('), 'usage notice renders from the lazy chunk')
  assert.equal(/h\('textarea'/.test(clientSource), false, 'entry holds no textarea markup (first-screen budget)')
  // Settings UI in the lazy chunk.
  for (const label of ["lowDisturbGroup: '低打扰'", "quietHours: '安静时段'", "motionPref: '动画偏好'", "motionAuto: '跟随系统'", "motionOn: '允许动画'", "motionOff: '减少动态'", "hideHour: '隐藏 1 小时'", "hideTomorrow: '隐藏到明天'", "role: 'status'", "type: 'time'"]) {
    assert.ok(contentSource.includes(label), 'settings chunk exposes: ' + label)
  }
  assert.ok(contentSource.includes("'dsh-famling/hidden-until'"), 'clear-local-data covers the hidden deadline key')
})
