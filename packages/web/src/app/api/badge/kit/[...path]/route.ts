import { getKit, getKitByHandle } from '@/lib/kits-server'
import { renderBadge, badgeResponse, compact, type BadgeStyle } from '@/lib/badge-svg'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

// Kit README badge. Two URL forms share one catch-all route, since Next forbids
// sibling [kitId] and [author]/[slug] segments at the same position:
//   /api/badge/kit/<owner>/<slug>  — the clean URL we generate now
//   /api/badge/kit/<id>            — legacy, for badges already pasted in READMEs
// The badge links back to the kit page; the flat value shows kit usage.

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  await markDynamicRoute()
  const { path } = await params
  const style: BadgeStyle =
    new URL(req.url).searchParams.get('style') === 'button' ? 'button' : 'flat'

  let subs = -1
  try {
    const result =
      path.length >= 2 ? await getKitByHandle(path[0], path[1]) : await getKit(path[0] ?? '')
    if (result.kind === 'ok' && result.kit.visibility !== 'private') {
      subs = result.kit.subscriber_count ?? 0
    }
  } catch {
    // Registry hiccup → generic badge rather than a 500 in someone's README.
  }

  const message =
    style === 'button' ? 'Get this kit' : subs > 0 ? `used by ${compact(subs)}` : 'get kit'

  return badgeResponse(renderBadge({ style, message }))
}
