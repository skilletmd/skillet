// Nightly mirror ops against MySQL (Prisma): claim-guarded author upsert,
// seed re-sync with claim-aware caps, tombstone moderation guard, phase-2
// backfill from the review queue, discovery enqueue, and the in-flight unique
// index. All GitHub access goes through an injectable fetch.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { newId } from '../src/db/index.js'
import { upsertMirrorAuthorPrisma, RealAuthorCollisionError } from '../src/lib/mirror-authors.js'
import { syncAllSourcesPrisma, clearSourcePrisma, authorClaimedPrisma, type MirrorSource } from '../src/mirror-ops/sync-sources.js'
import { runNightlyMirrorOps, NIGHTLY_LOCK_NAME } from '../src/mirror-ops/nightly.js'
import { CAPABILITY_VERSION } from '../src/scanner/capabilities/scan.js'
import { discoverMirrorCandidates } from '../src/mirror-ops/discovery.js'
import {
  createTestPrismaClient,
  ensureMysqlMigrated,
  freshMysqlPrisma,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} does a thing for tests\n---\n\nUse ${name}.`
}

interface FakeRepo {
  /** path → file content; SKILL.md paths drive discovery. */
  files: Record<string, string>
  ownerLogin?: string
  ownerId?: number
  ownerType?: string
  spdx?: string
  /** Serve 403 + x-ratelimit-remaining:0 for this repo's API calls. */
  rateLimited?: boolean
}

/** Serves the engine's repo/branches/tree/raw endpoints plus repo search. */
function repoFetch(repos: Record<string, FakeRepo>, opts: { searchItems?: string[] } = {}): typeof fetch {
  const jsonRes = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  return (async (input: string | URL | Request) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    if (u.startsWith('https://api.github.com/search/repositories')) {
      return jsonRes({ items: (opts.searchItems ?? []).map((full_name) => ({ full_name })) })
    }

    const raw = u.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/(.+)$/)
    if (raw) {
      const cfg = repos[`${raw[1]}/${raw[2]}`]
      const path = decodeURIComponent(raw[3]!)
      const content = cfg?.files[path]
      if (content == null) return new Response('not found', { status: 404 })
      return new Response(content, { status: 200 })
    }

    const m = u.match(/api\.github\.com\/repos\/([^/]+)\/([^/?]+)/)
    if (!m) return new Response('not found', { status: 404 })
    const cfg = repos[`${m[1]}/${m[2]}`]
    if (!cfg) return new Response('not found', { status: 404 })
    if (cfg.rateLimited) {
      return new Response('rate limited', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      })
    }
    if (u.includes('/branches/')) return jsonRes({ commit: { sha: 'testsha' } })
    if (u.includes('/git/trees/')) {
      return jsonRes({
        tree: Object.entries(cfg.files).map(([path, content]) => ({
          path,
          type: 'blob',
          size: content.length,
        })),
      })
    }
    return jsonRes({
      fork: false,
      default_branch: 'main',
      owner: { login: cfg.ownerLogin ?? m[1], id: cfg.ownerId ?? 1000, type: cfg.ownerType ?? 'Organization' },
      license: { spdx_id: cfg.spdx ?? 'MIT' },
    })
  }) as typeof fetch
}

function mkSource(handle: string, repo: string, extra: Partial<MirrorSource> = {}): MirrorSource {
  return {
    handle,
    displayName: `${handle} Display`,
    bio: `${handle} bio`,
    repo,
    license: 'MIT',
    logo: `https://example.com/${handle}.png`,
    sourceUrl: `https://github.com/${repo}`,
    ...extra,
  }
}

