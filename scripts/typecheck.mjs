#!/usr/bin/env node
/**
 * Minimal checkJs gate (MB-107): locate a TypeScript compiler and run the
 * package's scripts/tsconfig.checkjs.json over the Node tooling layer.
 *
 * The plugin has no runtime dependencies and does not ship a node_modules, so
 * the compiler is resolved from an explicit override or a sibling workspace
 * install; when neither is present the check skips honestly (exit 0) instead of
 * failing a clean plugin-only checkout. The same applies to @types/node: the
 * config requests it, so the script points tsc at the matching typeRoots when
 * it can find an install.
 *
 * Resolution order:
 *   1. FAMLING_TSC (absolute path to typescript/bin/tsc)
 *   2. <plugin>/node_modules/typescript/bin/tsc
 *   3. <plugin>/../../desktop-games/node_modules/typescript/bin/tsc (sibling
 *      private famling checkout used by embed/verify/gen scripts)
 *   4. DSH_CHECKOUT/node_modules/typescript/bin/tsc
 *
 * Usage:
 *   npm run typecheck
 *   FAMLING_TSC=/path/to/typescript/bin/tsc node scripts/typecheck.mjs
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Absolute plugin package root. */
export const PLUGIN_ROOT = resolve(HERE, '..')
/** tsconfig consumed by this gate (kept next to the tooling it checks). */
export const CONFIG_PATH = join(HERE, 'tsconfig.checkjs.json')

/**
 * Locate a TypeScript compiler usable from this checkout.
 * @returns {{ tscPath: string, typeRoots: string | null } | null} Compiler path plus a matching @types root, or null.
 */
export function resolveTypeScript() {
  const candidates = []
  if (typeof process.env.FAMLING_TSC === 'string' && process.env.FAMLING_TSC.length > 0) candidates.push(process.env.FAMLING_TSC)
  candidates.push(join(PLUGIN_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'))
  candidates.push(join(PLUGIN_ROOT, '..', '..', 'desktop-games', 'node_modules', 'typescript', 'bin', 'tsc'))
  if (typeof process.env.DSH_CHECKOUT === 'string' && process.env.DSH_CHECKOUT.length > 0) {
    candidates.push(join(process.env.DSH_CHECKOUT, 'node_modules', 'typescript', 'bin', 'tsc'))
  }
  for (const candidate of candidates) {
    const tscPath = resolve(candidate)
    if (!existsSync(tscPath)) continue
    return { tscPath, typeRoots: resolveTypeRoots(tscPath) }
  }
  return null
}

/**
 * Derive a matching node_modules/@types directory from a TypeScript bin path.
 * @param {string} tscPath Absolute typescript/bin/tsc path.
 * @returns {string | null} Absolute typeRoots directory, or null when absent.
 */
export function resolveTypeRoots(tscPath) {
  const candidates = []
  if (typeof process.env.FAMLING_TYPES_ROOT === 'string' && process.env.FAMLING_TYPES_ROOT.length > 0) candidates.push(process.env.FAMLING_TYPES_ROOT)
  // <node_modules>/typescript/bin/tsc -> <node_modules>/@types
  candidates.push(resolve(dirname(tscPath), '..', '..', '@types'))
  candidates.push(join(PLUGIN_ROOT, 'node_modules', '@types'))
  for (const candidate of candidates) {
    const typeRoots = resolve(candidate)
    if (existsSync(join(typeRoots, 'node', 'package.json'))) return typeRoots
  }
  return null
}

/**
 * CLI entry point: run tsc, or print a deliberate skip message.
 * @param {string[]} [argv] Raw process arguments (currently unused).
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node scripts/typecheck.mjs  (env: FAMLING_TSC, FAMLING_TYPES_ROOT)')
    return
  }
  const resolved = resolveTypeScript()
  if (!resolved) {
    console.log('[typecheck] skipped: TypeScript is not installed here (install dev-only: npm i -D typescript @types/node, or set FAMLING_TSC)')
    return
  }
  const args = [resolved.tscPath, '-p', CONFIG_PATH]
  if (resolved.typeRoots) args.push('--typeRoots', resolved.typeRoots)
  console.log('[typecheck] tsc: ' + resolved.tscPath)
  console.log('[typecheck] config: ' + CONFIG_PATH + (resolved.typeRoots ? ' (typeRoots: ' + resolved.typeRoots + ')' : ''))
  const result = spawnSync(process.execPath, args, { cwd: PLUGIN_ROOT, stdio: 'inherit' })
  if (result.error) {
    console.error('[typecheck] failed to run tsc: ' + result.error.message)
    process.exitCode = 1
    return
  }
  if (result.status !== 0) {
    console.error('[typecheck] checkJs failed (exit ' + result.status + ')')
    process.exitCode = result.status || 1
    return
  }
  console.log('[typecheck] checkJs ok')
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) await main()
