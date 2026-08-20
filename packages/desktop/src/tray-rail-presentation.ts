// Rail badge state — the single source of truth for which passive dots the tray
// rail shows. Two independent signals live on the rail:
//   - home:    pending skill updates from people you follow (the amber Home bell)
//   - account: a desktop-app update has been downloaded and is waiting for a
//              relaunch (the green dot on the account avatar, which opens Settings)
// Kept as a pure function so the "which dot shows when" rules are testable without
// standing up the whole tray render (main.ts has no exported render seam).

export interface RailBadgeInput {
  /** Number of pending skill updates awaiting consent (drives the Home bell). */
  pendingCount: number
  /** True when an app update is downloaded and waiting to install on relaunch. */
  updateReady: boolean
}

export interface RailBadges {
  home: boolean
  account: boolean
}

export function resolveRailBadges({ pendingCount, updateReady }: RailBadgeInput): RailBadges {
  return {
    home: pendingCount > 0,
    account: updateReady,
  }
}
