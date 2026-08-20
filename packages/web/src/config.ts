// Skillet install funnel — single source of truth for every external URL/label.

// Download + auto-update resolve through skillet.md (a domain we control), not
// GitHub's org/repo namespace — so a repo/org rename never touches shipped code;
// you repoint the redirect instead. skillet.md/download 302s to the newest signed
// installer built + published by .github/workflows/release.yml; the in-app updater
// reads skillet.md/desktop/latest.json (same origin as the appcast below).
export const SKILLET_RELEASES_URL = 'https://skillet.md/download'

// Download target for "↓ Download Skillet for Mac" (302 → latest .dmg).
export const SKILLET_DMG_URL = 'https://skillet.md/download/mac'

// Download target for "↓ Download Skillet for Windows" (302 → latest NSIS .exe / MSI).
export const SKILLET_WINDOWS_INSTALLER_URL = 'https://skillet.md/download/windows'

// Fine-print labels under the Mac CTA.
export const SKILLET_MIN_OS_LABEL = 'macOS 13 Ventura or later'
export const SKILLET_APP_SIZE_LABEL = '~12 MB · Free'

// Fine-print labels under the Windows CTA.
export const SKILLET_WINDOWS_MIN_OS_LABEL = 'Windows 10 or later'
export const SKILLET_WINDOWS_APP_SIZE_LABEL = '~15 MB · Free'

// Sparkle auto-update feed. Shares the skillet.md/install origin so download and
// update resolve on one domain. Empty = hide the "It updates itself." line and
// the auto-update messaging.
export const SKILLET_APPCAST_URL = 'https://skillet.md/install/appcast.xml'

// Demo continuity video. Empty string => the demo section omits itself entirely.
// Set once the demo asset exists.
export const SKILLET_DEMO_VIDEO_URL = ''

// Poster shown while the demo video loads (optional; empty => no poster attr).
export const SKILLET_DEMO_POSTER_URL = ''

// Canonical install URL — used for the mobile Web Share target and the QR code.
export const SKILLET_INSTALL_URL = 'https://skillet.md/install'

// Published CLI on npm — use for npx one-liners in UI copy (bin name is still `skillet`).
export const SKILLET_NPM_PACKAGE = 'skilletmd'
export const NPX_SKILLET_COMMAND = `npx ${SKILLET_NPM_PACKAGE}`
export const NPM_INSTALL_SKILLET_GLOBAL = `npm install -g ${SKILLET_NPM_PACKAGE}`
export const NPX_SKILLET_IMPORT = `${NPX_SKILLET_COMMAND} import`
