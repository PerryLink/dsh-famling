/**
 * WP-D (0.13.3): client bubble priority scheduling and work-state consumption.
 *
 * The priority model is a hand-written marked block in client.js (the same
 * extraction pattern as test/client-lowdisturb.test.js and client-scale.test.js)
 * so the ambient/interaction/direct ordering and TTL edges are pinned without a
 * DOM. The rendered behaviour (a direct reply blocking a tap, work-state lines
 * gated by settings/quiet hours/visibility) is covered in
 * test/client-behavior.test.js with the hook harness.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientSource = readFileSync(join(ROOT, 'client.js'), 'utf8')
const BEGIN = '// <dsh-famling:bubbles:begin>'
const END = '// <dsh-famling:bubbles:end>'

/** Extract the marked priority block and expose its constants/functions. */
function loadBubbleModel() {
  const start = clientSource.indexOf(BEGIN)
  const stop = clientSource.indexOf(END)
  assert.ok(start >= 0 && stop > start, 'bubble scheduling markers exist in client.js')
  const block = clientSource.slice(start + BEGIN.length, stop)
  const exports = ['BUBBLE_TTL_MS', 'BUBBLE_PRIORITY', 'bubblePriorityOf', 'shouldAcceptBubble']
  return new Function(block + '\nreturn {' + exports.join(', ') + '}')()
}
const model = loadBubbleModel()
const NOW = 1000
const live = (priority, ttl = 500) => ({ priority, until: NOW + ttl })

test('bubble scheduling constants are stable and ordered', () => {
  assert.equal(model.BUBBLE_TTL_MS, 3200, 'the shipped 3200ms bubble TTL is the shared constant')
  assert.deepEqual(model.BUBBLE_PRIORITY, { ambient: 10, interaction: 20, direct: 30 }, 'ambient < interaction < direct')
})

