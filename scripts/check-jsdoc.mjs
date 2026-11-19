#!/usr/bin/env node
/**
 * Minimal zero-dependency JSDoc + lint gate (MB-107).
 *
 * The plugin has no bundler/lint toolchain and must stay install-free, so this
 * gate implements the smallest useful chain with Node builtins only:
 *
 *   1. syntax: `node --check` every .js/.mjs source file in the package;
 *   2. JSDoc coverage: every exported const needs a preceding JSDoc block and
 *      every exported function needs a block with @param entries for all named
 *      parameters plus @returns — enforced for JSDOC_FILES (the tooling layer
 *      MB-107 owns: content-extension.mjs + the generator/check scripts);
 *   3. generated-code lint: every @generated block in client.js and every lazy
 *      anim chunk carries its generator banner and "do not edit" warning, with
 *      exactly one begin/end marker pair per block;
 *   4. runtime lint: no `debugger` statement in shipped runtime files.
 *
 * Pre-existing JSDoc debt in scripts/embed-anims.mjs, scripts/verify-anims.mjs,
 * scripts/check-package.mjs and scripts/measure-bundle.mjs is reported as an
 * explicit "not yet enforced" list instead of silently passing: those files
 * predate MB-107 and remain outside its write scope (follow-up, MB-108).
 *
 * Usage:
 *   node scripts/check-jsdoc.mjs            # gate (exit 1 on any problem)
 *   node scripts/check-jsdoc.mjs --quiet    # only failures
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Absolute plugin package root. */
export const PLUGIN_ROOT = resolve(HERE, '..')
/** Files whose exported declarations must carry complete JSDoc (MB-107 scope). */
export const JSDOC_FILES = Object.freeze([
  'content-extension.mjs',
  'scripts/check-jsdoc.mjs',
  'scripts/gen-content-constants.mjs',
  'scripts/typecheck.mjs',
])
/** Files that predate this gate; JSDoc coverage is a documented follow-up. */
export const JSDOC_DEBT_FILES = Object.freeze([
  'scripts/check-package.mjs',
  'scripts/embed-anims.mjs',
  'scripts/measure-bundle.mjs',
  'scripts/verify-anims.mjs',
])
/** Shipped runtime files that get the minimal lint rules. */
export const RUNTIME_FILES = Object.freeze([
  'index.js',
  'client.js',
  'client.content.js',
  'content-extension.mjs',
  'client.anims.human.js',
  'client.anims.cat.js',
  'client.anims.dog.js',
])
/** Generated marker pairs: begin, end and the generator named in the banner. */
const GENERATED_BLOCKS = Object.freeze([
  { begin: '// <dsh-famling:anims:begin>', end: '// <dsh-famling:anims:end>', generator: 'scripts/embed-anims.mjs' },
  { begin: '// <dsh-famling:content-constants:begin>', end: '// <dsh-famling:content-constants:end>', generator: 'scripts/gen-content-constants.mjs' },
  { begin: '// <dsh-famling:event-clips:begin>', end: '// <dsh-famling:event-clips:end>', generator: 'scripts/gen-content-constants.mjs' },
])
/** @type {RegExp} exported function declaration at column 0. */
const EXPORT_FUNCTION_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/
/** @type {RegExp} exported const declaration at column 0. */
const EXPORT_CONST_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=/

/**
 * Recursively list .js/.mjs sources under a directory, skipping install/git data.
 * @param {string} root Absolute directory to walk.
 * @returns {string[]} Absolute source file paths in stable order.
 */
export function listSourceFiles(root) {
  const found = []
  const excluded = new Set(['node_modules', '.git', '.github'])
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) found.push(absolute)
    }
  }
  walk(root)
  return found.sort()
}

/**
 * Collect the text of one exported function signature (handles multi-line params).
 * @param {string[]} lines Source split into lines.
 * @param {number} index Zero-based declaration line index.
 * @returns {string} Declaration text up to the opening brace.
 */
