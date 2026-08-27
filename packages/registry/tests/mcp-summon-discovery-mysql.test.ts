// Summon over MCP: the registry-side DiscoverySource.
//
// The contract this file defends is parity. Summon over MCP and summon over
// HTTP must answer identically for the same handle, because two summon
// implementations that drift is a bug nobody notices for months. So the
// candidate assertions compare the two paths directly rather than asserting a
// hand-written expectation twice.
//
// It also holds the boundary the MCP-side tests deliberately cannot: serve
// guards, the read ACL, and private-skill exclusion are enforced here, and a
// stub source could only ever prove the stub.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalContentHash } from '@skillet/protocol'
import { buildServer } from '../src/server.js'
import { MemoryBlobStore } from '../src/blob-store/memory-blob-store.js'
import { blobHash } from '../src/db/index.js'
import { createRegistryDiscoveryPrisma } from '../src/mcp/discovery-prisma.js'
import {
  createTestPrismaClient,
  ensureMysqlMigrated,
  mysqlTestsEnabled,
  requireTestDatabaseUrl,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

type Prisma = ReturnType<typeof createTestPrismaClient>

async function author(prisma: Prisma, id: string, extra: Record<string, unknown> = {}) {
  await prisma.authors.upsert({
    where: { id },
    create: { id, name: id, ...extra },
    update: { ...extra },
  })
}

async function seedSkill(
  prisma: Prisma,
  store: MemoryBlobStore,
  opts: {
    author: string
    slug: string
    visibility?: string
    moderation?: string
    scan?: 'clean' | 'quarantined'
    body?: string
  },
): Promise<string> {
  const {
    author: a, slug, visibility = 'public', moderation = 'none', scan = 'clean',
  } = opts
  const body = opts.body ?? `---\nname: ${slug}\ndescription: d\n---\n# ${slug}\n`
  const bytes = new TextEncoder().encode(body)
  const bh = blobHash(bytes)
  await store.put(bh, bytes)
  const versionHash = canonicalContentHash(new Map<string, Uint8Array>([['SKILL.md', bytes]]))
  const skillId = `${a}:${slug}`
  await author(prisma, a)
  await prisma.skills.create({
    data: {
      id: skillId, author_id: a, slug, description: `${slug} description`,
      visibility, latest_hash: versionHash, moderation_status: moderation,
    },
  })
  await prisma.skill_versions.create({
    data: {
      skill_id: skillId, hash: versionHash, published_by: a,
      published_at: 1_700_000_000, metadata_json: JSON.stringify({ name: `The ${slug}` }),
      major: 1, minor: 2, patch: 3,
    },
  })
  await prisma.skill_version_files.create({
    data: { skill_id: skillId, version_hash: versionHash, path: 'SKILL.md', blob_hash: bh },
  })
  await prisma.skill_version_scans.create({
    data: {
      skill_id: skillId, skill_version_id: versionHash,
      status: scan === 'clean' ? 'clean' : 'quarantined',
      findings_json: '[]', scanned_at: 1_700_000_000,
    },
  })
  return versionHash
}

async function publicKitWith(prisma: Prisma, owner: string, kitId: string, skillIds: string[]) {
  await author(prisma, owner)
  await prisma.kits.create({
    data: { id: kitId, owner_id: owner, slug: kitId, name: kitId, visibility: 'public' },
  })
  for (const skill_id of skillIds) {
    await prisma.kit_skills.create({ data: { kit_id: kitId, skill_id } })
  }
}

async function withDb<T>(fn: (prisma: Prisma, store: MemoryBlobStore) => Promise<T>): Promise<T> {
  process.env.DATABASE_URL = requireTestDatabaseUrl()
  process.env.BLOB_STORE = 'memory'
  await ensureMysqlMigrated()
  const prisma = createTestPrismaClient()
  try {
    await resetMysqlRegistry(prisma)
    return await fn(prisma, new MemoryBlobStore(undefined, prisma))
  } finally {
    await prisma.$disconnect()
  }
}

const discovery = (prisma: Prisma, store: MemoryBlobStore) =>
  createRegistryDiscoveryPrisma(prisma, store, { principal: null })

describe('summon over MCP matches summon over HTTP', { skip: !hasDatabaseUrl }, () => {
  it('returns the same candidate set the HTTP endpoint returns', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'typescript' })
      await seedSkill(prisma, store, { author: 'shadcn', slug: 'component-api' })
      await publicKitWith(prisma, 'matt', 'picks', ['shadcn:component-api'])

      const h = await buildServer({ logger: false, usePrismaAuth: true, auth: { devAuth: true }, blobStore: store })
      await h.app.ready()
      try {
        const http = await h.app.inject({ method: 'GET', url: '/api/v1/authors/matt/summon' })
        assert.equal(http.statusCode, 200, http.body)
        const httpRefs = (JSON.parse(http.body).skills as { ref: string }[])
          .map((s) => s.ref).sort()

        const res = await discovery(prisma, store).summon('matt')
        assert.equal(res.kind, 'ok')
        const mcpRefs = res.kind === 'ok' ? res.candidates.map((c) => c.ref).sort() : []

        // Parity is the whole point: one composition rule, two callers.
        assert.deepEqual(mcpRefs, httpRefs)
      } finally {
        await h.app.close()
      }
    })
  })

  it('credits the true author for a curated skill and names the curator via', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'shadcn', slug: 'component-api' })
      await publicKitWith(prisma, 'matt', 'picks', ['shadcn:component-api'])

      const res = await discovery(prisma, store).summon('matt')
      assert.equal(res.kind, 'ok')
      if (res.kind !== 'ok') return
      const c = res.candidates.find((x) => x.ref.includes('component-api'))
      assert.ok(c, 'curated skill should appear in the summon set')
      assert.equal(c.ref, '@shadcn/component-api')
      assert.equal(c.via, 'matt')
    })
  })

  it('never surfaces a private skill sitting in a public kit', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'shadcn', slug: 'secret', visibility: 'private' })
      await publicKitWith(prisma, 'matt', 'picks', ['shadcn:secret'])

      const res = await discovery(prisma, store).summon('matt')
      assert.equal(res.kind, 'ok')
      if (res.kind !== 'ok') return
      assert.equal(res.candidates.length, 0)
    })
  })

  it('separates an unknown handle from an author who publishes nothing', async () => {
    await withDb(async (prisma, store) => {
      await author(prisma, 'quiet')
      const d = discovery(prisma, store)

      assert.equal((await d.summon('nobody')).kind, 'unknown-handle')
      const empty = await d.summon('quiet')
      assert.equal(empty.kind, 'ok')
      if (empty.kind === 'ok') assert.equal(empty.candidates.length, 0)
    })
  })
})

