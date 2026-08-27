import { writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { requirePublishToken } from '@/lib/publish-auth'

/**
 * Receive the day's collected signal.
 *
 * Stories were the only half of the brief that reached production, so the raw
 * posts under them went stale the moment the committed seed was written: a
 * skill announced with `npx skills add owner/name` still read "not in the
 * registry" here, because that collection predated the resolver learning to
 * read an install line. The sweep now ships its collection too.
 *
 * Written to content/news-signal.json, gitignored like blog.db, which is what
 * it always was: runtime state. The reader picks it up on mtime, so an upload
 * lands without bouncing a worker.
 */

/** Enough of a shape check that a truncated upload cannot blank the page. */
function readItems(raw: unknown): { items: unknown[] } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not_an_object' }
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.items)) return { error: 'items_not_an_array' }
  if (r.items.length === 0) return { error: 'no_items' }
  const bad = r.items.findIndex(
    (i) => !i || typeof i !== 'object' || typeof (i as { text?: unknown }).text !== 'string',
  )
  if (bad >= 0) return { error: `item_${bad}_has_no_text` }
  return { items: r.items }
}

export async function POST(req: Request) {
  const denied = requirePublishToken(req)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const read = readItems(body)
  if ('error' in read) return NextResponse.json({ error: read.error }, { status: 400 })

  const dir = path.join(process.cwd(), 'content')
  const dest = path.join(dir, 'news-signal.json')
  try {
    mkdirSync(dir, { recursive: true })
    // Write then rename: a reader must never see a half-written file, and the
    // reader here is a live request on every feed render.
    const tmp = `${dest}.tmp`
    writeFileSync(tmp, JSON.stringify(body), 'utf8')
    renameSync(tmp, dest)
  } catch (err) {
    return NextResponse.json(
      { error: 'write_failed', detail: (err as Error).message },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true, items: read.items.length })
}