describe('mirror ops mysql (nightly job)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  async function reset(): Promise<void> {
    await resetMysqlRegistry(prisma)
  }

  /** skill_reports.reported_by FKs users; mint a reporter. */
  async function mkReporter(): Promise<string> {
    const id = newId()
    await prisma.users.create({ data: { id, handle: `reporter-${id.slice(0, 8)}` } })
    return id
  }

  // ---------------------------------------------------------------- U1

  it('unclaimed mirror author gets profile refreshed from seed values', async () => {
    await reset()
    await upsertMirrorAuthorPrisma(prisma, 'acme', 'acme', 'acme/skills', 'Organization', {
      displayName: 'Acme', bio: 'old bio', avatarUrl: 'https://a/1.png',
    })
    await upsertMirrorAuthorPrisma(prisma, 'acme', 'acme', 'acme/skills', 'Organization', {
      displayName: 'Acme Inc', bio: 'new bio', avatarUrl: 'https://a/2.png',
    })
    const row = await prisma.authors.findUnique({ where: { id: 'acme' } })
    assert.equal(row?.name, 'Acme Inc')
    assert.equal(row?.bio, 'new bio')
    assert.equal(row?.avatar_url, 'https://a/2.png')
    assert.equal(row?.is_mirror, 1)
    assert.equal(row?.mirror_claimed_at, null)
  })

  it('claimed author profile is never overwritten; claim survives', async () => {
    await reset()
    await upsertMirrorAuthorPrisma(prisma, 'acme', 'acme', 'acme/skills', 'User', {
      displayName: 'Acme', bio: 'owner bio', avatarUrl: 'https://a/1.png',
    })
    const claimedAt = Math.floor(Date.now() / 1000)
    await prisma.authors.update({ where: { id: 'acme' }, data: { mirror_claimed_at: claimedAt } })
    await upsertMirrorAuthorPrisma(prisma, 'acme', 'acme', 'acme/skills', 'User', {
      displayName: 'Seed Clobber', bio: 'seed bio', avatarUrl: 'https://a/9.png',
    })
    const row = await prisma.authors.findUnique({ where: { id: 'acme' } })
    assert.equal(row?.name, 'Acme')
    assert.equal(row?.bio, 'owner bio')
    assert.equal(row?.avatar_url, 'https://a/1.png')
    assert.equal(row?.mirror_claimed_at, claimedAt)
  })

  it('missing author row is created as is_mirror=1', async () => {
    await reset()
    await upsertMirrorAuthorPrisma(prisma, 'fresh', 'fresh', 'fresh/skills', null)
    const row = await prisma.authors.findUnique({ where: { id: 'fresh' } })
    assert.equal(row?.is_mirror, 1)
    assert.equal(row?.name, 'fresh')
  })

  it('collision with a real (non-mirror) author throws and changes nothing', async () => {
    await reset()
    await prisma.authors.create({ data: { id: 'realco', name: 'Real Co', is_mirror: 0 } })
    await assert.rejects(
      () => upsertMirrorAuthorPrisma(prisma, 'realco', 'evil', 'evil/skills', 'User'),
      RealAuthorCollisionError,
    )
    const row = await prisma.authors.findUnique({ where: { id: 'realco' } })
    assert.equal(row?.name, 'Real Co')
    assert.equal(row?.is_mirror, 0)
  })

  // ---------------------------------------------------------------- U2

  const twoSkillRepo: FakeRepo = {
    files: {
      'skills/alpha/SKILL.md': skillMd('alpha'),
      'skills/beta/SKILL.md': skillMd('beta'),
    },
  }

  it('curated maxSkills caps an unclaimed source', async () => {
    await reset()
    const r = await syncAllSourcesPrisma(prisma, {
      sources: [mkSource('acme', 'acme/skills', { maxSkills: 1, syncMode: 'per-skill' })],
      fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      denylist: new Map(),
    })
    assert.equal(r.failed, 0)
    const skills = await prisma.skills.findMany({ where: { author_id: 'acme' } })
    assert.equal(skills.length, 1)
    const blobs = await prisma.blobs.findMany()
    assert.ok(blobs.length > 0)
    for (const b of blobs) {
      // Dev/test runs the MemoryBlobStore, which now persists bytes inline so
      // mirrored content stays readable across a registry restart. (Prod mirrors
      // to R2 — storage_loc='r2', bytes external — a path this test doesn't run.)
      assert.equal(b.storage_loc, 'inline')
      assert.ok(b.bytes != null && b.bytes.length > 0)
    }
  })

  it('a synced version lands with its capability manifest, not just threat findings', async () => {
    // Regression: sync used to persist the scan with a null capability report, so
    // every mirrored skill read "not yet scanned" on its skill and kit pages (the
    // trust panel keys that state off a missing manifest, not off the threat scan).
    await reset()
    const r = await syncAllSourcesPrisma(prisma, {
      sources: [mkSource('acme', 'acme/skills', { syncMode: 'per-skill' })],
      fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      denylist: new Map(),
    })
    assert.equal(r.failed, 0)
    const scans = await prisma.skill_version_scans.findMany()
    assert.ok(scans.length > 0)
    for (const scan of scans) {
      assert.equal(scan.status, 'clean')
      assert.ok(scan.capabilities_json != null, 'capability manifest must be computed')
      assert.equal(scan.capabilities_version, CAPABILITY_VERSION)
      const report = JSON.parse(scan.capabilities_json as string) as { capabilities: unknown[] }
      assert.ok(Array.isArray(report.capabilities))
    }
  })

  it('claiming lifts the curated cap (engine default applies)', async () => {
    await reset()
    await prisma.authors.create({
      data: { id: 'acme', name: 'Owner Name', is_mirror: 1, mirror_claimed_at: 111 },
    })
    const r = await syncAllSourcesPrisma(prisma, {
      sources: [mkSource('acme', 'acme/skills', { maxSkills: 1, syncMode: 'per-skill' })],
      fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      denylist: new Map(),
    })
    assert.equal(r.failed, 0)
    const skills = await prisma.skills.findMany({ where: { author_id: 'acme' } })
    assert.equal(skills.length, 2)
    // And the profile stayed the owner's.
    const author = await prisma.authors.findUnique({ where: { id: 'acme' } })
    assert.equal(author?.name, 'Owner Name')
  })

  it('one failing source does not stop the loop', async () => {
    await reset()
    const r = await syncAllSourcesPrisma(prisma, {
      sources: [mkSource('gone', 'gone/skills'), mkSource('acme', 'acme/skills', { syncMode: 'per-skill' })],
      fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      denylist: new Map(),
    })
    assert.equal(r.failed, 1)
    assert.equal((await prisma.skills.findMany({ where: { author_id: 'acme' } })).length, 2)
  })

  it('rate limit aborts remaining sources instead of iterating failures', async () => {
    await reset()
    const r = await syncAllSourcesPrisma(prisma, {
      sources: [
        mkSource('limited', 'limited/skills'),
        mkSource('acme', 'acme/skills', { syncMode: 'per-skill' }),
      ],
      fetchImpl: repoFetch({
        'limited/skills': { files: {}, rateLimited: true },
        'acme/skills': twoSkillRepo,
      }),
      denylist: new Map(),
    })
    assert.equal(r.rateLimited, true)
    assert.equal(r.notAttempted, 1)
    assert.equal((await prisma.skills.findMany({ where: { author_id: 'acme' } })).length, 0)
  })

  it('denylisted seed is skipped, not synced', async () => {
    await reset()
    const r = await syncAllSourcesPrisma(prisma, {
      sources: [mkSource('acme', 'acme/skills', { syncMode: 'per-skill' })],
      fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      denylist: new Map([['acme/skills', 'compromised upstream']]),
    })
    assert.equal(r.denylisted, 1)
    assert.equal((await prisma.skills.findMany({ where: { author_id: 'acme' } })).length, 0)
  })

  it('dry-run writes nothing', async () => {
    await reset()
    const r = await syncAllSourcesPrisma(prisma, {
      dryRun: true,
      sources: [mkSource('acme', 'acme/skills', { syncMode: 'per-skill' })],
      fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      denylist: new Map(),
    })
    assert.equal(r.failed, 0)
    assert.equal(await prisma.authors.count(), 0)
    assert.equal(await prisma.skills.count(), 0)
  })

  // ---------------------------------------------------------------- --clear

  it('--clear refuses claimed authors and moderation history; clears otherwise', async () => {
    await reset()
    const src = mkSource('acme', 'acme/skills', { syncMode: 'per-skill' })
    await syncAllSourcesPrisma(prisma, {
      sources: [src],
      fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      denylist: new Map(),
    })

    // Claimed → refuse.
    await prisma.authors.update({ where: { id: 'acme' }, data: { mirror_claimed_at: 1 } })
    await assert.rejects(() => clearSourcePrisma(prisma, src), /claimed/)
    await prisma.authors.update({ where: { id: 'acme' }, data: { mirror_claimed_at: null } })

    // Reported skill → refuse the whole clear, naming the blocker.
    const reported = (await prisma.skills.findFirst({ where: { author_id: 'acme' } }))!
    await prisma.skill_reports.create({
      data: { id: newId(), skill_id: reported.id, reported_by: await mkReporter(), category: 'malware' },
    })
    await assert.rejects(() => clearSourcePrisma(prisma, src), new RegExp(reported.id))
    assert.equal(await prisma.skills.count({ where: { author_id: 'acme' } }), 2)

    // Clean → clears skills, linked kit, author.
    await prisma.skill_reports.deleteMany({})
    await clearSourcePrisma(prisma, src)
    assert.equal(await prisma.skills.count({ where: { author_id: 'acme' } }), 0)
    assert.equal(await prisma.kits.count({ where: { owner_id: 'acme' } }), 0)
    assert.equal(await prisma.authors.count({ where: { id: 'acme' } }), 0)
  })

  // ---------------------------------------------------------------- U3

  it('tombstones vanished skills but keeps ones with moderation history', async () => {
    await reset()
    const src = mkSource('acme', 'acme/skills', { syncMode: 'per-skill' })
    await syncAllSourcesPrisma(prisma, {
      sources: [src],
      fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      denylist: new Map(),
    })
    assert.equal(await prisma.skills.count({ where: { author_id: 'acme' } }), 2)

    // beta gets a report; upstream then drops BOTH skills' directories → alpha
    // deletes, beta is kept (trail outlives the mirror), sync still completes.
    const beta = (await prisma.skills.findFirst({ where: { slug: 'beta' } }))!
    await prisma.skill_reports.create({
      data: { id: newId(), skill_id: beta.id, reported_by: await mkReporter(), category: 'spam' },
    })
    const shrunk: FakeRepo = { files: { 'skills/gamma/SKILL.md': skillMd('gamma') } }
    const r = await syncAllSourcesPrisma(prisma, {
      sources: [src],
      fetchImpl: repoFetch({ 'acme/skills': shrunk }),
      denylist: new Map(),
    })
    assert.equal(r.failed, 0)
    const slugs = (await prisma.skills.findMany({ where: { author_id: 'acme' } })).map((s) => s.slug).sort()
    assert.deepEqual(slugs, ['beta', 'gamma'])
  })

  // ---------------------------------------------------------------- U4

  it('phase 2 backfills a live queue row that has no skill_mirrors rows', async () => {
    await reset()
    // Approve-time state: author exists, queue row live, sync never succeeded.
    await prisma.authors.create({
      data: { id: 'disco', name: 'disco', is_mirror: 1, mirror_source_url: 'https://github.com/disco/skills' },
    })
    await prisma.mirror_review_queue.create({
      data: {
        id: newId(), source_repo: 'disco/skills', normalized_repo_key: 'disco/skills',
        derived_handle: 'disco', license: 'MIT', status: 'live', submitted_by: 'discovery',
      },
    })
    const result = await runNightlyMirrorOps(prisma, {
      syncToken: 'test-token',
      sources: [],
      denylist: new Map(),
      fetchImpl: repoFetch({ 'disco/skills': { files: { 'skills/solo/SKILL.md': skillMd('solo') } } }),
    })
    assert.equal(result.exitCode, 0)
    assert.equal(result.phase2?.synced, 1)
    assert.equal(await prisma.skills.count({ where: { author_id: 'disco' } }), 1)
  })

  it('phase 2 skips repos covered by seeds or the denylist', async () => {
    await reset()
    await prisma.authors.create({ data: { id: 'dupe', name: 'dupe', is_mirror: 1 } })
    for (const repo of ['dupe/skills', 'bad/skills']) {
      await prisma.mirror_review_queue.create({
        data: {
          id: newId(), source_repo: repo, normalized_repo_key: repo,
          derived_handle: repo.split('/')[0]!, license: 'MIT', status: 'live', submitted_by: 'discovery',
        },
      })
    }
    const result = await runNightlyMirrorOps(prisma, {
      syncToken: 'test-token',
      sources: [mkSource('dupe', 'dupe/skills', { syncMode: 'per-skill' })],
      denylist: new Map([['bad/skills', 'spam']]),
      fetchImpl: repoFetch({ 'dupe/skills': twoSkillRepo }),
    })
    // Seed repo synced once in phase 1; phase 2 attempted neither queue row.
    assert.equal(result.phase1?.failed, 0)
    assert.equal(result.phase2?.synced, 0)
    assert.equal(result.phase2?.failed, 0)
  })

  it('a second concurrent run exits 0 without doing work (advisory lock)', async () => {
    await reset()
    const holder = createTestPrismaClient()
    try {
      const held = await holder.$queryRawUnsafe<Array<{ l: unknown }>>(
        'SELECT GET_LOCK(?, 0) AS l', NIGHTLY_LOCK_NAME,
      )
      assert.equal(Number(held[0]?.l), 1)
      const result = await runNightlyMirrorOps(prisma, {
        syncToken: 'test-token',
        sources: [mkSource('acme', 'acme/skills')],
        denylist: new Map(),
        fetchImpl: repoFetch({ 'acme/skills': twoSkillRepo }),
      })
      assert.equal(result.lockAcquired, false)
      assert.equal(result.exitCode, 0)
      assert.equal(result.phase1, null)
      assert.equal(await prisma.skills.count(), 0)
    } finally {
      await holder.$disconnect()
    }
  })

  it('a per-source failure makes the run exit 1', async () => {
    await reset()
    const result = await runNightlyMirrorOps(prisma, {
      syncToken: 'test-token',
      sources: [mkSource('gone', 'gone/skills')],
      denylist: new Map(),
      fetchImpl: repoFetch({}),
    })
    assert.equal(result.exitCode, 1)
    assert.equal(result.phase1?.failed, 1)
  })

  it('startup fails loudly without a sync token', async () => {
    await reset()
    const saved = { mirror: process.env.SKILLET_MIRROR_GITHUB_TOKEN, gh: process.env.GITHUB_TOKEN }
    delete process.env.SKILLET_MIRROR_GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    try {
      await assert.rejects(
        () => runNightlyMirrorOps(prisma, { sources: [], denylist: new Map() }),
        /no sync token/,
      )
    } finally {
      if (saved.mirror != null) process.env.SKILLET_MIRROR_GITHUB_TOKEN = saved.mirror
      if (saved.gh != null) process.env.GITHUB_TOKEN = saved.gh
    }
  })

  // ---------------------------------------------------------------- U5

  it('discovery screens and enqueues a candidate; re-runs and live mirrors skip', async () => {
    await reset()
    const fetchImpl = repoFetch({
      'newco/skills': { files: { 'skills/demo/SKILL.md': skillMd('demo') }, ownerLogin: 'newco', ownerType: 'User' },
    })
    const first = await discoverMirrorCandidates({
      prisma, repos: ['newco/skills'], denylist: new Map(), fetchImpl,
    })
    assert.equal(first.enqueued.length, 1)
    assert.equal(first.enqueued[0]?.status, 'pending_review')
    const row = await prisma.mirror_review_queue.findFirst({ where: { normalized_repo_key: 'newco/skills' } })
    assert.equal(row?.submitted_by, 'discovery')

    const rerun = await discoverMirrorCandidates({
      prisma, repos: ['newco/skills'], denylist: new Map(), fetchImpl,
    })
    assert.equal(rerun.enqueued.length, 0)
    assert.equal(rerun.skipped[0]?.reason, 'already in the review queue')

    // A repo already backing a mirror author is never re-proposed.
    await prisma.authors.create({
      data: { id: 'liveco', name: 'liveco', is_mirror: 1, mirror_source_url: 'https://github.com/liveco/skills' },
    })
    const live = await discoverMirrorCandidates({
      prisma, repos: ['liveco/skills'], denylist: new Map(), fetchImpl,
    })
    assert.equal(live.skipped[0]?.reason, 'already live')
  })

  // ---------------------------------------------------------------- U6

  it('in-flight unique index rejects duplicates; decided rows do not collide', async () => {
    await reset()
    const mk = (status: string) => ({
      id: newId(), source_repo: 'x/skills', normalized_repo_key: 'x/skills',
      derived_handle: 'x', license: 'MIT', status, submitted_by: 'discovery',
    })
    await prisma.mirror_review_queue.create({ data: mk('pending_review') })
    await assert.rejects(() => prisma.mirror_review_queue.create({ data: mk('submitted') }))
    // Decided rows generate NULL and never collide.
    await prisma.mirror_review_queue.create({ data: mk('rejected_screen') })
    await prisma.mirror_review_queue.create({ data: mk('rejected_screen') })
    assert.equal(await prisma.mirror_review_queue.count(), 3)
  })
})
