/**
 * Pet Brief producer/consumer compatibility — Advisers 0.3.0 / contract v0.2.
 *
 * The plugin host half (index.js `readBriefProjection`) is a *projection
 * boundary* AND a strict consumer: since the 0.3.0 follow-up it validates the
 * whole document against the closed contract v0.2 schema before projecting.
 * These tests pin both sides:
 *  - a valid v0.2 brief is projected to the fixed allowlist only
 *    (counts + up to three today/commitments rows; no other producer fields);
 *  - every malformed / tampered / extended document is refused fail-closed
 *    (404 E_MEMORY) instead of being partially trusted.
 *
 * Layers:
 *  1. always-on synthetic fixtures shaped by contract v0.2 (schemaVersion 2,
 *     5-minute TTL, displayPolicy, counts, closed schema) — no external
 *     checkout and no real data;
 *  2. optional real producer: the Advisers 0.3.0 library builds a brief from an
 *     in-memory synthetic ledger (no real ledger, no ~/.advisers read);
 *  3. optional private-famling fixtures copied from the desktop consumer —
 *     honest skip when the private checkout is absent (never a hidden private
 *     dependency).
 *
 * The optional layers are not even registered inside the MB-004 clean-checkout
 * child (`DSH_FAMLING_STANDALONE_CHILD=1`) because that gate pins its skip list.
 * They are skipped there only by not running; a plugin-only checkout outside the
 * gate reports them as explicit SKIPs.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

import { apply } from '../index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGE_PATH = '/api/famling/bridge'

/** MB-004 clean-checkout child: its skip list is pinned by test/clean-checkout.test.js. */
const IS_STANDALONE_CHILD = process.env.DSH_FAMLING_STANDALONE_CHILD === '1'
/** Public producer checkout (optional): sibling repo by default, overridable for CI. */
const ADVISERS_REPO = resolve(process.env.ADVISERS_REPO_DIR ?? join(ROOT, '..', 'advisers'))
const PRODUCER_LIB = join(ADVISERS_REPO, 'packages', 'advisers', 'lib', 'pet-brief.js')
const PRODUCER_CORE = join(ADVISERS_REPO, 'packages', 'core', 'dist', 'index.js')
const PRODUCER_TESTCASES = join(ADVISERS_REPO, 'docs', 'pet-brief', 'testcases-v0.2.json')
const PRODUCER_AVAILABLE = existsSync(PRODUCER_LIB) && existsSync(PRODUCER_CORE)
const VECTORS_AVAILABLE = existsSync(PRODUCER_TESTCASES)
/** Private famling checkout (optional): fixtures only, never imported as code. */
const FAMLING_REPO = resolve(process.env.FAMLING_REPO_DIR ?? join(ROOT, '..', '..', 'desktop-games'))
const FAMLING_V02 = join(FAMLING_REPO, 'tests', 'advisers-fixtures', 'pet-brief-v0.2.json')
const FAMLING_V01 = join(FAMLING_REPO, 'tests', 'advisers-fixtures', 'pet-brief-v0.1.json')
const FAMLING_AVAILABLE = existsSync(FAMLING_V02) || existsSync(FAMLING_V01)

/** Minimal authenticated-bridge Host: only the connection service is required. */
function makeHost() {
  let registered
  const ctx = {
    effect(fn) { return fn() },
    connection: { fetch: { register(options) { registered = options; return () => {} } } },
    get() { return undefined },
  }
  return { ctx, route: () => registered }
}

/** POST /api/famling/bridge `{ v: 1, op: "brief" }` against a fresh Host. */
async function postBrief() {
  const host = makeHost()
  apply(host.ctx)
  return host.route().fetch(new Request("http://localhost" + BRIDGE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 1, op: "brief" }),
  }))
}

/** Run one request with a temporary ADVISERS_HOME pointing at `raw`. */
async function withBriefFile(raw, run) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-famling-brief-compat-'))
  const previous = process.env.ADVISERS_HOME
  process.env.ADVISERS_HOME = directory
  try {
    await writeFile(join(directory, 'pet-brief.json'), typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8')
    return await run()
  } finally {
    if (previous === undefined) delete process.env.ADVISERS_HOME
    else process.env.ADVISERS_HOME = previous
    await rm(directory, { recursive: true, force: true })
  }
}

