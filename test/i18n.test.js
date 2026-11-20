/**
 * MB-108: plugin i18n / locale single-source gate tests.
 *
 * The gate itself lives in scripts/check-i18n.mjs so it can run outside the
 * test runner (npm test still enforces it here). This file proves the helpers
 * are not vacuously green and runs the gate over the real package.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EN_ONLY_L_PATHS,
  PLUGIN_ROOT,
  collectStaticRefs,
  diffKeys,
  evaluateLiteral,
  extractFunctionBody,
  extractObjectLiteral,
  flattenKeys,
  readQuoted,
  runI18nChecks,
} from '../scripts/check-i18n.mjs'

test('the real plugin worktree passes every i18n single-source check', () => {
  const result = runI18nChecks()
  const failures = result.checks.filter((entry) => !entry.ok)
  assert.deepEqual(failures.map((entry) => entry.id + ': ' + entry.detail), [])
  assert.deepEqual(result.checks.map((entry) => entry.id).sort(), [
    'client-content-dead-keys',
    'client-content-key-parity',
    'client-content-used-keys',
    'client-l-dead-keys',
    'client-l-key-parity',
    'client-l-used-keys',
    'locale-meta',
    'locale-structure',
    'locale-version',
    'package-json',
  ])
  assert.equal(result.counts.stringsZh, result.counts.stringsEn, 'STRINGS zh/en key counts stay in parity')
  assert.ok(result.counts.lZh > 0 && result.counts.lEn > 0)
  assert.deepEqual([...EN_ONLY_L_PATHS], ['actionLabels'], 'the only declared L asymmetry is en-only actionLabels')
  assert.equal(result.root, PLUGIN_ROOT)
})

test('flattenKeys walks nested dictionaries to dotted leaves', () => {
  assert.deepEqual(flattenKeys({ a: '1', b: { c: '2', d: { e: '3' } } }).sort(), ['a', 'b.c', 'b.d.e'])
  assert.deepEqual(flattenKeys({}), [])
})

test('diffKeys reports both directions independently', () => {
  assert.deepEqual(diffKeys(['a', 'b'], ['b', 'c']), ['a'])
  assert.deepEqual(diffKeys(new Set(['b', 'c']), new Set(['a', 'b'])), ['c'])
  assert.deepEqual(diffKeys(['a'], new Set(['a'])), [])
})

test('readQuoted and extractObjectLiteral survive quotes and braces inside strings', () => {
  const source = "const X = { zh: { k: 'a { b } \\' c' }, en: { k: 'x } y' } }\nconst Y = 1"
  assert.deepEqual(readQuoted("'abc'", 0, 'test'), { value: 'abc', end: 5 })
  assert.equal(readQuoted("'a\\'b'", 0, 'test').value, "a'b")
  const literal = extractObjectLiteral(source, 'const X = ', 'test')
  assert.deepEqual(evaluateLiteral(literal, {}, 'test'), { zh: { k: "a { b } ' c" }, en: { k: 'x } y' } })
})

test('collectStaticRefs finds dotted and bracket-string property access', () => {
  const source = "const a = T.title + T.tabs.roles + T['settings'] + L['actionLabels'].pat + T.dynamic[key]"
  // The dotted pass records the property name before a dynamic index as well;
  // callers only require that real dotted/bracket keys are present.
  assert.deepEqual([...collectStaticRefs(source, 'T')].sort(), ['dynamic', 'settings', 'tabs.roles', 'title'])
  assert.deepEqual([...collectStaticRefs(source, 'L')], ['actionLabels'])
})

test('extractFunctionBody returns exactly one function body', () => {
  const source = 'function panel(props) { const x = { a: 1 }; return x.a }\nfunction other() { return 2 }'
  assert.equal(extractFunctionBody(source, 'function panel(', 'test'), '{ const x = { a: 1 }; return x.a }')
})