describe('the public read path keeps the sync guards', { skip: !hasDatabaseUrl }, () => {
  it('loads a public skill the caller has not added', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'typescript' })

      const got = await discovery(prisma, store).readPublicSkill('@matt/typescript')
      assert.ok(got, 'a public skill should load by ref')
      assert.match(got.skillMd ?? '', /# typescript/)
      assert.equal(got.name, 'The typescript')
      assert.equal(got.versionLabel, '1.2.3')
      assert.deepEqual(got.resources, ['SKILL.md'])
    })
  })

  it('accepts an unsigilled ref the same as a sigilled one', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'typescript' })
      const d = discovery(prisma, store)

      assert.ok(await d.readPublicSkill('matt/typescript'))
      assert.ok(await d.readPublicSkill('@matt/typescript'))
    })
  })

  it('refuses a scanner-quarantined skill', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'bad', scan: 'quarantined' })

      // As unavailable to a cloud client as it is to a syncing device.
      assert.equal(await discovery(prisma, store).readPublicSkill('@matt/bad'), null)
    })
  })

  it('refuses a moderation-quarantined skill', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'taken', moderation: 'quarantined' })

      assert.equal(await discovery(prisma, store).readPublicSkill('@matt/taken'), null)
    })
  })

  it('reports not found for a private skill rather than leaking that it exists', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'secret', visibility: 'private' })

      assert.equal(await discovery(prisma, store).readPublicSkill('@matt/secret'), null)
    })
  })

  it('returns null for a ref that is not a ref', async () => {
    await withDb(async (prisma, store) => {
      const d = discovery(prisma, store)
      assert.equal(await d.readPublicSkill('not-a-ref'), null)
      assert.equal(await d.readPublicSkill('a/b/c'), null)
    })
  })
})

