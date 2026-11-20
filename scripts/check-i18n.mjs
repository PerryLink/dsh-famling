#!/usr/bin/env node
/**
 * Plugin i18n / locale single-source gate (MB-108, task-138).
 *
 *   node scripts/check-i18n.mjs
 *   node scripts/check-i18n.mjs --json
 *
 * The plugin has exactly two hand-maintained UI dictionaries and one metadata
 * pair, and this script keeps them from drifting:
 *   - client.js `L` (menu/bubble/settings-entry labels; zh + en);
 *   - client.content.js `STRINGS` (content-center + unified-settings copy;
 *     zh + en, the lazy chunk);
 *   - locale/zh.json + locale/en.json (DSH package metadata only).
 *
 * Checks: both locales exist in every block; the key trees agree (the one
 * declared exception is en-only `L.actionLabels`: zh intentionally falls back
 * to the localized action.label from the famling data); every referenced key
 * resolves; no dead keys remain; locale metadata version == package.json and
 * the two locale files have the same structure.
 *
 * The check is pure/read-only. It is exercised by `test/i18n.test.js` (real
 * repo + helper unit tests); no runtime file fetches a second dictionary.
 *
 * Exit: 0 = clean, 1 = drift, 2 = usage error.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Declared en-only subtrees. zh deliberately has no copy because it uses the
 * localized `action.label` supplied by the famling behavior/regions data.
 */
export const EN_ONLY_L_PATHS = Object.freeze(['actionLabels'])

function readJson(root, rel) {
  const file = join(root, rel)
  if (!existsSync(file)) throw new Error(rel + ' is missing')
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Read one JS string literal ('...' or "..."), returning its value and end offset. */
export function readQuoted(text, start, where) {
  const quote = text[start]
  if (quote !== "'" && quote !== '"') throw new Error(where + ': expected a quoted string at offset ' + start)
  let index = start + 1
  let value = ''
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      const next = text[index + 1]
      if (next === 'u') {
        const hex = text.slice(index + 2, index + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(where + ': bad \\u escape')
        value += String.fromCharCode(parseInt(hex, 16))
        index += 6
        continue
      }
      const escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', "'": "'", '"': '"', '0': '\0' }
      value += escapes[next] ?? next
      index += 2
      continue
    }
    if (char === quote) return { value, end: index + 1 }
    value += char
    index += 1
  }
  throw new Error(where + ': unterminated string literal at offset ' + start)
}

function findMatchingBrace(text, openIndex, where) {
  let depth = 0
  let index = openIndex
  while (index < text.length) {
    const char = text[index]
    if (char === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index)
      index = newline === -1 ? text.length : newline + 1
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
      continue
    }
    if (char === "'" || char === '"') {
      index = readQuoted(text, index, where).end
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
    index += 1
  }
  throw new Error(where + ': unbalanced braces (missing "}")')
}

/** Extract the object literal assigned by `declaration` (e.g. "const L = "). */
export function extractObjectLiteral(source, declaration, where) {
  const start = source.indexOf(declaration)
  if (start === -1) throw new Error(where + ': cannot find declaration "' + declaration.trim() + '"')
  const open = source.indexOf('{', start + declaration.length)
  if (open === -1) throw new Error(where + ': declaration has no object literal')
  const close = findMatchingBrace(source, open, where)
  return source.slice(open, close + 1)
}

/** Evaluate an extracted object literal with explicit free-variable stubs. */
export function evaluateLiteral(literal, bindings, where) {
  const names = Object.keys(bindings)
  try {
    // eslint-disable-next-line no-new-func -- local read-only repo tooling (same pattern as the existing tests)
    return new Function(...names, 'return ' + literal)(...names.map((name) => bindings[name]))
  } catch (error) {
    throw new Error(where + ': object literal is not evaluable: ' + error.message)
  }
}

/** Flatten an object to dotted leaf paths. */
export function flattenKeys(value, prefix = '') {
  const out = []
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? prefix + '.' + key : key
      if (child && typeof child === 'object' && !Array.isArray(child)) out.push(...flattenKeys(child, path))
      else out.push(path)
    }
  }
  return out
}

