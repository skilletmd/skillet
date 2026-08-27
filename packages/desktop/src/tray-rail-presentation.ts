// Rail badge state — the single source of truth for which passive dots the tray
// rail shows. Two independent signals live on the rail:
//   - home:    pending skill updates from people you follow (the amber Home bell)
//   - account: something behind Settings needs the user. Either a desktop-app
//              update downloaded and waiting for a relaunch, or a permission
//              Skillet needs and does not have. Both live behind the avatar, so
//              both dot it: a blocked capability the user has to go and find is
//              a capability that stays blocked.
// Kept as a pure function so the "which dot shows when" rules are testable without
// standing up the whole tray render (main.ts has no exported render seam).

export interface RailBadgeInput {
  /** Number of pending skill updates awaiting consent (drives the Home bell). */
  pendingCount: number
  /** True when an app update is downloaded and waiting to install on relaunch. */
  updateReady: boolean
  /** True when a permission Skillet NEEDS is missing or denied. Optional
   *  capabilities do not count: badging someone because they never enabled a
   *  feature they may not want is nagging, not signal. */
  permissionsNeedAttention?: boolean
}

/** The account dot carries two meanings and they are not the same colour.
 *  'ready' is an app update waiting to install: go, green. 'attention' is a
 *  capability Skillet needs and does not have: amber, matching the Permissions
 *  row it leads to. null is no dot. Both tones are truthy so dot-or-no-dot
 *  checks read naturally. */
export type AccountBadge = null | 'ready' | 'attention'

export interface RailBadges {
  home: boolean
  account: AccountBadge
}

export function resolveRailBadges({
  pendingCount,
  updateReady,
  permissionsNeedAttention = false,
}: RailBadgeInput): RailBadges {
  return {
    home: pendingCount > 0,
    // Attention outranks ready when both are behind one dot: an update can
    // wait, a blocked capability cannot.
    account: permissionsNeedAttention ? 'attention' : updateReady ? 'ready' : null,
  }
}