/** One producer-shaped contract v0.2 brief, with fresh TTL, for one request. */
async function request(raw) {
  return withBriefFile(raw, async () => {
    const response = await postBrief()
    return { status: response.status, body: await response.json() }
  })
}

const NOW = Date.now()
const GENERATED_AT = new Date(NOW - 60_000).toISOString()
const EXPIRES_AT = new Date(NOW + 4 * 60_000).toISOString()

/** A valid v0.2 brief as emitted by `advisers pet-brief` (synthetic data only). */
function freshBrief(overrides = {}) {
  return {
    schemaVersion: 2,
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
    source: 'advisers',
    displayPolicy: 'private',
    counts: { today: 1, commitments: 1, risks: 1, facts: 1 },
    today: [{ id: 'matter_01', title: '给某客户发报价', status: 'doing' }],
    commitments: [{ id: 'commit_01', matter: 'matter_01', who: '某客户', what: '发报价', due: '2026-11-20', risk: 'high', confidence: 0.92 }],
    risks: [{ id: 'risk_01', level: 'high', summary: '报价今天到期，尚未发出', evidence: 'commit_01', confidence: 0.88 }],
    facts: [{ id: 'fact_01', subject: '某客户', predicate: 'prefers', value: 'PDF 报价', confidence: 0.9 }],
    mood: 'focused',
    suggestedLines: ['某客户的报价，今天到期。'],
    redactions: ['客户名已替换为“某客户”'],
    ...overrides,
  }
}

/** Copy without one root key (for "missing field" cases). */
function without(value, key) {
  const copy = { ...value }
  delete copy[key]
  return copy
}

/** Only move the TTL forward: fixture payload bytes stay intact. */
function restamp(brief) {
  const now = Date.now()
  return { ...brief, generatedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 4 * 60_000).toISOString() }
}

/** Assert one bridge response is a fail-closed refusal (no partial projection). */
async function expectRefused(name, raw) {
  const { status, body } = await request(raw)
  assert.equal(status, 404, name + ": status")
  assert.equal(body.code, 'E_MEMORY', name + ': code')
  assert.equal(body.ok, false, name + ": ok")
  assert.equal(body.brief, undefined, name + ": no partial brief")
  assert.match(body.message, /^Advisers Pet Brief is (?:invalid|unavailable|too large)/, name + ": stable message")
  return body
}

const EXPECTED_KEYS = ['commitments', 'counts', 'displayPolicy', 'expiresAt', 'generatedAt', 'schemaVersion', 'today']

/* ---------- 1. always-on: valid projection boundary ---------- */

test('a contract-shaped v0.2 brief projects only counts/today/commitments (no extra producer fields)', async () => {
  const { status, body } = await request(freshBrief())
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.meta.stage, 'P1')
  assert.equal(body.bubbleKind, 'thought')
  assert.match(body.reply, /今天 1 项，承诺 1 项，风险 1 项/)
  assert.deepEqual(Object.keys(body.brief).sort(), EXPECTED_KEYS)
  assert.deepEqual(body.brief.counts, { today: 1, commitments: 1, risks: 1, facts: 1 })
  assert.deepEqual(body.brief.today, [{ title: '给某客户发报价', status: 'doing' }])
  assert.deepEqual(body.brief.commitments, [{ what: '发报价', due: '2026-11-20', risk: 'high' }])
  for (const key of ['suggestedLines', 'redactions', 'mood', 'facts', 'risks', 'source', 'evidence']) {
    assert.equal(Object.prototype.hasOwnProperty.call(body.brief, key), false, "producer field is not projected: " + key)
  }
  for (const value of ['某客户的报价，今天到期。', '客户名已替换为“某客户”', 'focused']) {
    assert.equal(JSON.stringify(body.brief).includes(value), false, "producer value is not projected: " + value)
  }
  for (const item of body.brief.today) assert.deepEqual(Object.keys(item).sort(), ['status', 'title'])
  for (const item of body.brief.commitments) assert.deepEqual(Object.keys(item).sort(), ['due', 'risk', 'what'])
})

test('the projection caps today/commitments at three rows but keeps the real counts', async () => {
  const brief = freshBrief({
    counts: { today: 5, commitments: 5, risks: 1, facts: 1 },
    today: Array.from({ length: 5 }, (_, i) => ({ id: 'm' + i, title: '事项' + i, status: 'open' })),
    commitments: Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, matter: 'm' + i, who: '某客户', what: '动作' + i, due: '2026-11-20', risk: 'low', confidence: 0.9 })),
  })
  const { status, body } = await request(brief)
  assert.equal(status, 200)
  assert.equal(body.brief.today.length, 3)
  assert.equal(body.brief.commitments.length, 3)
  assert.deepEqual(body.brief.counts, { today: 5, commitments: 5, risks: 1, facts: 1 })
  assert.equal(body.brief.today[2].title, '事项2')
})

