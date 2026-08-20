import type { KitCardMenuProps } from '@/components/kits/kit-card-menu'
import { kitEditHref } from '@/lib/urls'

/**
 * The one rule for a kit card's corner action, shared by every surface so Add
 * vs Edit never drifts: the owner gets the edit pencil; everyone else (including
 * signed-out viewers, who are bounced to login on click) gets the +/✓ subscribe
 * coin.
 */
export function kitCardMenu(opts: {
  kitId: string
  owner: string
  /** When known, edit links to the owner-namespaced URL; otherwise the legacy
   *  `/settings/kits/{id}` route (which 307s to the same place). */
  slug?: string | null
  viewerHandle: string | null
  subscribed?: boolean
  /** Override the edit destination. */
  editHref?: string
}): KitCardMenuProps {
  const { kitId, owner, slug, viewerHandle, subscribed = false, editHref } = opts
  if (viewerHandle && viewerHandle === owner) {
    const fallback = slug ? kitEditHref(owner, slug) : `/settings/kits/${kitId}`
    return { kind: 'owned', editHref: editHref ?? fallback }
  }
  return { kind: 'kit', kitId, owner, subscribed }
}
