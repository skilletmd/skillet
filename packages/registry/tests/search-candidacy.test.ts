// U2/U3: two-pass candidacy across all four search groups.
//
// Hermetic — a fake prisma records every `where` it is handed and replays
// canned rows, so the pass structure, the fallback trigger, and the access
// filters are asserted without a live MySQL.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  searchAuthorsPrisma,
  searchKitsPrisma,
  searchSkillsPrisma,
  searchTeamsPrisma,
} from '../src/lib/universal-search.js'

interface Call {
  where: Record<string, unknown>
  take?: number
}

type Rows = Record<string, unknown>[]

/**
 * `rowsPerCall` is consumed one entry per findMany, so a test can say "pass A
 * returns nothing, pass B returns these" without matching on the where clause.
 */
function fakePrisma(model: string, rowsPerCall: Rows[], extra: Record<string, unknown> = {}) {
  const calls: Call[] = []
  let call = 0
  const findMany = async (args: Call): Promise<Rows> => {
    calls.push({ where: args.where, take: args.take })
    return rowsPerCall[call++] ?? []
  }
  const db = {
    calls,
    // Nothing is suspended in these fixtures unless a test overrides it.
    users: { findMany: async () => [] },
    organizations: { findMany: async () => [] },
    kit_skills: { findMany: async () => [] },
    ...extra,
    // Last, so the model under test always owns the recording findMany even
    // when it collides with one of the defaults above (organizations/teams).
    [model]: { findMany },
  }
  return db as typeof db & Record<string, never>
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const asDb = (db: unknown) => db as any

/** Flattened column names touched by a `where`, in order, for shape assertions. */
function orColumns(clause: unknown): string[] {
  const or = (clause as { OR?: Record<string, unknown>[] }).OR ?? []
  return or.flatMap((entry) => Object.keys(entry))
}

function orTokens(clause: unknown): string[] {
  const or = (clause as { OR?: Record<string, { contains: string }>[] }).OR ?? []
  return or.map((entry) => Object.values(entry)[0]!.contains)
}

describe('skill search candidacy', () => {
  const skill = (slug: string, over: Record<string, unknown> = {}) => ({
    id: `alice:${slug}`,
    author_id: 'alice',
    slug,
    description: 'a skill',
    install_count: 0,
    visibility: 'public',
    category: null,
    ...over,
  })

  it('issues one query for a single-token query', async () => {
    const db = fakePrisma('skills', [[skill('lint-tool')]])
    const out = await searchSkillsPrisma(asDb(db), 'lint', null, 8)
    assert.equal(db.calls.length, 1)
    assert.equal(out.length, 1)
    assert.equal(out[0]!.slug, 'lint-tool')
  })

  it('issues one query when the every-token pass finds something', async () => {
    const db = fakePrisma('skills', [[skill('web-design-guidelines')]])
    const out = await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    assert.equal(db.calls.length, 1, 'fallback must not run when pass A produced results')
    assert.equal(out.length, 1)
  })

  it('builds pass A as an AND of per-token ORs across slug, description, author_id', async () => {
    const db = fakePrisma('skills', [[skill('web-design-guidelines')]])
    await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    const and = db.calls[0]!.where.AND as unknown[]
    assert.equal(and.length, 2, 'one clause per token')
    assert.deepEqual(orColumns(and[0]), ['slug', 'description', 'author_id'])
    assert.deepEqual(orTokens(and[0]), ['web', 'web', 'web'])
    assert.deepEqual(orTokens(and[1]), ['design', 'design', 'design'])
  })

  it('falls back to an any-token OR when the every-token pass is empty', async () => {
    const db = fakePrisma('skills', [[], [skill('web-component-design')]])
    const out = await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    assert.equal(db.calls.length, 2)
    assert.equal(db.calls[1]!.where.AND, undefined)
    assert.deepEqual(orTokens(db.calls[1]!.where), [
      'web',
      'web',
      'web',
      'design',
      'design',
      'design',
    ])
    assert.equal(out.length, 1)
  })

  it('falls back when pass A rows exist but none survive the access check', async () => {
    const db = fakePrisma('skills', [[skill('private-web-design', { visibility: 'private' })], []])
    await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    assert.equal(db.calls.length, 2, 'the trigger is surviving results, not raw rows')
  })

  it('keeps the base filters and the candidate cap on both passes', async () => {
    const db = fakePrisma('skills', [[], []])
    await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    for (const call of db.calls) {
      assert.deepEqual(call.where.latest_hash, { not: null })
      assert.equal(call.where.deprecated_at, null)
      assert.equal(call.where.moderation_status, 'none')
      assert.equal(call.take, 200)
    }
  })

  it('drops a private skill from an anonymous search on both passes', async () => {
    const db = fakePrisma('skills', [
      [skill('web-design-guidelines', { visibility: 'private' })],
      [skill('web-design-guidelines', { visibility: 'private' })],
    ])
    const out = await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    assert.deepEqual(out, [])
  })

  it('drops a suspended author on both passes', async () => {
    const db = fakePrisma('skills', [[skill('web-design-guidelines')], [skill('web-design-tips')]], {
      users: { findMany: async () => [{ handle: 'alice' }] },
    })
    const out = await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    assert.deepEqual(out, [])
  })

  it('ranks a row matching more tokens above one matching fewer', async () => {
    const db = fakePrisma('skills', [[], [skill('web-component-design'), skill('design-md')]])
    const out = await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    assert.deepEqual(
      out.map((r) => r.slug),
      ['web-component-design', 'design-md'],
    )
    assert.ok((out[0]!.score as number) > (out[1]!.score as number))
  })

  // The HTTP route lowercases before calling; the MCP summon fallback does not.
  // Normalization lives in the matcher so both callers behave the same.
  it('matches the same rows whatever the query case', async () => {
    const upper = fakePrisma('skills', [[skill('web-design-guidelines')]])
    const lower = fakePrisma('skills', [[skill('web-design-guidelines')]])
    assert.deepEqual(
      await searchSkillsPrisma(asDb(upper), 'Web Design', null, 8),
      await searchSkillsPrisma(asDb(lower), 'web design', null, 8),
    )
    assert.deepEqual(upper.calls[0]!.where, lower.calls[0]!.where, 'tokens are lowercased for SQL')
  })

  it('returns the unchanged item shape', async () => {
    const db = fakePrisma('skills', [[skill('web-design-guidelines')]])
    const out = await searchSkillsPrisma(asDb(db), 'web design', null, 8)
    assert.deepEqual(Object.keys(out[0]!).sort(), [
      'author',
      'category',
      'description',
      'install_count',
      'score',
      'skill_id',
      'slug',
      'type',
      'url',
      'visibility',
    ])
  })
})

describe('kit search candidacy', () => {
  const kit = (name: string, over: Record<string, unknown> = {}) => ({
    id: 'kit-1',
    owner_id: 'alice',
    name,
    description: 'a kit',
    visibility: 'public',
    created_at: 1,
    _count: { kit_members: 0 },
    ...over,
  })

  it('matches a multi-word query across a hyphen in the name', async () => {
    const db = fakePrisma('kits', [[kit('web-design')]])
    const out = await searchKitsPrisma(asDb(db), 'web design', null, 8)
    assert.equal(db.calls.length, 1)
    assert.equal(out.length, 1)
    assert.deepEqual(orColumns((db.calls[0]!.where.AND as unknown[])[0]), ['name', 'description'])
  })

  it('falls back to any-token matching and still enriches categories', async () => {
    const db = fakePrisma('kits', [[], [kit('design tools')]])
    const out = await searchKitsPrisma(asDb(db), 'web design', null, 8)
    assert.equal(db.calls.length, 2)
    assert.deepEqual(out[0]!.skill_categories, [])
  })

  it('drops a suspended owner', async () => {
    const db = fakePrisma('kits', [[kit('web-design')]], {
      users: { findMany: async () => [{ handle: 'alice' }] },
    })
    assert.deepEqual(await searchKitsPrisma(asDb(db), 'web design', null, 8), [])
  })
})

describe('author search candidacy', () => {
  const author = (id: string) => ({
    id,
    name: 'Alice',
    avatar_url: null,
    bio: 'builds things',
    created_at: 1,
  })

  it('matches a hyphenated handle from a two-word query', async () => {
    const db = fakePrisma('authors', [[author('web-designer')]])
    const out = await searchAuthorsPrisma(asDb(db), 'web designer', 8)
    assert.equal(db.calls.length, 1)
    assert.equal(out[0]!.username, 'web-designer')
    assert.deepEqual(orColumns((db.calls[0]!.where.AND as unknown[])[0]), ['id', 'name', 'bio'])
  })

  it('falls back to any-token matching', async () => {
    const db = fakePrisma('authors', [[], [author('designer')]])
    const out = await searchAuthorsPrisma(asDb(db), 'web designer', 8)
    assert.equal(db.calls.length, 2)
    assert.equal(out.length, 1)
  })
})

describe('team search candidacy', () => {
  const team = (slug: string) => ({ slug, name: 'Web Design Co', created_at: 1 })

  it('matches on slug and name only', async () => {
    const db = fakePrisma('organizations', [[team('web-design-co')]])
    const out = await searchTeamsPrisma(asDb(db), 'web design', 8)
    assert.equal(out[0]!.slug, 'web-design-co')
    assert.deepEqual(orColumns((db.calls[0]!.where.AND as unknown[])[0]), ['slug', 'name'])
  })
})
