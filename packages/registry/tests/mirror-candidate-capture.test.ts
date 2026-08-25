// Capturing what a mirror candidate actually contains, at screen time.
//
// The queue said "84/100 across 24 skills" and every decision still started by
// opening GitHub, because a count is not a description. The names were already
// being read and thrown away. These pin the two rules that make the capture
// worth having: it lists EVERY skill (the rubric's 5-skill sample bounds what
// gets scored, not what gets listed), and it never silently drops one.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { newId } from '../src/db/index.js'
import {
  captureCandidateSkills,
  writeCandidateSkills,
} from '../src/lib/mirror-candidate-context.js'
import { ensureMysqlMigrated, freshMysqlPrisma, mysqlTestsEnabled } from './mysql-test-env.js'

/** A fetch that serves SKILL.md bodies keyed by directory. */
function repoFetch(files: Record<string, string | null>): typeof fetch {
  return (async (url: string | URL) => {
    const href = String(url)
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(href)
    const path = m ? decodeURIComponent(m[1]!) : ''
    const dir = path === 'SKILL.md' ? '' : path.replace(/\/SKILL\.md$/, '')
    const body = files[dir]
    if (body == null) return new Response('not found', { status: 404 })
    return new Response(body, { status: 200 })
  }) as unknown as typeof fetch
}

function skillMd(name: string, description?: string): string {
  return [
    '---',
    `name: ${name}`,
    ...(description ? [`description: ${description}`] : []),
    '---',
    '',
    '# Body',
  ].join('\n')
}

describe('capturing a candidate repo', () => {
  it('captures one row per skill, with name and description', async () => {
    const files = {
      'skills/a': skillMd('alpha', 'Reviews pull requests'),
      'skills/b': skillMd('beta', 'Writes release notes'),
      'skills/c': skillMd('gamma', 'Deploys to staging'),
    }
    const got = await captureCandidateSkills({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      dirs: Object.keys(files),
      fetchImpl: repoFetch(files),
    })
    assert.ok(got)
    assert.equal(got.length, 3)
    assert.deepEqual(
      got.map((s) => s.name),
      ['alpha', 'beta', 'gamma'],
    )
    assert.equal(got[0]!.description, 'Reviews pull requests')
  })

  it('captures all 57 of a 57-skill repo, not the 5 the rubric sampled', async () => {
    // MAX_SKILL_SAMPLES bounds scoring. Listing 5 of 57 names would
    // misrepresent the candidate outright, which is the whole point of KTD2.
    const files: Record<string, string> = {}
    for (let i = 0; i < 57; i++) files[`skills/s${i}`] = skillMd(`skill-${i}`, `Does thing ${i}`)
    const got = await captureCandidateSkills({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      dirs: Object.keys(files),
      fetchImpl: repoFetch(files),
    })
    assert.ok(got)
    assert.equal(got.length, 57)
    assert.equal(new Set(got.map((s) => s.slug)).size, 57)
  })

  it('captures a skill with no description rather than skipping it', async () => {
    const files = { 'skills/a': skillMd('alpha') }
    const got = await captureCandidateSkills({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      dirs: ['skills/a'],
      fetchImpl: repoFetch(files),
    })
    assert.ok(got)
    assert.equal(got.length, 1)
    assert.equal(got[0]!.name, 'alpha')
    assert.equal(got[0]!.description, null)
  })

  it('captures an unparseable skill by slug rather than dropping it silently', async () => {
    const files = { 'skills/a': skillMd('alpha', 'Real one'), 'skills/b': 'no frontmatter here' }
    const got = await captureCandidateSkills({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      dirs: ['skills/a', 'skills/b'],
      fetchImpl: repoFetch(files),
    })
    assert.ok(got)
    assert.equal(got.length, 2)
    assert.equal(got[1]!.slug, 'skills/b')
    assert.equal(got[1]!.name, null)
    assert.equal(got[1]!.description, null)
  })

  it('keeps a partial read: one unreachable skill does not lose the other 2', async () => {
    const got = await captureCandidateSkills({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      dirs: ['skills/a', 'skills/gone', 'skills/c'],
      fetchImpl: repoFetch({
        'skills/a': skillMd('alpha', 'One'),
        'skills/gone': null,
        'skills/c': skillMd('gamma', 'Three'),
      }),
    })
    assert.ok(got)
    assert.equal(got.length, 3)
    assert.equal(got[1]!.name, null)
  })

  it('reports nothing-readable as a failed capture, not as 57 nameless skills', async () => {
    // A repo full of nameless rows is noise wearing context's shape. The caller
    // leaves skills_captured_at null so the queue can say "not captured".
    const got = await captureCandidateSkills({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      dirs: ['skills/a', 'skills/b'],
      fetchImpl: repoFetch({}),
    })
    assert.equal(got, null)
  })

  it('handles a single-skill repo whose SKILL.md is at the root', async () => {
    const got = await captureCandidateSkills({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      dirs: [''],
      fetchImpl: repoFetch({ '': skillMd('solo', 'The only one') }),
    })
    assert.ok(got)
    assert.equal(got.length, 1)
    assert.equal(got[0]!.slug, '')
    assert.equal(got[0]!.name, 'solo')
  })
})

