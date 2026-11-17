import type { SectionId } from '@skillet/protocol/jobs'

/**
 * Each section's band colour and the ink on it: the kit map on skillet.md
 * (components/map/kit-map-view.tsx) and its previews under /packs. A module of
 * its own, so the map doesn't pull the previews' data in with its colours.
 */
export const SECTION_HUES: Record<SectionId, { color: string; ink: string }> = {
  writing: { color: '#2f57e8', ink: '#ffffff' },
  // The marketing pack's colour too (./data.ts).
  marketing: { color: '#d43d17', ink: '#ffffff' },
  sales: { color: '#0c7f50', ink: '#ffffff' },
  design: { color: '#5b3df5', ink: '#ffffff' },
  development: { color: '#0b7285', ink: '#ffffff' },
  research: { color: '#b4417a', ink: '#ffffff' },
  business: { color: '#f5b11a', ink: '#1b1609' },
  media: { color: '#c9356d', ink: '#ffffff' },
  tools: { color: '#3f3b36', ink: '#ffffff' },
}