function signatureText(lines, index) {
  const parts = [lines[index]]
  for (let offset = 1; offset < 8 && index + offset < lines.length; offset += 1) {
    if (/\{\s*$/.test(parts[parts.length - 1])) break
    parts.push(lines[index + offset])
  }
  return parts.join('\n')
}

/**
 * Split a parameter list on top-level commas only.
 * @param {string} list Raw parameter list text (without outer parentheses).
 * @returns {string[]} Trimmed parameter declarations.
 */
function splitParameters(list) {
  const parts = []
  let depth = 0
  let current = ''
  for (const character of list) {
    if (character === '(' || character === '[' || character === '{') depth += 1
    else if (character === ')' || character === ']' || character === '}') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim().length > 0) parts.push(current.trim())
  return parts
}

/**
 * Extract named parameters from a function signature; object/array destructuring
 * is intentionally treated as non-nameable here (the enforced files avoid it).
 * @param {string} signature Declaration text including the parameter list.
 * @returns {string[]} Parameter names that must be documented.
 */
function parameterNames(signature) {
  const match = /function\s+[A-Za-z_$][\w$]*\s*\(([\s\S]*?)\)\s*\{/.exec(signature)
  if (!match) return []
  const names = []
  for (const parameter of splitParameters(match[1])) {
    if (parameter.length === 0) continue
    const withoutRest = parameter.startsWith('...') ? parameter.slice(3) : parameter
    const name = /^([A-Za-z_$][\w$]*)/.exec(withoutRest)
    if (name) names.push(name[1])
  }
  return names
}

/**
 * Inspect one source file for exported-declaration JSDoc coverage.
 * @param {string} source Full file text.
 * @param {string} [fileName] Display name used in problem messages.
 * @returns {string[]} Problems; empty means the file passes.
 */
export function inspectJsDoc(source, fileName = '<source>') {
  const lines = source.split('\n')
  const problems = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const functionMatch = EXPORT_FUNCTION_RE.exec(line)
    const constMatch = functionMatch ? null : EXPORT_CONST_RE.exec(line)
    if (!functionMatch && !constMatch) continue
    const name = functionMatch ? functionMatch[1] : constMatch[1]
    let previous = index - 1
    while (previous >= 0 && lines[previous].trim() === '') previous -= 1
    if (previous < 0 || !lines[previous].trim().endsWith('*/')) {
      problems.push(fileName + ':' + (index + 1) + ' exported ' + name + ' is missing a preceding JSDoc block')
      continue
    }
    let start = previous
    while (start >= 0 && !lines[start].includes('/**')) start -= 1
    if (start < 0) {
      problems.push(fileName + ':' + (index + 1) + ' exported ' + name + ' has an unterminated JSDoc block')
      continue
    }
    const block = lines.slice(start, previous + 1).join('\n')
    if (!functionMatch) continue
    const documented = [...block.matchAll(/@param\s+(?:\{[^\n]*\}\s+)?(\[[^\]]+\]|[A-Za-z_$][\w$]*)/g)].map((match) => match[1].replace(/^\[/, '').split(']')[0].split('=')[0])
    for (const parameter of parameterNames(signatureText(lines, index))) {
      if (!documented.includes(parameter)) problems.push(fileName + ':' + (index + 1) + ' exported function ' + name + ' is missing @param ' + parameter)
    }
    if (!/@returns?\b/.test(block)) problems.push(fileName + ':' + (index + 1) + ' exported function ' + name + ' is missing @returns')
  }
  return problems
}

/**
 * Inspect the generated blocks in client.js (and the lazy chunk banners) for
 * marker-pair integrity and the @generated / do-not-edit contract.
 * @param {string} clientSource Full client.js text.
 * @param {string[]} [chunkSources] Lazy chunk file texts.
 * @returns {string[]} Problems; empty means the generated blocks pass.
 */
export function inspectGeneratedBlocks(clientSource, chunkSources = []) {
  const problems = []
  const lines = clientSource.split('\n')
  for (const block of GENERATED_BLOCKS) {
    const beginCount = lines.filter((line) => line.trim() === block.begin).length
    const endCount = lines.filter((line) => line.trim() === block.end).length
    if (beginCount !== 1) problems.push('client.js: expected exactly one ' + block.begin + ' marker, found ' + beginCount)
    if (endCount !== 1) problems.push('client.js: expected exactly one ' + block.end + ' marker, found ' + endCount)
    if (beginCount !== 1 || endCount !== 1) continue
    const begin = lines.findIndex((line) => line.trim() === block.begin)
    const end = lines.findIndex((line) => line.trim() === block.end)
    if (end <= begin) {
      problems.push('client.js: generated block markers are out of order: ' + block.begin)
      continue
    }
    const body = lines.slice(begin, end + 1).join('\n')
    if (!body.includes('@generated by ' + block.generator)) problems.push('client.js: ' + block.begin + ' block is missing its @generated banner for ' + block.generator)
    if (!/do not edit/i.test(body)) problems.push('client.js: ' + block.begin + ' block is missing the do-not-edit warning')
  }
  for (const source of chunkSources) {
    if (!source.includes('@generated by scripts/embed-anims.mjs')) problems.push('lazy chunk is missing the embed-anims @generated banner')
    if (!/do not edit/i.test(source)) problems.push('lazy chunk is missing the do-not-edit warning')
  }
  return problems
}

/**
 * Minimal runtime lint: no debugger statement in shipped runtime files.
 * @param {string} source Full file text.
 * @param {string} [fileName] Display name used in problem messages.
 * @returns {string[]} Problems; empty means the file passes.
 */
export function inspectRuntimeLint(source, fileName = '<source>') {
  const problems = []
  if (/\bdebugger\b/.test(source)) problems.push(fileName + ': debugger statements are not allowed in shipped runtime files')
  return problems
}

/**
 * Run every check for one plugin root.
 * @param {string} [root] Plugin package root (defaults to PLUGIN_ROOT).
 * @returns {{ problems: string[], stats: { syntaxFiles: number, jsdocFiles: number, checkedExports: number, generatedChunks: number } }} Check result.
 */
export function checkPackage(root = PLUGIN_ROOT) {
  const problems = []
  const sourceFiles = listSourceFiles(root)
  for (const file of sourceFiles) {
    const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (syntax.status !== 0) problems.push(relative(root, file) + ': syntax error: ' + (syntax.stderr || '').trim().split('\n').slice(0, 3).join(' / '))
  }
  let checkedExports = 0
  for (const file of JSDOC_FILES) {
    const source = readFileSync(join(root, file), 'utf8')
    checkedExports += (source.match(new RegExp(EXPORT_FUNCTION_RE.source, 'gm')) || []).length
    checkedExports += (source.match(new RegExp(EXPORT_CONST_RE.source, 'gm')) || []).length
    problems.push(...inspectJsDoc(source, file))
  }
  const clientSource = readFileSync(join(root, 'client.js'), 'utf8')
  const chunkSources = ['human', 'cat', 'dog'].map((kind) => readFileSync(join(root, 'client.anims.' + kind + '.js'), 'utf8'))
  problems.push(...inspectGeneratedBlocks(clientSource, chunkSources))
  for (const file of RUNTIME_FILES) problems.push(...inspectRuntimeLint(readFileSync(join(root, file), 'utf8'), file))
  return { problems, stats: { syntaxFiles: sourceFiles.length, jsdocFiles: JSDOC_FILES.length, checkedExports, generatedChunks: chunkSources.length } }
}

/**
 * CLI entry point.
 * @param {string[]} [argv] Raw process arguments.
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node scripts/check-jsdoc.mjs [--quiet]')
    return
  }
  const quiet = argv.includes('--quiet')
  const { problems, stats } = checkPackage()
  if (!quiet) {
    console.log('[check-jsdoc] syntax: ' + stats.syntaxFiles + ' files parsed with node --check')
    console.log('[check-jsdoc] JSDoc: ' + stats.checkedExports + ' exported declarations in ' + stats.jsdocFiles + ' files (' + JSDOC_FILES.join(', ') + ')')
    console.log('[check-jsdoc] generated: 3 marker pairs in client.js + ' + stats.generatedChunks + ' lazy chunk banners')
    console.log('[check-jsdoc] runtime lint: ' + RUNTIME_FILES.length + ' shipped files (no debugger)')
    console.log('[check-jsdoc] JSDoc not yet enforced (pre-existing debt, follow-up): ' + JSDOC_DEBT_FILES.join(', '))
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error('[check-jsdoc] FAIL: ' + problem)
    process.exitCode = 1
    return
  }
  console.log('[check-jsdoc] ok')
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) await main()
