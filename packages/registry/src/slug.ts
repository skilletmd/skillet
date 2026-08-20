import { slugify as canonicalSlugify } from '@skillet/protocol'

/**
 * Canonical slug for a kit name: lowercase, alphanumerics joined by single
 * dashes, trimmed, capped at 64 chars. Apostrophes are elided (so "writer's
 * room" → "writers-room"). Empty input falls back to "kit" so a kit always has
 * a usable slug. Slugs are unique per owner (enforced in the kits routes);
 * renames keep old slugs alive via the kit_slug_aliases table.
 */
export function slugify(input: string): string {
  return canonicalSlugify(input, { fallback: 'kit', maxLength: 64 })
}