/** Set difference helper: entries of `left` not present in `right`. */
export function diffKeys(left, right) {
  const rightSet = right instanceof Set ? right : new Set(right)
  return (left instanceof Set ? [...left] : left).filter((key) => !rightSet.has(key))
}

/** Collect static `Prefix.path` references (dotted or bracket-string access). */
export function collectStaticRefs(source, prefix) {
  const refs = new Set()
  const dotted = new RegExp('\\b' + prefix + '\\.([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)', 'g')
  for (const match of source.matchAll(dotted)) refs.add(match[1])
  const bracketed = new RegExp('\\b' + prefix + '\\[\\s*[\'"]([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)[\'"]\\s*\\]', 'g')
  for (const match of source.matchAll(bracketed)) refs.add(match[1])
  return refs
}

/** True when the leaf `path` is covered by a reference (exact or subtree reference). */
function covered(path, refs) {
  if (refs.has(path)) return true
  const parts = path.split('.')
  for (let index = 1; index < parts.length; index += 1) if (refs.has(parts.slice(0, index).join('.'))) return true
  return false
}

/** True when a reference resolves to a defined key (exact key or a defined subtree). */
function resolves(reference, keys) {
  if (keys.has(reference)) return true
  const prefix = reference + '.'
  for (const key of keys) if (key.startsWith(prefix)) return true
  return false
}

/** Extract one top-level function body by its exact "function name(" marker. */
export function extractFunctionBody(source, marker, where) {
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(where + ': cannot find ' + marker)
  const open = source.indexOf('{', start + marker.length)
  if (open === -1) throw new Error(where + ': ' + marker + ' has no body')
  const close = findMatchingBrace(source, open, where)
  return source.slice(open, close + 1)
}

/** Values of the MICRO_LINES table (character micro-action bubble keys). */
export function microLineKeys(source) {
  const literal = extractObjectLiteral(source, 'const MICRO_LINES = ', 'client.js')
  const table = evaluateLiteral(literal, {}, 'client.js MICRO_LINES')
  const keys = new Set()
  for (const character of Object.values(table)) {
    if (!character || typeof character !== 'object') continue
    for (const value of Object.values(character)) if (typeof value === 'string') keys.add(value)
  }
  return keys
}

function localeBlockKeys(source, declarationName, where, bindings) {
  const literal = extractObjectLiteral(source, 'const ' + declarationName + ' = ', where)
  const table = evaluateLiteral(literal, bindings, where + ' ' + declarationName)
  if (!table || typeof table !== 'object' || !table.zh || !table.en) throw new Error(where + ': ' + declarationName + ' must define zh and en')
  return { zh: flattenKeys(table.zh), en: flattenKeys(table.en) }
}

/**
 * Run the whole plugin i18n gate against a plugin root.
 * @param {string} [root] Plugin package root (tests may point it at fixtures).
 * @returns {{ root: string, checks: Array<{ id: string, ok: boolean, detail: string }>, counts: Record<string, number> }}
 */