test('a v0.1 legacy brief (schemaVersion 1, no displayPolicy) is accepted as private', async () => {
  const legacy = restamp(without(freshBrief(), "displayPolicy"))
  legacy.schemaVersion = 1
  const { status, body } = await request(legacy)
  assert.equal(status, 200)
  assert.equal(body.brief.schemaVersion, 1)
  assert.equal(body.brief.displayPolicy, 'private', 'missing displayPolicy defaults to private, never public')
})

/* ---------- 2. always-on: closed-schema fail-closed refusals ---------- */

test('displayPolicy none is refused and an unknown policy is now rejected (closed enum)', async () => {
  const none = await request(freshBrief({ displayPolicy: 'none' }))
  assert.equal(none.status, 404)
  assert.equal(none.body.code, 'E_MEMORY')
  assert.match(none.body.message, /display policy is none/)

  for (const displayPolicy of ['audience', '', null, 1]) {
    const refused = await expectRefused("policy " + JSON.stringify(displayPolicy), freshBrief({ displayPolicy }))
    assert.match(refused.message, /E_DISPLAY_POLICY/)
  }
  // v0.2 is a closed schema: displayPolicy is required (v0.1 predates it).
  const missing = await expectRefused('missing v0.2 displayPolicy', without(freshBrief(), 'displayPolicy'))
  assert.match(missing.message, /E_REQUIRED/)
})

test('unknown or forbidden fields anywhere in the document are refused (closed schema)', async () => {
  const cases = [
    ['unknown root field', freshBrief({ note: 'x' })],
    ['forbidden reasoning', freshBrief({ reasoning: 'hidden chain of thought' })],
    ['forbidden api_key (normalized suffix)', freshBrief({ api_key: 'sk-synthetic-should-not-leak' })],
    ['forbidden emotional field', freshBrief({ mood: 'focused', affection: 1 })],
    ['unknown today field', freshBrief({ today: [{ id: 'm', title: '标题', status: 'open', extra: 'x' }] })],
    ['unknown commitment field', freshBrief({ commitments: [{ id: 'c', matter: 'm', who: '某客户', what: '动作', due: '2026-11-20', risk: 'low', confidence: 0.9, quote: 'x' }] })],
    ['unknown risk field', freshBrief({ risks: [{ id: 'r', level: 'high', summary: '摘要', evidence: 'c', confidence: 0.9, raw: 'x' }] })],
    ['unknown fact field', freshBrief({ facts: [{ id: 'f', subject: '某客户', predicate: 'prefers', value: 'PDF', confidence: 0.9, extra: 'x' }] })],
    ['unknown counts field', freshBrief({ counts: { today: 1, commitments: 1, risks: 1, facts: 1, other: 0 } })],
  ]
  for (const [name, brief] of cases) {
    const refused = await expectRefused(name, brief)
    assert.match(refused.message, /E_(UNKNOWN_FIELD|FORBIDDEN_FIELD)/, name + ': ' + refused.message)
  }
})

test('counts must equal array lengths (and stay within 0..10) — no coercion, no zero-fill', async () => {
  const cases = [
    ['mismatch today', freshBrief({ counts: { today: 2, commitments: 1, risks: 1, facts: 1 } })],
    ['mismatch commitments', freshBrief({ counts: { today: 1, commitments: 0, risks: 1, facts: 1 } })],
    ['mismatch risks', freshBrief({ counts: { today: 1, commitments: 1, risks: 2, facts: 1 } })],
    ['mismatch facts', freshBrief({ counts: { today: 1, commitments: 1, risks: 1, facts: 0 } })],
    ['out of range', freshBrief({ counts: { today: 11, commitments: 1, risks: 1, facts: 1 } })],
    ['missing key', freshBrief({ counts: { today: 1, commitments: 1, risks: 1 } })],
    ['not an object', freshBrief({ counts: 'nope' })],
    ['array counts', freshBrief({ counts: [] })],
    ['negative', freshBrief({ counts: { today: -1, commitments: 1, risks: 1, facts: 1 } })],
    ['fraction', freshBrief({ counts: { today: 1.5, commitments: 1, risks: 1, facts: 1 } })],
    ['string', freshBrief({ counts: { today: '1', commitments: 1, risks: 1, facts: 1 } })],
  ]
  for (const [name, brief] of cases) {
    const refused = await expectRefused(name, brief)
    assert.match(refused.message, /E_(COUNTS|COUNTS_MISMATCH|TYPE)/, name + ': ' + refused.message)
  }
})

