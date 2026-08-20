import { metadata as rootMetadata } from '../page'

// The marketing homepage, reachable while signed in. The root `/` redirects
// authed users to /feed in middleware (src/proxy.ts), so this alias is the only
// way a logged-in user can see the landing page. Canonical points at `/` so
// search engines don't index the duplicate.
export const metadata = { ...rootMetadata, alternates: { canonical: '/' } }
export { default } from '../page'
