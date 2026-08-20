import { getSkill } from '@/lib/registry'
import { renderBadge, badgeResponse, compact, type BadgeStyle } from '@/lib/badge-svg'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

// The skill README badge: a flat or button SVG an author drops into a public repo.
// It links back to the skill page, so the badge is the growth loop's ad unit — it
// shows up in repos of people who weren't looking for Skillet. Self-contained: the
// value is derived from the path, so the markdown works pasted anywhere.

export async function GET(
  req: Request,
  { params }: { params: Promise<{ author: string; slug: string }> },
) {
  await markDynamicRoute()
  const { author, slug } = await params
  const style: BadgeStyle =
    new URL(req.url).searchParams.get('style') === 'button' ? 'button' : 'flat'

  // A private or missing skill never leaks — it falls back to a generic CTA.
  let installs = -1
  try {
    const skill = await getSkill(author, slug)
    if (skill && skill.visibility !== 'private') installs = skill.installCount
  } catch {
    // Registry hiccup → generic badge rather than a 500 in someone's README.
  }

  const message =
    style === 'button'
      ? 'Add this skill'
      : installs > 0
        ? `${compact(installs)} installs`
        : 'add skill'

  return badgeResponse(renderBadge({ style, message }))
}
