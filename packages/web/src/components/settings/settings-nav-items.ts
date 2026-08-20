// Plain data (no 'use client') so both the client SettingsNav rail and the
// server account-dashboard-shell can import the real array. Exporting it from a
// 'use client' module would hand the server a client-reference proxy, not the
// array — and `.map` would throw.
export const SETTINGS_NAV_ITEMS = [
  { href: '/settings', label: 'Account', exact: true },
  { href: '/settings/github', label: 'GitHub' },
  { href: '/settings/teams', label: 'Teams' },
]