test('TTL upper bound: >5 minutes, reversed or far-future timestamps are refused', async () => {
  const now = Date.now()
  const cases = [
    ['expired', freshBrief({ expiresAt: new Date(now - 1_000).toISOString() })],
    ['missing expiresAt', without(freshBrief(), 'expiresAt')],
    ['not-a-date', freshBrief({ expiresAt: 'soon' })],
    ['numeric expiresAt', freshBrief({ expiresAt: now + 60_000 })],
    ['ttl above 5 minutes', freshBrief({ generatedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 10 * 60_000).toISOString() })],
    ['reversed order', freshBrief({ generatedAt: new Date(now).toISOString(), expiresAt: new Date(now - 60_000).toISOString() })],
    ['generatedAt far in future', freshBrief({ generatedAt: new Date(now + 10 * 60_000).toISOString(), expiresAt: new Date(now + 14 * 60_000).toISOString() })],
  ]
  for (const [name, brief] of cases) {
    const refused = await expectRefused(name, brief)
    assert.match(refused.message, /E_(EXPIRED|TTL|TIME_ORDER|TIME_FUTURE|TIME_FORMAT|REQUIRED)/, name + ': ' + refused.message)
  }
  // Exactly 5 minutes stays valid (the producer writes generatedAt + ttlMs).
  const fiveMinutes = freshBrief({
    generatedAt: new Date(now - 240_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  })
  const ok = await request(fiveMinutes)
  assert.equal(ok.status, 200)
})

test('future/unsupported schemaVersion values are refused fail-closed', async () => {
  for (const schemaVersion of [3, 99, 0, -1, 1.5, '2', null]) {
    const brief = schemaVersion === null ? without(freshBrief(), 'schemaVersion') : freshBrief({ schemaVersion })
    const refused = await expectRefused(JSON.stringify(schemaVersion), brief)
    assert.match(refused.message, /E_SCHEMA_VERSION/)
  }
})

test('item/section shape violations are refused: ids, enums, types, lengths, caps', async () => {
  const cases = [
    ['duplicate today id', freshBrief({ counts: { today: 2, commitments: 1, risks: 1, facts: 1 }, today: [{ id: 'm', title: 'a', status: 'open' }, { id: 'm', title: 'b', status: 'done' }] })],
    ['11 items', freshBrief({ counts: { today: 11, commitments: 1, risks: 1, facts: 1 }, today: Array.from({ length: 11 }, (_, i) => ({ id: 'm' + i, title: 't' + i, status: 'open' })) })],
    ['bad status', freshBrief({ today: [{ id: 'm', title: '标题', status: 'todo' }] })],
    ['empty title', freshBrief({ today: [{ id: 'm', title: '', status: 'open' }] })],
    ['too-long title', freshBrief({ today: [{ id: 'm', title: 'x'.repeat(81), status: 'open' }] })],
    ['bad risk', freshBrief({ commitments: [{ id: 'c', matter: 'm', who: '某客户', what: '动作', due: '2026-11-20', risk: 'urgent', confidence: 0.9 }] })],
    ['confidence > 1', freshBrief({ commitments: [{ id: 'c', matter: 'm', who: '某客户', what: '动作', due: '2026-11-20', risk: 'low', confidence: 1.1 }] })],
    ['not an array', freshBrief({ commitments: { id: 'c' } })],
    ['item not an object', freshBrief({ facts: ['x'] })],
    ['bad mood', freshBrief({ mood: 'angry' })],
    ['suggestedLines > 3', freshBrief({ suggestedLines: ['a', 'b', 'c', 'd'] })],
    ['suggested line too long', freshBrief({ suggestedLines: ['x'.repeat(41)] })],
    ['empty suggested line', freshBrief({ suggestedLines: [''] })],
    ['redactions > 10', freshBrief({ redactions: Array.from({ length: 11 }, (_, i) => 'note' + i) })],
    ['redaction empty', freshBrief({ redactions: [''] })],
  ]
  for (const [name, brief] of cases) {
    const refused = await expectRefused(name, brief)
    assert.match(refused.message, /E_/, name + ': ' + refused.message)
  }
})