test('bubblePriorityOf maps every source and defaults unknown ones to interaction', () => {
  assert.equal(model.bubblePriorityOf('ambient'), 10)
  assert.equal(model.bubblePriorityOf('interaction'), 20)
  assert.equal(model.bubblePriorityOf('direct'), 30)
  assert.equal(model.bubblePriorityOf('interactive'), 20, 'the existing tap/action call sites keep interaction priority')
  assert.equal(model.bubblePriorityOf('status'), 20, 'work-state lines are interaction priority (not ambient)')
  assert.equal(model.bubblePriorityOf(undefined), 20, 'the default say() source never drops below interaction')
  for (const bogus of ['bogus', '', 0, null, '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(model.bubblePriorityOf(bogus), 20, 'unknown source ' + String(bogus) + ' falls back to interaction')
  }
})

test('shouldAcceptBubble accepts when nothing live is showing', () => {
  assert.equal(model.shouldAcceptBubble(null, live(10), NOW), true, 'no current bubble')
  assert.equal(model.shouldAcceptBubble(undefined, live(10), NOW), true, 'missing current bubble')
  assert.equal(model.shouldAcceptBubble(live(30, -1), live(10), NOW), true, 'an expired direct bubble no longer blocks ambient')
  assert.equal(model.shouldAcceptBubble({ priority: 30, until: NOW }, live(10), NOW), true, 'until === now is expired')
  assert.equal(model.shouldAcceptBubble({ priority: 30 }, live(10), NOW), true, 'a malformed current bubble never blocks')
  assert.equal(model.shouldAcceptBubble({ priority: 30, until: NOW + 500 }, null, NOW), true, 'missing incoming is tolerated')
})

test('shouldAcceptBubble: live lower priorities lose, equal and higher replace', () => {
  const interaction = live(20)
  assert.equal(model.shouldAcceptBubble(interaction, live(10), NOW), false, 'ambient is dropped while an interaction bubble is live')
  assert.equal(model.shouldAcceptBubble(live(10), live(20), NOW), true, 'an interaction line replaces ambient')
  assert.equal(model.shouldAcceptBubble(interaction, live(20), NOW), true, 'an equal-priority line replaces')
  assert.equal(model.shouldAcceptBubble(interaction, live(30), NOW), true, 'direct always replaces')
  const direct = live(30)
  assert.equal(model.shouldAcceptBubble(direct, live(20), NOW), false, 'interaction is dropped while direct is live')
  assert.equal(model.shouldAcceptBubble(direct, live(30), NOW), true, 'a second direct line replaces the first')
})

test('say() runs the priority gate before mutating the bubble timer', () => {
  const sayStart = clientSource.indexOf("function say(text, kind = 'speech', source = 'ambient')")
  assert.ok(sayStart >= 0, 'the single bubble/TTS entry exists')
  const body = clientSource.slice(sayStart, clientSource.indexOf('function anchor()', sayStart))
  assert.ok(body.includes('bubblePriorityOf(source)'), 'say resolves the source priority')
  assert.ok(body.includes('shouldAcceptBubble(bubbleMeta.current, next, Date.now())'), 'say consults the live bubble meta ref')
  assert.ok(body.indexOf('shouldAcceptBubble(bubbleMeta.current') < body.indexOf('setBubble(line)'), 'a rejected line returns before setBubble')
  assert.ok(body.indexOf('bubbleMeta.current = next') < body.indexOf("setTimeout(() => setBubble('')"), 'an accepted line records priority/until before arming the timer')
  assert.ok(body.includes("setTimeout(() => setBubble(''), BUBBLE_TTL_MS)"), 'the 3200ms TTL comes from the shared constant')
  assert.ok(body.includes("source === 'status' && (!settings.bubble || !pageVisible || isQuietHoursActive(settings.quietHours))"), 'work-state lines keep the explicit bubble/visibility/quiet gates')
  assert.ok(body.includes("source === 'ambient' && (dialogueMode === 'quiet'"), 'the existing ambient suppression is untouched')
})

test('the work-state consumer is defensive and wired into the state bridge reply', () => {
  assert.ok(clientSource.includes('function noteWorkState(reply)'), 'the consumer exists in the entry')
  assert.ok(clientSource.includes("try { if (payload.op === 'state') noteWorkState(reply) } catch {}"), 'only coarse state replies are observed, and a consumer throw never breaks the bridge')
  const start = clientSource.indexOf('function noteWorkState(reply)')
  const body = clientSource.slice(start, clientSource.indexOf('function anchor()', start))
  assert.ok(body.includes("/^(idle|working|success|error)$/.test(r.workState)"), 'only the WP-C enum is consumed')
  assert.ok(body.includes('r.available !== true'), 'an unavailable/unsupported host reply is inert')
  assert.ok(body.includes('was === r.workState'), 'repeated reports are silent (success once per transition)')
  assert.ok(body.includes('60000'), 'the error line is cooled down to 60s')
  assert.ok(body.includes("'speech', 'status'"), 'the line is displayed through say() with the dedicated status source')
  assert.ok(body.includes('L.workSuccessLine') && body.includes('L.workErrorLine'), 'both localized keys are consumed')
})

test('the inline zh/en dictionaries carry a paired work-state line and nothing else is added', () => {
  for (const key of ['workSuccessLine:', 'workErrorLine:']) {
    assert.equal(clientSource.split(key).length - 1, 2, key + ' appears once per language (zh + en)')
  }
  assert.ok(clientSource.includes("workSuccessLine: '完成。', workErrorLine: '出错了，请稍后。',"), 'zh lines are local')
  assert.ok(clientSource.includes("workSuccessLine: 'Done.', workErrorLine: 'Failed.',"), 'en lines are local')
  // locale/*.json stays metadata-only for the packaging surface; the UI
  // dictionaries live inline (test/i18n.test.js enforces parity/dead keys).
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const parsed = JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
    assert.deepEqual(Object.keys(parsed), ['meta'], file + ' keeps its metadata-only shape')
  }
})
