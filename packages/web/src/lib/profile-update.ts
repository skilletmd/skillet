// Author profile update.
//
// PATCH /api/registry/v1/profiles/:author through the web proxy
// (which injects the session cookie). The registry authorizes owner-only:
// 401 if not signed in, 403 if the caller doesn't own :author. The
// client only ever PATCHes the signed-in user's own handle, but the server is
// the real gate.

import { registrySkillApi } from './registry-proxy'

/** Max display-name length the UI accepts before hitting the registry. */
export const MAX_DISPLAY_NAME = 80
export const MAX_PROFILE_BIO = 280
export const MAX_PROFILE_URL = 160

/**
 * Upload an avatar image. The raw file goes to the web BFF (`/api/profile/avatar`),
 * which re-encodes it to a small webp via sharp, stores it in the public R2 bucket,
 * and points the author's avatar_url at the returned URL. Resolves to that URL.
 * Throws an Error with a user-facing message on failure.
 */
export async function uploadAvatar(author: string, file: File): Promise<string> {
  const res = await fetch(`/api/profile/avatar?author=${encodeURIComponent(author)}`, {
    method: 'POST',
    credentials: 'include',
    // Let the browser set content-type from the File; the BFF reads the raw bytes.
    body: file,
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.status === 401) throw new Error('Please sign in again to update your avatar.')
    if (res.status === 403) throw new Error('You can only edit your own profile.')
    throw new Error(err.error ?? `Could not upload your avatar (${res.status}).`)
  }

  const { avatarUrl } = (await res.json()) as { avatarUrl: string }
  return avatarUrl
}

export interface ProfileUpdateInput {
  name: string
  bio?: string
  profileUrl?: string
  avatarUrl?: string
  /** Self-typed X (Twitter) handle (unverified). The registry normalizes it. */
  xHandle?: string
}

async function patchProfile(
  author: string,
  payload: {
    name?: string
    bio?: string | null
    profile_url?: string | null
    x_handle?: string | null
    avatar_url?: string | null
    agents_public?: boolean
    shown_agents?: string[] | null
  },
): Promise<void> {
  const res = await fetch(registrySkillApi(`profiles/${encodeURIComponent(author)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    if (res.status === 401) {
      throw new Error('Please sign in again to update your profile.')
    }
    if (res.status === 403) {
      throw new Error('You can only edit your own profile.')
    }
    if (res.status === 404) {
      throw new Error('Profile not found. Claim a username first.')
    }
    throw new Error(err.message ?? err.error ?? `Could not save profile (${res.status}).`)
  }
}

/** Validate a display name for inline UX. Returns an error string, or null when valid. */
export function validateDisplayName(raw: string): string | null {
  const name = raw.trim()
  if (!name) return 'Display name can’t be empty.'
  if (name.length > MAX_DISPLAY_NAME) {
    return `Display name can be at most ${MAX_DISPLAY_NAME} characters.`
  }
  return null
}

export function normalizeProfileUrl(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

export function validateProfileUpdate(input: ProfileUpdateInput): string | null {
  const invalid = validateDisplayName(input.name)
  if (invalid) return invalid
  if ((input.bio ?? '').trim().length > MAX_PROFILE_BIO) {
    return `Bio can be at most ${MAX_PROFILE_BIO} characters.`
  }
  const profileUrl = normalizeProfileUrl(input.profileUrl ?? '')
  if (profileUrl.length > MAX_PROFILE_URL) {
    return `URL can be at most ${MAX_PROFILE_URL} characters.`
  }
  if (profileUrl) {
    try {
      const url = new URL(profileUrl)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return 'URL must start with http:// or https://.'
      }
    } catch {
      return 'Enter a valid URL.'
    }
  }
  return null
}

/** Update the author's profile. Throws an Error with a user-facing message on failure. */
export async function updateProfile(author: string, input: ProfileUpdateInput): Promise<void> {
  const invalid = validateProfileUpdate(input)
  if (invalid) throw new Error(invalid)

  const payload = {
    name: input.name.trim(),
    bio: (input.bio ?? '').trim() || null,
    profile_url: normalizeProfileUrl(input.profileUrl ?? '') || null,
    x_handle: (input.xHandle ?? '').trim() || null,
    avatar_url: (input.avatarUrl ?? '').trim() || null,
  }

  await patchProfile(author, payload)
}

/** Toggle whether the author's detected runtimes ("Runs") show on their profile. */
export async function updateAgentsVisibility(author: string, isPublic: boolean): Promise<void> {
  await patchProfile(author, { agents_public: isPublic })
}

/** Set the curated list of agent keys shown on the author's profile. An explicit
 *  array curates exactly those keys (`[]` shows nothing); `null` resets to the
 *  uncurated legacy fallback. */
export async function updateShownAgents(
  author: string,
  agents: string[] | null,
): Promise<void> {
  await patchProfile(author, { shown_agents: agents })
}

/** Backward-compatible helper for older call sites/tests. */
export async function updateDisplayName(author: string, name: string): Promise<void> {
  const invalid = validateDisplayName(name)
  if (invalid) throw new Error(invalid)
  return patchProfile(author, { name: name.trim() })
}