test('source/missing required fields are refused, and refusals never echo brief values', async () => {
  const wrongSource = await expectRefused('source', freshBrief({ source: 'other' }))
  assert.match(wrongSource.message, /E_SOURCE/)
  const missing = await expectRefused('missing mood', without(freshBrief(), 'mood'))
  assert.match(missing.message, /E_(REQUIRED|ENUM)/)

  const secret = 'sk-synthetic-SHOULD-NOT-ECHO-' + 'x'.repeat(20)
  const refused = await expectRefused("forbidden secret", freshBrief({
    today: [{ id: "m", title: secret, status: "open" }],
    api_key: secret,
  }))
  assert.equal(JSON.stringify(refused).includes(secret), false, "validation message never echoes fields")
  assert.equal(JSON.stringify(refused).includes("api_key"), false, "validation message never echoes field names")
})

test('malformed JSON and a file above 128 KiB are refused', async () => {
  const malformed = await request('{')
  assert.equal(malformed.status, 404)
  assert.equal(malformed.body.code, 'E_MEMORY')
  assert.match(malformed.body.message, /E_MALFORMED_JSON/)

  const oversized = freshBrief({ note: 'x'.repeat(128 * 1024) })
  const tooLarge = await request(oversized)
  assert.equal(tooLarge.status, 404)
  assert.equal(tooLarge.body.code, 'E_MEMORY')
  assert.match(tooLarge.body.message, /too large/)
})

/* ---------- 3. optional: real Advisers 0.3.0 producer, synthetic ledger ---------- */

if (!IS_STANDALONE_CHILD) {
  test('an Advisers 0.3.0 producer brief (in-memory synthetic ledger) round-trips through the bridge', {
    skip: PRODUCER_AVAILABLE ? false : 'Advisers producer checkout not available (set ADVISERS_REPO_DIR; expected ' + PRODUCER_LIB + ')',
  }, async (t) => {
    let lib
    let core
    try {
      ;[lib, core] = await Promise.all([
        import(pathToFileURL(PRODUCER_LIB).href),
        import(pathToFileURL(PRODUCER_CORE).href),
      ])
    } catch (error) {
      t.skip('Advisers producer modules are not importable in this checkout: ' + error.message)
      return
    }
    if (typeof lib.buildPetBrief !== 'function' || typeof lib.validatePetBrief !== 'function' || typeof core.Ledger !== 'function') {
      t.skip('Advisers producer library is missing buildPetBrief/validatePetBrief/Ledger')
      return
    }

    const now = Date.now()
    const due = new Date(now + 3_600_000).toISOString()
    const ledger = new core.Ledger()
    const publicMatter = ledger.addMatter({ title: '给王工发报价', participants: ['王工'] })
    const secretMatter = ledger.addMatter({ title: '秘密并购', secrecy: 3 })
    ledger.addCommitment({
      matterId: publicMatter.id,
      debtor: 'user',
      creditor: '王工',
      action: '发报价',
      dueAt: due,
      evidence: [{ sessionId: 'session_synthetic', turnId: 'turn_1', quote: '机密原话-不应出现' }],
    })
    ledger.addCommitment({
      matterId: secretMatter.id,
      debtor: 'user',
      creditor: '王工',
      action: '秘密动作',
      dueAt: due,
      evidence: [{ sessionId: 'session_synthetic', turnId: 'turn_2', quote: '秘密证据-不应出现' }],
    })
    ledger.remember({ matterId: publicMatter.id, subject: '王工', predicate: 'prefers', object: 'PDF 报价', confidence: 0.9 })
    ledger.remember({ matterId: secretMatter.id, subject: '秘密联系人', predicate: 'note', object: '秘密事实', confidence: 0.99 })

    const brief = lib.buildPetBrief(ledger, { now, displayPolicy: 'private' })
    const validation = lib.validatePetBrief(brief, { now })
    assert.equal(validation.ok, true, 'producer validates its own v0.2 output: ' + JSON.stringify(validation.errors))
    assert.equal(brief.schemaVersion, 2, '0.3.0 still emits contract v0.2 (schemaVersion 2)')

    const { status, body } = await request(brief)
    assert.equal(status, 200)
    assert.equal(body.brief.schemaVersion, 2)
    assert.equal(body.brief.displayPolicy, 'private')
    assert.deepEqual(body.brief.counts, brief.counts)
    assert.deepEqual(body.brief.today, brief.today.slice(0, 3).map((item) => ({ title: item.title, status: item.status })))
    assert.deepEqual(body.brief.commitments, brief.commitments.slice(0, 3).map((item) => ({ what: item.what, due: item.due, risk: item.risk })))
    const serialized = JSON.stringify(body)
    for (const secret of ['王工', '秘密并购', '秘密动作', '秘密联系人', '秘密事实', '机密原话', '秘密证据']) {
      assert.equal(serialized.includes(secret), false, "producer redaction/secrecy holds through the bridge: " + secret)
    }

    const none = lib.buildPetBrief(ledger, { now, displayPolicy: 'none' })
    const refused = await request(none)
    assert.equal(refused.status, 404, 'displayPolicy none is refused by the bridge')
    assert.equal(refused.body.code, 'E_MEMORY')
  })
}

