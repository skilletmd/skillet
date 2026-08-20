import { renderOgImage } from './render'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

// This is a public, unauthenticated renderer; cap untrusted query inputs so a
// caller can't force oversized render work.
const MAX_STR = 200
const MAX_CATS = 20
const MAX_FACES = 10
const cap = (s: string | null | undefined) =>
  s == null ? undefined : s.slice(0, MAX_STR)

/** Parse + clamp untrusted OG query params into render args. Exported for tests. */
export function parseOgArgs(searchParams: URLSearchParams) {
  const cats = searchParams.get('cats')
  const faces = searchParams.get('faces')
  return {
    type: cap(searchParams.get('type')) ?? 'generic',
    eyebrow: cap(searchParams.get('eyebrow')),
    title: cap(searchParams.get('title')) ?? 'Skillet',
    subtitle: cap(searchParams.get('subtitle')),
    handle: cap(searchParams.get('handle')),
    stat: cap(searchParams.get('stat')),
    chip: cap(searchParams.get('chip')),
    team: searchParams.get('team') === '1',
    mark: cap(searchParams.get('mark')),
    cats: cats ? cats.split(',').slice(0, MAX_CATS).map((c) => (c ? c.slice(0, MAX_STR) : null)) : undefined,
    faces: faces ? faces.split(',').filter(Boolean).slice(0, MAX_FACES).map((f) => f.slice(0, MAX_STR)) : undefined,
  }
}

export async function GET(req: Request) {
  await markDynamicRoute()
  const { searchParams } = new URL(req.url)
  return renderOgImage(parseOgArgs(searchParams))
}