describe('the cross-author fallback', { skip: !hasDatabaseUrl }, () => {
  it('finds skills by keyword across every author', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'changelog-writer' })
      await seedSkill(prisma, store, { author: 'shadcn', slug: 'unrelated' })

      const found = await discovery(prisma, store).searchPublic('changelog')
      assert.equal(found.length, 1)
      assert.equal(found[0]?.ref, '@matt/changelog-writer')
    })
  })

  it('carries a loadable hash, so a fallback pick can actually be opened', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'changelog-writer' })
      const d = discovery(prisma, store)

      const found = await d.searchPublic('changelog')
      const hash = found[0]?.hash
      assert.ok(hash, 'a candidate without a hash cannot be loaded at a pinned version')

      // The round trip is the point: search → get_skill must actually work.
      const loaded = await d.readPublicSkill(found[0]!.ref, { hash })
      assert.ok(loaded)
      assert.match(loaded.skillMd ?? '', /# changelog-writer/)
    })
  })

  it('never returns a private skill to an anonymous caller', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'changelog-secret', visibility: 'private' })

      assert.deepEqual(await discovery(prisma, store).searchPublic('changelog'), [])
    })
  })

  it('records the fallback as its own search source, without the words', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'changelog-writer' })

      await discovery(prisma, store).searchPublic('write my changelog for the release')

      const rows = await prisma.search_source_counts.findMany()
      // The marker is attributed; the user's own words are never stored.
      assert.ok(rows.some((r) => r.source === 'summon-fallback'))
      for (const r of rows) assert.ok(!JSON.stringify(r).includes('release'))
    })
  })

  it('returns an empty set rather than throwing when nothing matches', async () => {
    await withDb(async (prisma, store) => {
      assert.deepEqual(await discovery(prisma, store).searchPublic('zzzznothing'), [])
    })
  })
})