export function runI18nChecks(root = PLUGIN_ROOT) {
  const checks = []
  const check = (id, ok, detail) => checks.push({ id, ok, detail })
  const counts = { lZh: 0, lEn: 0, stringsZh: 0, stringsEn: 0, localeKeys: 0 }

  let pkg = null
  try {
    pkg = readJson(root, 'package.json')
    check('package-json', typeof pkg.version === 'string' && pkg.version.length > 0, 'package.json version = ' + pkg.version)
  } catch (error) {
    check('package-json', false, error.message)
  }

  // --- locale/*.json: metadata pair, same structure, version-anchored -------
  let localeZh = null
  let localeEn = null
  try {
    localeZh = readJson(root, 'locale/zh.json')
    localeEn = readJson(root, 'locale/en.json')
    const zhKeys = flattenKeys(localeZh)
    const enKeys = flattenKeys(localeEn)
    counts.localeKeys = zhKeys.length
    const missingInEn = diffKeys(zhKeys, enKeys)
    const missingInZh = diffKeys(enKeys, zhKeys)
    check(
      'locale-structure',
      missingInEn.length === 0 && missingInZh.length === 0,
      missingInEn.length === 0 && missingInZh.length === 0
        ? 'locale/zh.json and locale/en.json share the same ' + zhKeys.length + ' metadata keys'
        : 'metadata drift — missing in en: [' + missingInEn.join(', ') + ']; missing in zh: [' + missingInZh.join(', ') + ']',
    )
    const version = pkg && typeof pkg.version === 'string' ? pkg.version : null
    const zhVersion = localeZh?.meta?.version
    const enVersion = localeEn?.meta?.version
    check(
      'locale-version',
      version !== null && zhVersion === version && enVersion === version,
      version !== null && zhVersion === version && enVersion === version
        ? 'both locale files state meta.version ' + version
        : 'locale meta.version must equal package.json ' + version + ' (zh=' + zhVersion + ', en=' + enVersion + ')',
    )
    const titled = (locale) => typeof locale?.meta?.title === 'string' && locale.meta.title.trim().length > 0 && typeof locale.meta.description === 'string' && locale.meta.description.trim().length > 0
    check('locale-meta', titled(localeZh) && titled(localeEn), 'both locale files carry a non-empty meta.title and meta.description')
  } catch (error) {
    check('locale-structure', false, error.message)
  }

  // --- client.js L block ----------------------------------------------------
  let lKeys = null
  let lRefs = null
  try {
    const source = readFileSync(join(root, 'client.js'), 'utf8')
    const version = pkg && typeof pkg.version === 'string' ? pkg.version : '0.0.0'
    lKeys = localeBlockKeys(source, 'L', 'client.js', { PLUGIN_VERSION: version })
    counts.lZh = lKeys.zh.length
    counts.lEn = lKeys.en.length

    const zhSet = new Set(lKeys.zh)
    const enSet = new Set(lKeys.en)
    const enOnly = diffKeys(lKeys.en, lKeys.zh)
    const zhOnly = diffKeys(lKeys.zh, lKeys.en)
    const declared = []
    const undeclared = []
    for (const path of enOnly) {
      if (EN_ONLY_L_PATHS.some((prefix) => path === prefix || path.startsWith(prefix + '.'))) declared.push(path)
      else undeclared.push(path)
    }
    check(
      'client-l-key-parity',
      zhOnly.length === 0 && undeclared.length === 0,
      zhOnly.length === 0 && undeclared.length === 0
        ? 'client.js L: ' + lKeys.zh.length + ' zh / ' + lKeys.en.length + ' en keys; en-only declared: ' + declared.length + ' (actionLabels)'
        : 'client.js L drift — zh-only: [' + zhOnly.join(', ') + ']; undeclared en-only: [' + undeclared.join(', ') + ']',
    )

    // The lazy chunk renders the chat/reminder input panel and receives the
    // client.js locale object as props.strings: its `S.<key>` references are L
    // keys too, so they count for both the used-key and dead-key checks.
    const contentSource = readFileSync(join(root, 'client.content.js'), 'utf8')
    const inputPanel = extractFunctionBody(contentSource, 'function createInputPanel(', 'client.content.js')
    const crossChunkRefs = collectStaticRefs(inputPanel, 'S')
    lRefs = new Set([...collectStaticRefs(source, 'L'), ...microLineKeys(source), ...crossChunkRefs])
    lRefs.delete('zh') // labels() indexes the locale table itself
    lRefs.delete('en')
    const enOnlyPrefixes = EN_ONLY_L_PATHS
    const missingUsed = [...lRefs].filter((path) => {
      const declaredEnOnly = enOnlyPrefixes.some((prefix) => path === prefix || path.startsWith(prefix + '.'))
      return (!declaredEnOnly && !resolves(path, zhSet)) || !resolves(path, enSet)
    })
    check(
      'client-l-used-keys',
      missingUsed.length === 0,
      missingUsed.length === 0 ? lRefs.size + ' client.js L references resolve (plus MICRO_LINES keys)' : 'client.js L references missing from a locale: ' + missingUsed.join(', '),
    )
    const deadZh = lKeys.zh.filter((path) => !covered(path, lRefs) && !EN_ONLY_L_PATHS.some((prefix) => path.startsWith(prefix + '.')))
    const deadEn = lKeys.en.filter((path) => !covered(path, lRefs))
    check(
      'client-l-dead-keys',
      deadZh.length === 0 && deadEn.length === 0,
      deadZh.length === 0 && deadEn.length === 0
        ? 'no dead client.js L keys'
        : 'dead client.js L keys — zh: [' + deadZh.join(', ') + ']; en: [' + deadEn.join(', ') + ']',
    )
  } catch (error) {
    check('client-l-key-parity', false, 'client.js L: ' + error.message)
  }

  // --- client.content.js STRINGS block -------------------------------------
  let stringKeys = null
  try {
    const source = readFileSync(join(root, 'client.content.js'), 'utf8')
    const version = pkg && typeof pkg.version === 'string' ? pkg.version : '0.0.0'
    const consentLiteral = extractObjectLiteral(source, 'const CONSENT_TEXTS = ', 'client.content.js')
    const consentTexts = evaluateLiteral(consentLiteral, { PLUGIN_VERSION: version }, 'client.content.js CONSENT_TEXTS')
    stringKeys = localeBlockKeys(source, 'STRINGS', 'client.content.js', { CONSENT_TEXTS: consentTexts, PLUGIN_VERSION: version })
    counts.stringsZh = stringKeys.zh.length
    counts.stringsEn = stringKeys.en.length
    const zhSet = new Set(stringKeys.zh)
    const enSet = new Set(stringKeys.en)
    const missingInEn = diffKeys(stringKeys.zh, stringKeys.en)
    const missingInZh = diffKeys(stringKeys.en, stringKeys.zh)
    check(
      'client-content-key-parity',
      missingInEn.length === 0 && missingInZh.length === 0,
      missingInEn.length === 0 && missingInZh.length === 0
        ? 'client.content.js STRINGS: both locales expose ' + stringKeys.zh.length + ' keys'
        : 'STRINGS drift — missing in en: [' + missingInEn.join(', ') + ']; missing in zh: [' + missingInZh.join(', ') + ']',
    )
    const refs = collectStaticRefs(source, 'T')
    const missingUsed = [...refs].filter((path) => !resolves(path, zhSet) || !resolves(path, enSet))
    check(
      'client-content-used-keys',
      missingUsed.length === 0,
      missingUsed.length === 0 ? refs.size + ' STRINGS references resolve in both locales' : 'STRINGS references missing from a locale: ' + missingUsed.join(', '),
    )
    const dead = stringKeys.zh.filter((path) => !covered(path, refs))
    const deadEn = stringKeys.en.filter((path) => !covered(path, refs))
    check(
      'client-content-dead-keys',
      dead.length === 0 && deadEn.length === 0,
      dead.length === 0 && deadEn.length === 0 ? 'no dead STRINGS keys' : 'dead STRINGS keys — zh: [' + dead.join(', ') + ']; en: [' + deadEn.join(', ') + ']',
    )
  } catch (error) {
    check('client-content-key-parity', false, 'client.content.js STRINGS: ' + error.message)
  }

  return { root, checks, counts }
}

