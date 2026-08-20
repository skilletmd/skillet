import assert from 'node:assert/strict'
import test from 'node:test'
import { recordSearchSourcePrisma } from '../src/lib/universal-search.js'

// Hermetic: a fake prisma records upsert calls so we can assert the source
// allowlist without a live MySQL. `recordSearchSourcePrisma` only upserts for a
// KNOWN source; anything else is dropped (best-effort attribution).
function fakePrisma(): { calls: string[]; search_source_counts: { upsert: (a: { where: { day_source: { source: string } } }) => Promise<void> } } {
  const calls: string[] = []
  return {
    calls,
    search_source_counts: {
      upsert: async (a) => {
        calls.push(a.where.day_source.source)
      },
    },
  }
}

test('summon-fallback is a recognized search source (U2)', async () => {
  const db = fakePrisma()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recordSearchSourcePrisma(db as any, 'summon-fallback')
  assert.deepEqual(db.calls, ['summon-fallback'], 'summon-fallback should be counted')
})

test('the existing route-skill source still counts (regression)', async () => {
  const db = fakePrisma()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recordSearchSourcePrisma(db as any, 'route-skill')
  assert.deepEqual(db.calls, ['route-skill'])
})

test('an unknown source is dropped, never counted', async () => {
  const db = fakePrisma()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recordSearchSourcePrisma(db as any, 'totally-made-up')
  assert.deepEqual(db.calls, [], 'unknown sources must not be counted')
})
