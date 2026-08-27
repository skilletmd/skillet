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
  /** True when a permission Skillet needs is missing, denied, or ungranted.
   *  Settings is the only place that state is visible, so the path to it has
   *  to advertise itself. */
  permissionsNeedAttention?: boolean
}

export interface RailBadges {
  home: boolean
  account: boolean
}

export function resolveRailBadges({
  pendingCount,
  updateReady,
  permissionsNeedAttention = false,
}: RailBadgeInput): RailBadges {
  return {
    home: pendingCount > 0,
    account: updateReady || permissionsNeedAttention,
  }
}
