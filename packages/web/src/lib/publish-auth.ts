import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Bearer auth for the daily-brief publisher.
 *
 * The sweep runs off-box, where the API keys are; these routes are how the
 * finished edition gets here. Unset token means the routes are closed to
 * everyone, because a publish endpoint that defaults to open is the kind of
 * thing that stays open.
 */
export function requirePublishToken(req: Request): NextResponse | null {
  const expected = process.env.SKILLET_STORY_PUBLISH_TOKEN
  if (!expected) {
    return NextResponse.json({ error: 'publishing_not_configured' }, { status: 503 })
  }
  const header = req.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!presented) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Digest first, so the compare is length-safe as well as constant-time.
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}