/** Print a human-readable report and return the process exit code. */
export function report(result, json = false) {
  if (json) {
    console.log(JSON.stringify({ root: result.root, counts: result.counts, checks: result.checks }, null, 2))
  } else {
    for (const entry of result.checks) {
      if (entry.ok) console.log('[i18n] ok   ' + entry.id)
      else console.error('[i18n] FAIL ' + entry.id + ' — ' + entry.detail)
    }
  }
  const failures = result.checks.filter((entry) => !entry.ok)
  if (failures.length > 0) {
    if (!json) console.error('[i18n] FAILED (' + failures.length + '/' + result.checks.length + ' checks)')
    return 1
  }
  if (!json) {
    console.log(
      '[i18n] PASS (' + result.checks.length + ' checks; L ' + result.counts.lZh + '/' + result.counts.lEn +
        ' keys, STRINGS ' + result.counts.stringsZh + '/' + result.counts.stringsEn + ' keys, locale meta ' + result.counts.localeKeys + ' keys)',
    )
  }
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const json = process.argv.includes('--json')
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--json')
  if (unknown.length > 0) {
    console.error('usage: node scripts/check-i18n.mjs [--json]')
    process.exitCode = 2
  } else {
    process.exitCode = report(runI18nChecks(), json)
  }
}
