// Backfilling decision context onto the rows that predate it.
//
// Capture runs at screen time, so every row already in the queue when it
// shipped shows a score and a count and nothing else -- which is the state that
// made the queue hard to drain in the first place. A feature that only helps
// candidates arriving tomorrow does not help the 64 sitting there today.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { newId } from '../src/db/index.js'
import { backfillCandidateContext } from '../scripts/backfill-candidate-context.js'
import { ensureMysqlMigrated, freshMysqlPrisma, mysqlTestsEnabled } from './mysql-test-env.js'

/** Serves repo metadata, a tree, and SKILL.md bodies for one fake repo. */
function githubFetch(dirs: string[]): typeof fetch {
  return (async (url: string | URL) => {
    const href = String(url)
    if (href.includes('/git/trees/')) {
      return Response.json({
        tree: dirs.map((d) => ({ type: 'blob', path: d ? `${d}/SKILL.md` : 'SKILL.md' })),
      })
    }
    if (href.includes('raw.githubusercontent.com')) {
      const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(href)
      const path = m ? decodeURIComponent(m[1]!) : ''
      const dir = path === 'SKILL.md' ? '' : path.replace(/\/SKILL\.md$/, '')
      const name = dir.split('/').filter(Boolean).pop() ?? 'root'
      return new Response(
        `---\nname: ${name}\ndescription: Reviews pull requests for correctness\n---\n\n## Body\n`,
        { status: 200 },
      )
    }
    return Response.json({
      owner: { type: 'User' },
      stargazers_count: 12,
      created_at: '2025-01-01T00:00:00Z',
      pushed_at: '2026-08-01T00:00:00Z',
      default_branch: 'main',
    })
  }) as unknown as typeof fetch
}

describe('backfilling the pending queue', { skip: !mysqlTestsEnabled() }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  beforeEach(async () => {
    await prisma.mirror_candidate_skills.deleteMany({})
    await prisma.mirror_review_queue.deleteMany({})
  })

  async function row(overrides: Record<string, unknown> = {}): Promise<string> {
    const id = newId()
    await prisma.mirror_review_queue.create({
      data: {
        id,
        source_repo: `owner/repo-${id}`,
        normalized_repo_key: `owner/repo-${id}`,
        status: 'pending_review',
        ...overrides,
      },
    })
    return id
  }

  const run = (opts: Record<string, unknown> = {}) =>
    backfillCandidateContext(prisma, {
      fetchImpl: githubFetch(['skills/a', 'skills/b', 'skills/c']),
      ...opts,
    })

  it('captures names, categories, and overlap for an uncaptured row', async () => {
    const id = await row()
    const stats = await run()
    assert.equal(stats.captured, 1)
    const skills = await prisma.mirror_candidate_skills.findMany({ where: { queue_id: id } })
    assert.equal(skills.length, 3)
    assert.ok(skills.every((s) => s.name != null))
    assert.ok(skills.every((s) => s.category != null))
    const queue = await prisma.mirror_review_queue.findUnique({ where: { id } })
    assert.ok(queue?.skills_captured_at)
    assert.ok(queue.category_summary)
  })

  it('leaves an already-captured row alone', async () => {
    // Idempotent by default: re-running the pass must not re-fetch 64 repos.
    await row({ skills_captured_at: 1_700_000_000 })
    const stats = await run()
    assert.equal(stats.candidates, 0)
    assert.equal(stats.captured, 0)
  })

  it('re-captures an already-captured row under --all', async () => {
    const id = await row({ skills_captured_at: 1_700_000_000 })
    const stats = await run({ all: true })
    assert.equal(stats.captured, 1)
    const skills = await prisma.mirror_candidate_skills.findMany({ where: { queue_id: id } })
    assert.equal(skills.length, 3)
  })

  it('never touches a decided row', async () => {
    // The queue's job is the pending list. A live mirror already has its skills
    // in the catalog, and a rejected one is not coming back.
    await row({ status: 'live' })
    await row({ status: 'rejected' })
    const stats = await run()
    assert.equal(stats.candidates, 0)
  })

  it('writes nothing on a dry run', async () => {
    const id = await row()
    const stats = await run({ dryRun: true })
    assert.equal(stats.candidates, 1)
    assert.equal(stats.captured, 0)
    const queue = await prisma.mirror_review_queue.findUnique({ where: { id } })
    assert.equal(queue?.skills_captured_at, null)
  })

  it('keeps going when one repo is gone', async () => {
    // 64 rows queued over weeks; some of those repos have been deleted or
    // renamed since. One 404 must not end the pass.
    const gone = await row()
    const alive = await row()
    const goneRepo = (await prisma.mirror_review_queue.findUnique({ where: { id: gone } }))!
      .source_repo
    const stats = await backfillCandidateContext(prisma, {
      fetchImpl: (async (url: string | URL) => {
        if (String(url).includes(goneRepo)) return new Response('gone', { status: 404 })
        return githubFetch(['skills/a'])(url as string)
      }) as unknown as typeof fetch,
    })
    assert.equal(stats.candidates, 2)
    assert.equal(stats.captured, 1)
    assert.equal(stats.unreadable, 1)
    const kept = await prisma.mirror_candidate_skills.findMany({ where: { queue_id: alive } })
    assert.equal(kept.length, 1)
    // The unreadable row is still a reviewable row, just without names.
    const stillThere = await prisma.mirror_review_queue.findUnique({ where: { id: gone } })
    assert.equal(stillThere?.status, 'pending_review')
    assert.equal(stillThere?.skills_captured_at, null)
  })

  it('honors --limit so a first pass can be sized', async () => {
    await row()
    await row()
    await row()
    const stats = await run({ limit: 2 })
    assert.equal(stats.candidates, 2)
    assert.equal(stats.captured, 2)
  })
})