/* ---------- 3b. optional: canonical contract v0.2 test vectors ---------- */

if (!IS_STANDALONE_CHILD) {
  test('canonical v0.2 vectors: producer reject -> 404, producer accept -> 200 (two documented strict divergences)', {
    skip: VECTORS_AVAILABLE ? false : 'canonical v0.2 test vectors not available (set ADVISERS_REPO_DIR; expected ' + PRODUCER_TESTCASES + ')',
  }, async () => {
    const vectors = JSON.parse(await readFile(PRODUCER_TESTCASES, 'utf8'))
    const now = Date.now()
    // Restamp the canonical base BEFORE applying each case, so timestamp cases
    // (expired / missing timezone) still override with their own values.
    const base = {
      ...vectors.base,
      generatedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 4 * 60_000).toISOString(),
    }
    // Deliberate strict-consumer divergences (documented in the compatibility
    // report): v0.2's displayPolicy is required by the closed schema, and the
    // bridge refuses displayPolicy:none even though the producer schema accepts it.
    const STRICT_DIVERGENCES = new Set(['missing_display_policy', 'display_none'])
    for (const vector of vectors.cases) {
      const name = vector.name || vector.id
      const value = vector.raw !== undefined
        ? vector.raw
        : (() => {
            const merged = { ...base, ...(vector.overrides || {}) }
            for (const key of vector.remove || []) delete merged[key]
            return merged
          })()
      const { status } = await request(value)
      if (vector.expect === 'accept' || vector.expect === 'accept_omit' || vector.expect === 'accept_warn') {
        if (STRICT_DIVERGENCES.has(name)) {
          assert.equal(status, 404, name + ": strict consumer refuses")
          continue
        }
        assert.equal(status, 200, name + ": producer-accepted vector is projected")
      } else if (vector.expect === 'reject') {
        assert.equal(status, 404, name + ": producer-rejected vector fails closed")
      }
      // fallback/skip are consumer-side policy vectors (not producer rejects).
    }
  })
}

/* ---------- 4. optional: private famling consumer fixtures (honest skip) ---------- */

if (!IS_STANDALONE_CHILD) {
  test('private famling consumer fixtures round-trip through the bridge (v0.2 and v0.1)', {
    skip: FAMLING_AVAILABLE ? false : 'private famling checkout not available (set FAMLING_REPO_DIR; expected ' + FAMLING_V02 + ')',
  }, async (t) => {
    for (const fixturePath of [FAMLING_V02, FAMLING_V01]) {
      if (!existsSync(fixturePath)) {
        t.diagnostic('fixture not present, skipping: ' + fixturePath)
        continue
      }
      const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
      const { status, body } = await request(restamp(fixture))
      assert.equal(status, 200, fixturePath + ": status")
      assert.deepEqual(body.brief.counts, fixture.counts, fixturePath + ": counts")
      assert.equal(body.brief.today.length, Math.min(3, fixture.today.length), fixturePath + ": today cap")
      assert.equal(body.brief.commitments.length, Math.min(3, fixture.commitments.length), fixturePath + ": commitment cap")
      assert.equal(body.brief.schemaVersion, fixture.schemaVersion, fixturePath + ": schemaVersion")
      if (fixture.displayPolicy === undefined) assert.equal(body.brief.displayPolicy, "private")
    }
  })
}