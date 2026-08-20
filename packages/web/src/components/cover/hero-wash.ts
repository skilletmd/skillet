/**
 * Deterministic hero tinting for detail pages — no storage, no AI.
 *
 * Kit/skill COVERS moved to the shared engine (`@skillet/protocol/covers`);
 * what remains here is the hue hash and the soft top-of-page hero wash that
 * tints detail pages in a skill's signature color.
 */

// FNV-1a — small, fast, deterministic. Exported so the mesh cover derives the
// same per-skill hue everywhere (a kit's mesh = the blend of its skills' hues).
export function hashRef(ref: string): number {
  let h = 2166136261
  for (let i = 0; i < ref.length; i++) {
    h ^= ref.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A soft top-of-page wash in a skill's signature hue — for tinting detail-page
 *  heroes, Spotify album-page style. Fades to transparent so it melts into the
 *  page background. Same hash hue as the mark, so hero and cover always match.
 *  Pass a low `sat` for an uncategorized skill so the wash reads neutral, matching
 *  the engine's neutral cover ground instead of tinting the page a fake hue. */
export function heroWash(ref: string, hueOverride?: number | null, sat = 52): string {
  const hue = hueOverride ?? hashRef(ref) % 360
  // Softer + lighter than the mark itself: a pastel wash so even acidic hues
  // (yellow-greens) read tasteful over the cream bg, not neon.
  return `linear-gradient(180deg, hsl(${hue} ${sat}% 64% / 0.22), hsl(${hue} ${sat}% 64% / 0) 72%)`
}
