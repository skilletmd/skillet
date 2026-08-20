import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import Twitter from 'next-auth/providers/twitter'
import Credentials from 'next-auth/providers/credentials'
import {
  readAuthGithubCredentials,
  readAuthGoogleCredentials,
  readAuthTwitterCredentials,
} from '@/lib/oauth-env'
import { cookies } from 'next/headers'
import {
  identityFromAuthJs,
  linkRegistryIdentity,
  mintRegistryWebSession,
  fetchRegistryWhoami,
  fetchRegistryProfileBasics,
} from '@/lib/registry-session'
import { completeWebSignOut } from '@/lib/sign-out-cleanup'
import {
  SKILLET_SESSION_COOKIE,
  readSessionCookie,
  skilletSessionCookieOptions,
} from '@/lib/session-cookie'
import { isDataUrl, jwtSafePicture } from '@/lib/session-avatar'

declare module 'next-auth' {
  interface Session {
    handle?: string | null
    registryUserId?: string | null
    githubLinked?: boolean
    linkedProviders?: string[]
  }
  interface User {
    registryToken?: string
    handle?: string | null
  }
}

const googleOAuth = readAuthGoogleCredentials()
const githubOAuth = readAuthGithubCredentials()
const twitterOAuth = readAuthTwitterCredentials()

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...(googleOAuth
      ? [Google({ clientId: googleOAuth.id, clientSecret: googleOAuth.secret })]
      : []),
    ...(githubOAuth
      ? [GitHub({ clientId: githubOAuth.id, clientSecret: githubOAuth.secret })]
      : []),
    ...(twitterOAuth
      ? [Twitter({ clientId: twitterOAuth.id, clientSecret: twitterOAuth.secret })]
      : []),
    Credentials({
      id: 'registry',
      name: 'Email',
      credentials: {
        sessionToken: { type: 'text' },
      },
      authorize: async (credentials) => {
        const sessionToken =
          typeof credentials?.sessionToken === 'string' ? credentials.sessionToken.trim() : ''
        if (!sessionToken) return null

        const whoami = await fetchRegistryWhoami(sessionToken)
        if (!whoami) return null

        // No display name known at this point — leave name unset when there's no
        // handle yet (never a generic "Skillet member"); readers fall back to the
        // handle, and the profile seed below fills the real name once one exists.
        return {
          id: whoami.user_id,
          name: whoami.handle ? `@${whoami.handle}` : null,
          email: whoami.email ?? undefined,
          registryToken: sessionToken,
          handle: whoami.handle,
        }
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === 'registry') return true
      if (!account) return false
      if (identityFromAuthJs(account, profile) == null) return false
      // GitHub and X are link-only: they may attach to an account you are
      // already signed into, but must never create or sign in to one. The login
      // buttons are gone from /login, but the NextAuth provider endpoints
      // (/api/auth/signin/{github,twitter}) stay live to serve the /settings
      // "Connect" flow — so enforce the policy here, server-side, rather than
      // trusting the UI. Fail closed: no live session cookie -> reject. This is
      // also what keeps the registry's verified-email auto-link out of reach for
      // providers whose IdP email isn't per-address proof of control.
      if (account.provider === 'github' || account.provider === 'twitter') {
        const jar = await cookies()
        const sessionToken = readSessionCookie(jar)
        if (!sessionToken) return false
        // Presence of a cookie is not enough — verify the registry session is
        // still LIVE. A dead/revoked cookie must not let a link-only provider
        // proceed.
        const who = await fetchRegistryWhoami(sessionToken)
        if (!who) return false
      }
      return true
    },
    async jwt({ token, account, profile, user, trigger, session }) {
      // After a web claim (or any client-side identity change), the
      // client calls update() to re-pull the registry handle into the JWT so
      // session.handle reflects the new username without re-signing-in.
      if (trigger === 'update' && typeof token.skilletSessionToken === 'string') {
        const who = await fetchRegistryWhoami(token.skilletSessionToken)
        if (who) {
          token.handle = who.handle
          token.email = who.email ?? token.email
        }
      }
      // A profile save (edit-display-name) calls update({ name, image }) so the new
      // display name / avatar persist in the token and reach every session reader
      // without a re-login. The client already has the saved values, so trust them
      // here rather than re-fetching.
      if (trigger === 'update' && session && typeof session === 'object') {
        const next = session as { name?: unknown; image?: unknown }
        if (typeof next.name === 'string') token.name = next.name
        if ('image' in next) token.picture = jwtSafePicture(next.image)
      }
      if (
        account &&
        (account.provider === 'github' ||
          account.provider === 'google' ||
          account.provider === 'twitter')
      ) {
        const identity = identityFromAuthJs(account, profile)
        if (identity) {
          // Fill-only: the IdP name/avatar are a first-paint fallback, never an
          // overwrite — connecting a provider must not replace a display name or
          // avatar the user chose. The profile seed below re-pulls the registry's
          // merged profile (the source of truth) whenever a handle exists.
          if (identity.displayName && !token.name) token.name = identity.displayName
          if (identity.avatarUrl && !token.picture) {
            token.picture = jwtSafePicture(identity.avatarUrl)
          }

          // Capture the GitHub sign-in access token (read-only, NextAuth default
          // scope) so the registry can store it and reuse it for repo connect —
          // a GitHub-sign-in user then needs no second GitHub grant. It rides
          // only on the signed server→registry call below; it is NEVER written to
          // the JWT/session, so it never reaches the browser.
          const identityWithToken = {
            ...identity,
            providerToken:
              account.provider === 'github' && typeof account.access_token === 'string'
                ? account.access_token
                : null,
          }

          // The BFF self-heal key (provider + subject) plus the registry user_id
          // it resolves to. Persisted ONLY after the identity is proven linked or
          // minted for a specific user — never before — so a failed/contested link
          // cannot leave an unverified identity in the JWT that later refreshes a
          // session for the wrong account. Stays in the
          // encrypted, httpOnly next-auth JWT — never sent to the browser.
          const setVerifiedIdentity = (userId: string) => {
            token.registryIdentity = {
              provider: identity.provider,
              providerSubjectId: identity.providerSubjectId,
            }
            token.registryUserId = userId
          }
          const clearVerifiedIdentity = () => {
            delete token.registryIdentity
            delete token.registryUserId
          }

          const jar = await cookies()
          const existingSession =
            readSessionCookie(jar) ??
            (typeof token.skilletSessionToken === 'string' ? token.skilletSessionToken : undefined)

          if (existingSession) {
            try {
              const linked = await linkRegistryIdentity(existingSession, identityWithToken)
              token.skilletSessionToken = existingSession
              token.handle = linked.handle
              token.email = linked.email ?? token.email
              token.githubLinked = linked.github_linked
              token.linkedProviders = linked.linked_providers
              setVerifiedIdentity(linked.user_id)
              // A connect flow mints a fresh JWT pre-seeded with the IdP's
              // name/picture. Re-seed from the registry so the session shows the
              // user's own profile (custom values preserved, blanks now filled
              // from the IdP), not whatever Google/GitHub sent.
              token.profileSeeded = false
            } catch {
              // Link failed/contested: keep the current session but do NOT leave an
              // unverified identity behind for the refresh path to trust.
              token.skilletSessionToken = existingSession
              clearVerifiedIdentity()
            }
          } else {
            const minted = await mintRegistryWebSession(identityWithToken)
            token.skilletSessionToken = minted.session_token
            token.handle = minted.handle
            token.email = minted.email ?? token.email
            token.githubLinked = minted.github_linked
            token.linkedProviders = minted.linked_providers
            setVerifiedIdentity(minted.user_id)

            jar.set(SKILLET_SESSION_COOKIE, minted.session_token, skilletSessionCookieOptions)
          }
        }
      } else if (user?.registryToken) {
        token.skilletSessionToken = user.registryToken
        token.handle = user.handle ?? null
        token.email = user.email ?? token.email
        token.githubLinked = false
        token.linkedProviders = ['email']
        token.sub = user.id

        const jar = await cookies()
        jar.set(SKILLET_SESSION_COOKIE, user.registryToken, skilletSessionCookieOptions)
      }

      // Seed the token with the viewer's Skillet display name + avatar so the feed
      // rail, the top-right nav, and anywhere else that reads the session render the
      // real identity at first paint — no client fetch, no flash. Runs once per
      // session (profileSeeded guard), which also backfills already-signed-in users
      // on their next request. Profile edits keep it fresh via the update() branch
      // above; the generated default avatar is represented as no picture (null).
      if (typeof token.handle === 'string' && token.profileSeeded !== true) {
        const basics = await fetchRegistryProfileBasics(token.handle)
        if (basics) {
          if (basics.name) token.name = basics.name
          token.picture = jwtSafePicture(basics.avatarUrl)
          token.profileSeeded = true
        }
      }

      // Self-heal: an older token (seeded before this guard existed) may still
      // carry a `data:` avatar inline — the root cause of the oversized session
      // cookie / HTTP 431. Strip it on every pass so already-signed-in users
      // recover on their next request without a re-login.
      if (isDataUrl(token.picture)) {
        token.picture = undefined
      }
      return token
    },
    async session({ session, token }) {
      session.handle = typeof token.handle === 'string' ? token.handle : null
      session.registryUserId =
        typeof token.registryUserId === 'string' ? token.registryUserId : null
      if (session.user) {
        if (typeof token.email === 'string') {
          session.user.email = token.email
        }
        if (typeof token.name === 'string') {
          session.user.name = token.name
        }
        // Reflect the picture either way: a string is the chosen/uploaded avatar; a
        // missing one means the generated default, so clear it (don't leave a stale
        // OAuth photo) and let the Avatar fall back to the default face.
        session.user.image = typeof token.picture === 'string' ? token.picture : null
      }
      // Self-heal stale handles. The JWT in our cookie is signed at sign-in
      // (or via update()), so any state that changes server-side AFTER sign-in
      // — most importantly a fresh handle claim from /settings — won't reach
      // the session until the cookie is re-encoded. update() doesn't always
      // re-run the jwt() callback (next-auth v5 may serve it via a GET that
      // skips trigger='update'), which leaves the user stuck on the
      // ChooseUsername form even though the registry has accepted their
      // claim. Whenever the JWT looks "almost signed in" (no handle yet but
      // we have a registry session token) we ask whoami; this fetch is gated
      // by getSession's per-request React cache so it runs at most once.
      if (
        typeof token.skilletSessionToken === 'string' &&
        (session.handle == null || (session.user && !session.user.email))
      ) {
        const who = await fetchRegistryWhoami(token.skilletSessionToken)
        if (who?.handle) session.handle = who.handle
        if (session.user && who?.email && !session.user.email) {
          session.user.email = who.email
        }
      }
      session.githubLinked = token.githubLinked === true
      session.linkedProviders = Array.isArray(token.linkedProviders)
        ? (token.linkedProviders as string[])
        : []
      return session
    },
  },
  events: {
    async signOut(message) {
      const jar = await cookies()
      const jwtToken =
        'token' in message && message.token && typeof message.token.skilletSessionToken === 'string'
          ? message.token.skilletSessionToken
          : undefined
      await completeWebSignOut(jar, jwtToken)
    },
  },
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
})
