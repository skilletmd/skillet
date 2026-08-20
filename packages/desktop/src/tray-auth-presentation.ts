export type TrayAuthTier = 'unlinked' | 'linked'

export interface TrayAuthInput {
  bearer: { kind: string }
  identity: { handle: string | null } | null
  whoami: { handle: string | null; user_id?: string | null } | null
  /** Pair-claimed machine (session + device), true even when whoami is offline. */
  linked_machine?: boolean
}

export interface TrayAuthPresentation {
  tier: TrayAuthTier
  displayHandle: string | null
  showAccountKitGroups: boolean
  canSignOut: boolean
  /** Registry rejected this machine's device token — revoked on the web. */
  disconnected: boolean
}

export function resolveTrayAuthPresentation(
  auth: TrayAuthInput | null,
  opts: { disconnected?: boolean } = {},
): TrayAuthPresentation {
  const bearerKind = auth?.bearer?.kind ?? 'none'
  const whoami = auth?.whoami ?? null
  const identity = auth?.identity ?? null
  const displayHandle = whoami?.handle ?? identity?.handle ?? null

  // A confirmed server-side revocation defeats every local "linked" signal:
  // linked_machine is computed purely from local files that a web disconnect
  // never touches, so without this the tray would keep claiming "Signed in".
  const disconnected = Boolean(opts.disconnected)
  const registryLinked =
    !disconnected &&
    (bearerKind === 'session' || Boolean(whoami?.user_id) || Boolean(auth?.linked_machine))

  // There is no unpaired tier: a machine is either registry-linked or it gets
  // the sign-in gate. (The device-only path was removed with the pair-only
  // account model — credentials that don't resolve to an account are unlinked.)
  const tier: TrayAuthTier = registryLinked ? 'linked' : 'unlinked'

  const showAccountKitGroups = tier === 'linked'
  const canSignOut = bearerKind !== 'none'

  return {
    tier,
    displayHandle,
    showAccountKitGroups,
    canSignOut,
    disconnected,
  }
}

/**
 * True when this machine has no local credentials at all (never paired, or
 * signed out). Registry-bound background work is pointless in that state —
 * every call bounces off the CLI's auth_required guard.
 *
 * Deliberately NOT the same signal as the sticky `disconnected` flag: a
 * revoked machine still HAS a bearer, and its tray-open check must keep
 * running so a stale disconnected flag can clear itself on the next
 * successful check (see checkSyncAction.clearDisconnected).
 */
export function isUnpairedAuth(
  auth: { bearer?: { kind?: string | null } | null } | null | undefined,
): boolean {
  return !auth || (auth.bearer?.kind ?? 'none') === 'none'
}