describe('a cloud summon moves the same counter the URL path moves', { skip: !hasDatabaseUrl }, () => {
  async function reach(prisma: Prisma, skillId: string): Promise<number> {
    for (let i = 0; i < 40; i++) {
      const rows = await prisma.skill_summon_counts.findMany({ where: { skill_id: skillId } })
      const total = rows.reduce((n, r) => n + r.count, 0)
      if (total > 0) return total
      await new Promise((r) => setTimeout(r, 25))
    }
    return 0
  }

  it('counts a read that came from a summon', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'shadcn', slug: 'component-api' })

      await discovery(prisma, store).readPublicSkill('@shadcn/component-api', { via: 'matt' })

      assert.equal(await reach(prisma, 'shadcn:component-api'), 1)
      const rows = await prisma.skill_summon_counts.findMany({ where: { skill_id: 'shadcn:component-api' } })
      // The curator is the via; the count belongs to the author's skill.
      assert.equal(rows[0]?.via_handle, 'matt')
    })
  })

  it('counts nothing for a plain read of a public ref', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'typescript' })

      // No via means no summon happened, exactly as an unmarked HTTP fetch
      // counts nothing. Pasting a ref is not a summon.
      await discovery(prisma, store).readPublicSkill('@matt/typescript')

      await new Promise((r) => setTimeout(r, 150))
      assert.equal(await prisma.skill_summon_counts.count({ where: { skill_id: 'matt:typescript' } }), 0)
    })
  })

  // U2 / R13. The gate used to be `via`, which is ABSENT for a skill the
  // summoned handle wrote themselves. That is the common case, so an authored
  // summon over MCP counted nothing while the identical summon over HTTP
  // counted one: HTTP gates on `src=summon` with `via` optional. The existing
  // coverage above only exercises the curated path, where `via` is set, so it
  // passed under the bug.
  it('counts an AUTHORED summon, where there is no curator to credit', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'authored', slug: 'own-work' })

      await discovery(prisma, store).readPublicSkill('@authored/own-work', { summoned: true })

      assert.equal(await reach(prisma, 'authored:own-work'), 1)
      const rows = await prisma.skill_summon_counts.findMany({ where: { skill_id: 'authored:own-work' } })
      // No curator, so no via. The author still gets the credit.
      assert.equal(rows[0]?.via_handle, '')
    })
  })

  // A client still on the pre-`summoned` contract sends `via` and nothing else.
  // Narrowing the guard to the marker alone would zero those clients' credit
  // the moment this ships, so `via` keeps implying a summon through the
  // transition.
  it('keeps counting for a client that sends via but not the summon marker', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'legacy', slug: 'old-client' })

      await discovery(prisma, store).readPublicSkill('@legacy/old-client', { via: 'curator' })

      assert.equal(await reach(prisma, 'legacy:old-client'), 1)
    })
  })

  // U3 / R15. The split is a companion column, so `count` keeps its meaning and
  // no public total moves. An anonymous caller is the normal case here.
  it('files an anonymous summon under the anonymous side of the split', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'anon', slug: 'split-check' })

      await discovery(prisma, store).readPublicSkill('@anon/split-check', { summoned: true })

      assert.equal(await reach(prisma, 'anon:split-check'), 1)
      const rows = await prisma.skill_summon_counts.findMany({ where: { skill_id: 'anon:split-check' } })
      assert.equal(rows[0]?.count, 1)
      assert.equal(rows[0]?.authed_count, 0, 'no principal means anonymous, not authed')
    })
  })

  it('records only a short handle, never free text', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'typescript' })

      await discovery(prisma, store).readPublicSkill('@matt/typescript', {
        via: 'write my changelog for the release',
      })
      await new Promise((r) => setTimeout(r, 150))

      // emitSummonEvent drops anything that is not a slug, so a task string
      // cannot reach the column even if a caller puts one there.
      const rows = await prisma.skill_summon_counts.findMany({ where: { skill_id: 'matt:typescript' } })
      for (const r of rows) assert.equal(r.via_handle, '')
    })
  })
})

describe('author standing never argues against the author', { skip: !hasDatabaseUrl }, () => {
  it('omits counts that are zero and keeps the bio', async () => {
    await withDb(async (prisma, store) => {
      await author(prisma, 'newbie', { bio: 'Just arrived' })

      const s = await discovery(prisma, store).authorStanding('newbie')
      assert.ok(s)
      assert.equal(s.bio, 'Just arrived')
      assert.equal(s.installs, undefined)
      assert.equal(s.summons, undefined)
    })
  })

  it('counts public adopters, not the raw install column', async () => {
    await withDb(async (prisma, store) => {
      await seedSkill(prisma, store, { author: 'matt', slug: 'typescript' })
      // A big raw counter with nobody actually adopting it.
      await prisma.skills.update({
        where: { id: 'matt:typescript' },
        data: { install_count: 999 },
      })

      const s = await discovery(prisma, store).authorStanding('matt')
      // "N installs" means distinct public adopters everywhere else in the
      // product. If this reported 999, an agent would quote a number the
      // author's own profile page contradicts.
      assert.notEqual(s?.installs, 999)
      assert.equal(s?.installs, undefined)
    })
  })

  it('states mirror provenance instead of a fabricated count', async () => {
    await withDb(async (prisma, store) => {
      await author(prisma, 'flutter', { is_mirror: 1, mirror_source_url: 'https://github.com/flutter/flutter' })

      const s = await discovery(prisma, store).authorStanding('flutter')
      assert.equal(s?.mirrorSource, 'https://github.com/flutter/flutter')
    })
  })

  it('returns null for an author who does not exist', async () => {
    await withDb(async (prisma, store) => {
      assert.equal(await discovery(prisma, store).authorStanding('ghost'), null)
    })
  })
})
