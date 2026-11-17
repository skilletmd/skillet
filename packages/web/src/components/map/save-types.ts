import type { KitMapSaveCounts } from '@skillet/protocol/kit-map'

/**
 * The wire between the save tab and its routes (kit map onboarding, KTD6):
 * what the map-session routes answer (app/api/map-sessions) and what the save
 * tab (./save-flow.tsx) and a dropped-folder Save (lib/map-drop-store.ts)
 * draw. Types only, so server code reads them without the client component.
 */

/** A skill Save didn't back up, by name, and why. Never a path on the computer. */
export interface NotBackedUp {
  name: string
  reason: string
  /** The file to clean: its name, or its path inside the skill when this browser read it. */
  file?: string
  /** The line a secret starts on, when the registry said. */
  line?: number
}

/** How Save went on the computer, as the terminal reported it. */
export interface MapSaveResult {
  result: 'applied' | 'partial' | 'failed'
  /** What it did. */
  counts: KitMapSaveCounts | null
  /** What's left for the next run or the app. */
  left: KitMapSaveCounts | null
  notBackedUp: NotBackedUp[]
}

/** A map session as the save tab reads it. */
export interface MapSaveSession {
  state: 'pending' | 'approved' | 'connected' | 'applied' | 'partial' | 'failed' | 'expired'
  /** Why it expired: never approved, or approved and the terminal never used its code. */
  reason: 'not-approved' | 'code-unused' | null
  /** The computer, as the terminal named it. */
  label: string
  /** Epoch seconds: when a session nobody approved expires. */
  expiresAt: number
  /** Epoch seconds, for the approving account only. */
  approvedAt: number | null
  /** The terminal picked up its connect code. */
  codeDelivered: boolean
  result: MapSaveResult | null
}

/** GET /api/map-sessions/:id/binding. */
export interface MapSaveStatus {
  /** The same-origin request token bind and approve echo back. */
  token: string
  /** This browser holds a live binding for the session. */
  bound: boolean
  /** What Save will do, from the map's proof: counts only. */
  counts: KitMapSaveCounts | null
  /** Null when this browser can't see the session: no binding, and not the account that approved it. */
  session: MapSaveSession | null
}
