/** OAuth env helpers for Auth.js — prefer AUTH_*; legacy names still work. */

export function readAuthGithubCredentials(): { id: string; secret: string } | undefined {
  const id = process.env.AUTH_GITHUB_ID?.trim() || process.env.GITHUB_OAUTH_CLIENT_ID?.trim()
  const secret =
    process.env.AUTH_GITHUB_SECRET?.trim() || process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim()
  if (!id || !secret) return undefined
  return { id, secret }
}

export function readAuthGoogleCredentials(): { id: string; secret: string } | undefined {
  const id = process.env.AUTH_GOOGLE_ID?.trim()
  const secret = process.env.AUTH_GOOGLE_SECRET?.trim()
  if (!id || !secret) return undefined
  return { id, secret }
}

export function readAuthTwitterCredentials(): { id: string; secret: string } | undefined {
  const id = process.env.AUTH_TWITTER_ID?.trim()
  const secret = process.env.AUTH_TWITTER_SECRET?.trim()
  if (!id || !secret) return undefined
  return { id, secret }
}
