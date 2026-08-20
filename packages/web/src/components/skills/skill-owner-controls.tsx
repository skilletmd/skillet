import { getSession } from '@/lib/get-session'
import { listMyOrgs } from '@/lib/orgs-server'
import { viewerCanManageSkill, viewerCanPropose } from '@/lib/skill-access'
import { Button } from '@/components/ui/button'
import { skillEditHref, skillProposeHref } from '@/lib/urls'

/**
 * On the public skill page: whoever can manage the skill gets a link to the
 * manage page; anyone else who may propose gets the propose link; everyone else
 * sees nothing. Editing, reviews, deprecation, and the README badge all live on
 * the manage page — they don't belong on the public view.
 *
 * Rendered at the top of the sidebar rail, so the owner's Manage affordance sits
 * up with the object identity instead of buried below the content column.
 *
 * Both capability checks run on the SERVER. An earlier version probed the
 * proposals endpoint from a client component, so every not-allowed viewer got a
 * 403 logged as a red error in their browser console on every skill page. Doing
 * it here keeps the (expected) 403 server-side and invisible.
 */
export async function SkillOwnerControls({
  author,
  slug,
  placement = 'rail',
}: {
  author: string
  slug: string
  /** 'hero' renders only the inline Manage button beside the Add control; 'rail'
   *  renders only the Propose panel (with its explanation). Split this way so the
   *  owner's primary action sits in the action row while the quieter proposer
   *  affordance stays in the sidebar. */
  placement?: 'hero' | 'rail'
}) {
  const session = await getSession()
  // Logged out: no controls, and — importantly — no capability probe at all.
  if (!session?.handle) return null

  if (await viewerCanManageSkill(session.handle, author)) {
    // Manage lives in the hero action row (next to Add); nothing in the rail.
    // size="lg" matches the Add control (AddToKitButton uses lg) so they read as
    // one action row.
    if (placement !== 'hero') return null
    return (
      <Button href={skillEditHref(author, slug)} variant="secondary" size="lg">
        Manage skill
      </Button>
    )
  }

  // Propose is the rail affordance only.
  if (placement !== 'rail') return null

  if (await viewerCanPropose(author, slug)) {
    // A plain member of the owning team can propose but not manage. Tell them
    // why they have the affordance; everyone else gets the generic prompt.
    const orgs = await listMyOrgs()
    const onOwningTeam = orgs.kind === 'ok' && orgs.orgs.some((o) => o.slug === author)
    return (
      <div className="flex flex-col gap-2 pb-4">
        <Button href={skillProposeHref(author, slug)} variant="secondary" block>
          Propose a change
        </Button>
        <p className="text-sm leading-[1.5] text-(--ink-2)">
          {onOwningTeam
            ? 'You’re on this team. An owner reviews your change before it’s published.'
            : 'An owner reviews your change before it’s published.'}
        </p>
      </div>
    )
  }

  return null
}
