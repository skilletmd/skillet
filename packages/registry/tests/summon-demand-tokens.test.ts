import assert from 'node:assert/strict'
import test from 'node:test'
import { demandTokens, recordDemandTokensPrisma } from '../src/lib/universal-search.js'

// Hermetic: a fake prisma captures upsert payloads so we can assert the demand
// log stores ONLY sanitized (day, token, count) rows — no task text, no identity.
function fakePrisma(): {
  payloads: Record<string, unknown>[]
  summon_demand_tokens: { upsert: (a: { where: unknown; create: Record<string, unknown> }) => Promise<void> }
} {
  const payloads: Record<string, unknown>[] = []
  return {
    payloads,
    summon_demand_tokens: {
      upsert: async (a) => {
        payloads.push(a.create)
      },
    },
  }
}

test('demandTokens sanitizes to short lowercase keyword slugs', () => {
  assert.deepEqual(demandTokens('Cooking, RECIPES!!'), ['cooking', 'recipes'])
  assert.deepEqual(demandTokens('deploy   to    prod'), ['deploy', 'to', 'prod'])
  // dedupe
  assert.deepEqual(demandTokens('blog blog writing'), ['blog', 'writing'])
})

test('demandTokens caps token count and drops over-long tokens', () => {
  assert.equal(demandTokens('a b c d e f g h').length, 5)
  const long = 'x'.repeat(40)
  assert.deepEqual(demandTokens(`ok ${long} fine`), ['ok', 'fine'])
})

test('demandTokens ignores non-strings and empty input', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.deepEqual(demandTokens(undefined as any), [])
  assert.deepEqual(demandTokens('   !!!  '), [])
})

test('recordDemandTokensPrisma records tokens only for the summon-fallback source', async () => {
  const db = fakePrisma()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recordDemandTokensPrisma(db as any, 'summon-fallback', 'cooking recipe')
  assert.deepEqual(
    db.payloads.map((p) => p['token']).sort(),
    ['cooking', 'recipe'],
  )
})

test('recordDemandTokensPrisma ignores other sources (route-skill, unknown)', async () => {
  const db = fakePrisma()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recordDemandTokensPrisma(db as any, 'route-skill', 'cooking recipe')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recordDemandTokensPrisma(db as any, 'nope', 'cooking recipe')
  assert.deepEqual(db.payloads, [], 'only summon-fallback searches feed the demand log')
})

test('the demand row carries only day, token, count — no identity, no task text', async () => {
  const db = fakePrisma()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recordDemandTokensPrisma(db as any, 'summon-fallback', 'write me a blog post about my startup')
  for (const p of db.payloads) {
    assert.deepEqual(Object.keys(p).sort(), ['count', 'day', 'token'])
    // no raw phrase stored: each token is a single sanitized slug
    assert.match(String(p['token']), /^[a-z0-9-]+$/)
  }
})
