import type { UsedByFace } from '@/components/directory-card'

/**
 * Convert the registry's snake-cased `used_by` wire rows to {@link UsedByFace}.
 * One source of truth for the conversion, shared by the kit catalog and the
 * skill catalog cards. Faces are always real users (public-kit curators for
 * skills, subscribers for kits); this only reshapes them, never invents any.
 */
export function usedByFacesFromWire(raw: unknown): UsedByFace[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r) => {
    const f = r as { handle?: unknown; name?: unknown; avatar_url?: unknown }
    const handle = String(f.handle ?? '')
    return {
      handle,
      name: typeof f.name === 'string' && f.name ? f.name : handle,
      avatarUrl: (f.avatar_url as string | null) ?? null,
    }
  })
}
