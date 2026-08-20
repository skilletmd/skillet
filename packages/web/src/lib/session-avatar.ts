// What avatar value is allowed to ride in the Auth.js session token (JWT).
//
// The JWT lives in the session cookie. An inline `data:` avatar (the legacy
// base64 path) is up to ~512KB; Auth.js chunks an oversized token across cookies
// that blow past the 16KB HTTP header limit and 431 the request. So only a URL or
// site-relative path may enter the token — a `data:` value is dropped, and the
// user falls back to their generated default until the avatar is re-uploaded or
// migrated to R2.

/** A hosted avatar reference (URL or path) is short; this caps what may ride in
 *  the token so a long non-data: value can't bloat the cookie either. */
export const MAX_JWT_PICTURE_LEN = 2048

/** True for a legacy inline `data:` avatar — never allowed in the JWT. Matches
 *  case-insensitively and after trimming, since `Data:` / ` data:` are still a
 *  valid data URI to the browser. */
export function isDataUrl(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('data:')
}

/** Return a token-safe avatar (URL or path), or undefined for `data:`/empty/
 *  over-long/non-string. */
export function jwtSafePicture(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (!v || isDataUrl(v) || v.length > MAX_JWT_PICTURE_LEN) return undefined
  return v
}