describe('storing captured context', { skip: !mysqlTestsEnabled() }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  async function queueRow(): Promise<string> {
    const id = newId()
    await prisma.mirror_review_queue.create({
      data: {
        id,
        source_repo: `o/r-${id}`,
        normalized_repo_key: `o/r-${id}`,
        status: 'pending_review',
      },
    })
    return id
  }

  it('reads back a row with no captured context as nulls, not an error', async () => {
    // All 64 rows that predate this table are in exactly this state.
    const id = await queueRow()
    const row = await prisma.mirror_review_queue.findUnique({ where: { id } })
    assert.ok(row)
    assert.equal(row.skills_captured_at, null)
    assert.equal(row.category_summary, null)
    const skills = await prisma.mirror_candidate_skills.findMany({ where: { queue_id: id } })
    assert.equal(skills.length, 0)
  })

  it('writes one row per skill and stamps the queue row', async () => {
    const id = await queueRow()
    await writeCandidateSkills(prisma, id, [
      { slug: 'skills/a', name: 'alpha', description: 'One' },
      { slug: 'skills/b', name: 'beta', description: null },
    ])
    const skills = await prisma.mirror_candidate_skills.findMany({
      where: { queue_id: id },
      orderBy: { slug: 'asc' },
    })
    assert.equal(skills.length, 2)
    assert.equal(skills[0]!.name, 'alpha')
    assert.equal(skills[1]!.description, null)
    const row = await prisma.mirror_review_queue.findUnique({ where: { id } })
    assert.ok(row?.skills_captured_at)
  })

  it('replaces on re-screen rather than accumulating duplicates', async () => {
    const id = await queueRow()
    await writeCandidateSkills(prisma, id, [
      { slug: 'skills/a', name: 'alpha', description: 'One' },
      { slug: 'skills/old', name: 'gone', description: 'Deleted upstream' },
    ])
    await writeCandidateSkills(prisma, id, [
      { slug: 'skills/a', name: 'alpha v2', description: 'One, renamed' },
    ])
    const skills = await prisma.mirror_candidate_skills.findMany({ where: { queue_id: id } })
    assert.equal(skills.length, 1)
    assert.equal(skills[0]!.name, 'alpha v2')
  })

  it('drops captured skills when the queue row is deleted', async () => {
    const id = await queueRow()
    await writeCandidateSkills(prisma, id, [{ slug: 'skills/a', name: 'alpha', description: 'One' }])
    await prisma.mirror_review_queue.delete({ where: { id } })
    const skills = await prisma.mirror_candidate_skills.findMany({ where: { queue_id: id } })
    assert.equal(skills.length, 0)
  })
})
