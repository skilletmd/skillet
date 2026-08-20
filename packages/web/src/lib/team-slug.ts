import { slugify } from './slugify'

/** Lower-kebab a free-text team name into a registry-valid org slug.
 *  Mirrors the registry SLUG_RE (1–40 lowercase alphanumerics / hyphens). */
export function slugifyTeam(value: string): string {
  return slugify(value, { maxLength: 40 })
}
