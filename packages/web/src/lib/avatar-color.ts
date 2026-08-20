/**
 * Deterministic identicon color for a handle/name, so the same person gets the
 * same hue everywhere (feed, profile, people lists, OG images). One palette,
 * one hash — the single source of truth that the avatar surfaces all share so
 * they can't drift apart (the "feed is colored, profile isn't" bug).
 */
export const AVATAR_BG = ['#e8643a', '#2f7d4f', '#3b6fd4', '#9b59b6', '#c9952b', '#1f9aa8'] as const

export function avatarColor(handle: string): string {
  let h = 0
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0
  return AVATAR_BG[h % AVATAR_BG.length]
}

export function avatarInitials(name: string): string {
  return name.replace(/^@/, '').slice(0, 2).toUpperCase() || '?'
}

/**
 * Soft tinted backing behind the illustrated default avatars. The line art is
 * pure black, so this stays LIGHT in both themes (it'd vanish on a dark circle).
 * The hue spans the full wheel and is derived per person, echoing the skill/kit
 * gradient marks so avatars read as the quiet, pastel cousins of
 * the vivid tool tiles — one color language. Rendered as a gentle radial glow
 * (top-left light source, consistent across the set) for a touch of dimension.
 */
function tintHue(handle: string): number {
  let h = 2166136261
  for (let i = 0; i < handle.length; i++) h = ((h ^ handle.charCodeAt(i)) * 16777619) >>> 0
  return h % 360
}

function gradientForHue(hue: number): string {
  return `radial-gradient(120% 120% at 30% 26%, hsl(${hue} 64% 94%), hsl(${hue} 52% 83%))`
}

/** CSS background: a soft pastel radial glow keyed to a person's stable hue. */
export function avatarTintGradient(handle: string): string {
  return gradientForHue(tintHue(handle))
}

/** Same glow for an explicitly chosen hue (the shade picker). */
export function avatarTintGradientForHue(hue: number): string {
  return gradientForHue(((hue % 360) + 360) % 360)
}

/** A person's stable auto hue — for seeding the shade picker. */
export function avatarHue(handle: string): number {
  return tintHue(handle)
}

/** Solid mid-pastel fallback (non-CSS-gradient contexts). */
export function avatarTint(handle: string): string {
  return `hsl(${tintHue(handle)} 56% 88%)`
}

/** Preset shades for the picker — evenly spaced around the wheel. */
export const AVATAR_TINT_HUES = [25, 70, 110, 150, 190, 220, 265, 300, 335] as const

/** Encode a chosen shade onto a default-avatar URL: `…/face-12.svg?h=210`. */
export function withAvatarHue(url: string, hue: number): string {
  return `${url.split('?')[0]}?h=${((hue % 360) + 360) % 360}`
}

/** Read a chosen shade off a default-avatar URL, or null if none. */
export function readAvatarHue(src?: string | null): number | null {
  const m = /[?&]h=(\d+)/.exec(src ?? '')
  return m ? Number(m[1]) % 360 : null
}

export type AvatarKind = 'person' | 'team'

export interface ResolvedAvatar {
  /** Uploaded photo/logo to cover-fit, or null. */
  photo: string | null
  /** Illustrated default face (person only), or null for teams. */
  faceUrl: string | null
  /** Soft tint gradient backing. */
  background: string
  /** True for org/team identities (rounded-square + monogram, never a face). */
  isTeam: boolean
}

/**
 * THE avatar decision — every surface (the shared {@link Avatar} component and
 * the few bespoke renderers it can't cover: card covers, satori OG) routes
 * through this so person-vs-team and photo-vs-default-vs-tint can never diverge.
 * People get an illustrated `faceUrl`; teams get `faceUrl: null` (render the
 * monogram instead). `key` is the immutable handle; `kind` defaults to person.
 */
export function resolveAvatar(
  avatarUrl: string | null | undefined,
  key: string,
  kind: AvatarKind = 'person',
): ResolvedAvatar {
  const isTeam = kind === 'team'
  const photo = avatarUrl && !isDefaultAvatar(avatarUrl) ? avatarUrl : null
  const hue = readAvatarHue(avatarUrl)
  const background = hue != null ? avatarTintGradientForHue(hue) : avatarTintGradient(key)
  const faceUrl = isTeam
    ? null
    : avatarUrl && isDefaultAvatar(avatarUrl)
      ? avatarUrl
      : defaultAvatarUrl(key)
  return { photo, faceUrl, background, isTeam }
}

/**
 * Illustrated default avatars (hand-drawn line-art faces) live in
 * `public/avatars/default/face-01.svg` … `face-NN.svg`. We assign one per person
 * deterministically from their handle — effectively random, but stable so the
 * same person keeps one face everywhere until they pick another.
 */
export const DEFAULT_AVATAR_PREFIX = '/avatars/default/'

// Count of face-01..NN.svg in public/avatars/default/ — contiguous. Bump this
// when adding/removing faces (and renumber the files to stay contiguous).
export const DEFAULT_AVATAR_COUNT = 41

function faceUrl(n: number): string {
  return `${DEFAULT_AVATAR_PREFIX}face-${String(n).padStart(2, '0')}.svg`
}

function faceHash(key: string): number {
  // djb2 — distinct from avatarColor's hash so face and tint vary independently.
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0
  return h
}

export function defaultAvatarUrl(key: string): string {
  return faceUrl((faceHash(key) % DEFAULT_AVATAR_COUNT) + 1)
}

export function isDefaultAvatar(src?: string | null): boolean {
  return typeof src === 'string' && src.startsWith(DEFAULT_AVATAR_PREFIX)
}

/** All default-avatar URLs, in order — for the edit-profile picker. */
export function defaultAvatarUrls(): string[] {
  return Array.from({ length: DEFAULT_AVATAR_COUNT }, (_, i) => faceUrl(i + 1))
}
