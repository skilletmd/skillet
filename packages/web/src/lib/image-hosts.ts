/**
 * The remote image hosts we let Next's optimizer fetch and re-encode.
 *
 * Avatar URLs come from the OAuth logins we support — GitHub
 * (avatars.githubusercontent.com), Google (lh3.googleusercontent.com), and
 * Twitter/X (pbs.twimg.com) — pulled from the provider profile at sign-in.
 * Users can't set an arbitrary avatar_url anymore, but we still don't want an
 * open image proxy, so the rule is:
 *   • Known provider host  → optimize via next/image (in this allowlist).
 *   • Anything else        → render the <Image> with `unoptimized`, which skips
 *     the optimizer (and the allowlist) and serves the src as-is, exactly like
 *     the old raw <img>. A safe fallback for any legacy/non-provider URL.
 *
 * `next.config.ts` builds `images.remotePatterns` from this same list, and the
 * Avatar/cover components gate `unoptimized` on {@link isOptimizableImageHost},
 * so the config and the runtime decision can never drift.
 */
export interface ImageRemotePattern {
  protocol: 'https'
  hostname: string
  pathname?: string
}

// Kept deliberately tight: only the exact avatar hosts our logins return. The
// optimizer's `/_next/image` endpoint is public and gated ONLY by these
// patterns, so a broad entry (e.g. raw.githubusercontent.com, or a wildcard
// **.googleusercontent.com that also covers Drive/Blogger) turns the single
// origin into an open image proxy — bandwidth/CPU amplification and image-bomb
// DoS. We do NOT allowlist raw.githubusercontent.com or gravatar (not avatar
// sources here); non-provider hosts render `unoptimized` and never touch the box.
const PROVIDER_IMAGE_REMOTE_PATTERNS: readonly ImageRemotePattern[] = [
  { protocol: 'https', hostname: 'avatars.githubusercontent.com' }, // GitHub OAuth
  { protocol: 'https', hostname: 'lh3.googleusercontent.com' }, // Google OAuth
  { protocol: 'https', hostname: 'pbs.twimg.com' }, // Twitter/X OAuth
  // Legacy github.com/<user>.png avatars only — not an open repo-file proxy.
  { protocol: 'https', hostname: 'github.com', pathname: '/*.png' },
]

/**
 * The deployment's own avatar-upload bucket, as a bare hostname (no scheme, no
 * path) — e.g. the R2 public host behind the registry's
 * `R2_AVATARS_PUBLIC_BASE_URL`. Per-deployment, so a fork's bucket is its own
 * and ours is not baked into the source. Unset (the default) simply means
 * uploaded avatars render `unoptimized`, which is the safe fallback.
 */
function avatarBucketHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_AVATAR_BUCKET_HOST?.trim()
  if (!raw) return null
  // Tolerate a full URL being pasted in; we only ever compare hostnames.
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
}

/** Provider hosts plus this deployment's avatar bucket, if one is configured. */
export function optimizableImageRemotePatterns(): ImageRemotePattern[] {
  const bucket = avatarBucketHost()
  return [
    ...PROVIDER_IMAGE_REMOTE_PATTERNS,
    ...(bucket ? [{ protocol: 'https' as const, hostname: bucket }] : []),
  ]
}

/**
 * True when Next's optimizer is allowed to process this URL. Returns false for
 * `data:` URLs, SVGs (the optimizer rejects them by default → a 400 broken
 * image; they pass through `unoptimized` instead), and any host outside the
 * allowlist. False → the caller renders `unoptimized`.
 */
export function isOptimizableImageHost(url: string | null | undefined): boolean {
  if (!url || url.trim().toLowerCase().startsWith('data:')) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // SVGs gain nothing from optimization and the optimizer 400s them unless
  // dangerouslyAllowSVG is on (an XSS vector we keep off) — pass them through.
  if (parsed.pathname.toLowerCase().endsWith('.svg')) return false
  if (parsed.hostname === 'github.com') {
    return /^\/[^/]+\.png$/i.test(parsed.pathname)
  }
  return optimizableImageRemotePatterns().some((p) => parsed.hostname === p.hostname)
}
