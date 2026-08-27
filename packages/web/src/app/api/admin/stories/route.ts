import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getBlogDb } from '@/lib/blog-db'
import { STORY_TAG } from '@/lib/blog'
import { STORY_KINDS } from '@/lib/story-kind.mjs'

/**
 * Publish drafted Skillet Daily stories from a machine.
 *
 * The sweep runs where the keys and the GitHub token are (a laptop, a cron box);
 * the feed lives here. This is the seam between them. It exists instead of the
 * two alternatives, both of which are worse:
 *
 *   - SSH and write blog.db directly. It is a live SQLite file behind running
 *     Next workers, so a bad write is a corrupted feed with no audit trail and
 *     nothing to roll back to.
 *   - Session auth. A script has no browser, and minting a session for it is a
 *     longer-lived credential than a scoped token.
 *
 * Auth is a bearer token in SKILLET_STORY_PUBLISH_TOKEN. Unset means the route
 * is closed to everyone: a publish endpoint that defaults to open is the kind of
 * thing that stays open.
 *
 * Writes drafts by default. `?publish=1` goes straight to the feed, which is for
 * when the caller has already reviewed them.
 */

/** Constant-time compare over digests, so it is length-safe as well. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function authorize(req: Request): NextResponse | null {
  const expected = process.env.SKILLET_STORY_PUBLISH_TOKEN
  if (!expected) {
    return NextResponse.json({ error: 'publishing_not_configured' }, { status: 503 })
  }
  const header = req.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!presented || !tokenMatches(presented, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

interface StoryInput {
  slug: string
  headline: string
  summary: string
  kind: string
  publishedAt: string
  sources: unknown[]
  subject: unknown
}

/** Reject anything malformed rather than storing a half-story. A card with no
 *  body renders as a headline floating over its sources. */
function readStory(raw: unknown): { story: StoryInput } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not_an_object' }
  const r = raw as Record<string, unknown>
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '')
  const slug = str('slug')
  const headline = str('headline')
  const summary = str('summary')
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return { error: `bad_slug:${slug}` }
  if (!headline) return { error: `empty_headline:${slug}` }
  if (!summary) return { error: `empty_summary:${slug}` }
  const kind = str('kind')
  if (!STORY_KINDS.includes(kind)) return { error: `bad_kind:${slug}` }
  const publishedAt = str('publishedAt')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return { error: `bad_date:${slug}` }
  if (!Array.isArray(r.sources) || r.sources.length === 0) return { error: `no_sources:${slug}` }
  return {
    story: { slug, headline, summary, kind, publishedAt, sources: r.sources, subject: r.subject },
  }
}

export async function POST(req: Request) {
  const denied = authorize(req)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const list = Array.isArray(body) ? body : [body]
  if (list.length === 0 || list.length > 50) {
    return NextResponse.json({ error: 'expected_1_to_50_stories' }, { status: 400 })
  }

  // Validate everything before writing anything: a half-applied edition is
  // harder to reason about than a rejected one.
  const stories: StoryInput[] = []
  for (const raw of list) {
    const read = readStory(raw)
    if ('error' in read) return NextResponse.json({ error: read.error }, { status: 400 })
    stories.push(read.story)
  }

  // Two different stories can slugify the same, and the upsert would silently
  // overwrite one with the other: 11 sent, 10 stored, no error. Reject instead,
  // because a lost story looks exactly like a story that was never written.
  const seen = new Set<string>()
  for (const s of stories) {
    if (seen.has(s.slug)) {
      return NextResponse.json({ error: `duplicate_slug:${s.slug}` }, { status: 400 })
    }
    seen.add(s.slug)
  }

  const publish = new URL(req.url).searchParams.get('publish') === '1'
  const status = publish ? 'published' : 'draft'
  const db = getBlogDb()
  const stmt = db.prepare(`
    INSERT INTO posts (slug, title, description, author, published_at, updated_at,
                       tags_json, status, content, featured, sources_json, story_kind,
                       subject_json)
    VALUES (?, ?, ?, 'Skillet Daily', ?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title=excluded.title, description=excluded.description,
      updated_at=excluded.updated_at, content=excluded.content,
      sources_json=excluded.sources_json, story_kind=excluded.story_kind,
      subject_json=excluded.subject_json
  `)

  // Idempotent on slug, so re-running a sweep corrects a card instead of
  // duplicating it. Deliberately does NOT reset status: a story you already
  // took down stays down when the same slug is sent again.
  const written: string[] = []
  for (const s of stories) {
    stmt.run(
      s.slug,
      s.headline,
      s.summary,
      s.publishedAt,
      s.publishedAt,
      JSON.stringify([STORY_TAG]),
      status,
      s.summary,
      JSON.stringify(s.sources),
      s.kind,
      s.subject ? JSON.stringify(s.subject) : null,
    )
    written.push(s.slug)
  }

  return NextResponse.json({ ok: true, status, count: written.length, slugs: written })
}
