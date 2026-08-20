// Single source of truth for the app's custom DOM event names and the theme
// storage key. These `skillet:*` events coordinate cross-component UI without a
// shared store (e.g. adding a skill nudges the connect prompt; connecting a
// device clears the nav pill). Centralizing the names as consts means a typo
// can't silently no-op a listener or dispatch.

/** Custom `window` event names dispatched/listened across the web app. */
export const SKILLET_EVENTS = {
  /** A skill was added to the library — drives the connect prompt + welcome reveal. */
  skillAdded: 'skillet:skill-added',
  /** A device connected — lets the nav "Finish setup" pill clear without a reload. */
  deviceConnected: 'skillet:device-connected',
  /** The signed-in user's profile changed — refreshes the nav avatar. */
  profileUpdated: 'skillet:profile-updated',
  /** Request to open the "Connect an agent" dialog in place. */
  openConnect: 'skillet:open-connect',
  /** Reveal a scan finding in the file tree (path + line). */
  revealFinding: 'skillet:reveal-finding',
  /** A "used by" delta — adding/subscribing bumps the live count optimistically. */
  used: 'skillet:used',
} as const

/**
 * localStorage key holding the user's pinned theme ('light' | 'dark' | 'system').
 * NOTE: the FOUC theme script in `app/layout.tsx` runs before the JS bundle and
 * can't import this module — it interpolates this exported const into its inline
 * string at build time. This is the source of truth for that key.
 */
export const THEME_STORAGE_KEY = 'skillet-theme'
