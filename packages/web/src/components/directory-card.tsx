import { CoverArt } from '@/components/cover/cover'
import { CategoryCover } from '@/components/cover/category-cover'
import { isCategoryKey } from '@/lib/categories'
import { seedCategory } from '@skillet/protocol/covers'

/** A skill's thumbnail. A categorized skill gets the squircle cover (one shape,
 *  color = section, glyph = category). An uncategorized skill keeps the neutral
 *  placeholder on a soft ground with app-icon depth (ring + shadow). */
export function SkillIcon({
  seed,
  category,
  radius = 'rounded-xl',
}: {
  seed: string
  category?: string | null
  /** Corner radius — scale it down for smaller renderings so the curve reads
   *  proportional, not over-rounded. */
  radius?: string
}) {
  if (isCategoryKey(category)) {
    return <CategoryCover category={category} seed={seed} radius={radius} />
  }
  return (
    <div
      className={`absolute inset-0 overflow-hidden ${radius} ring-1 ring-inset ring-black/[0.06]`}
    >
      <CoverArt
        seed={seed}
        categories={[category ?? null]}
        listMark
        className="absolute inset-0 h-full w-full"
      />
    </div>
  )
}

/** A kit's thumbnail: the generative painted cover, seeded from its members. */
export function KitStackIcon({
  seed,
  categories = [],
  radius = 'rounded-xl',
  groundOnly = false,
}: {
  seed: string
  /** Per-skill categories — drive the composition. */
  categories?: (string | null)[]
  /** Corner radius — scale it down for smaller renderings. */
  radius?: string
  /** Render only the tinted ground, no glyph — e.g. behind an avatar. */
  groundOnly?: boolean
}) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden ${radius} ring-1 ring-inset ring-black/[0.06]`}
    >
      <CoverArt
        seed={seed}
        categories={categories}
        groundOnly={groundOnly}
        className="absolute inset-0 h-full w-full"
      />
    </div>
  )
}

/** Categories passed to the cover engine for a kit thumbnail. Real member
 *  categories pass straight through. A kit with no valid category — whether it's
 *  empty or its members are all uncategorized — gets a deterministic seed-derived
 *  spread (the kit's own `category` if it has one, otherwise seed keys), at least
 *  two so the engine paints a real generative kit cover (the shared "waves") and
 *  never a blank. The abstract art stands in for "a kit"; it doesn't claim to
 *  depict specific contents, so an empty kit still gets a proper cover. */
export function kitCoverCategories(
  skillCategories: (string | null)[],
  category: string | null | undefined,
  memberCount: number,
  seed: string,
): (string | null)[] {
  if (skillCategories.some((c) => isCategoryKey(c))) return skillCategories
  const n = Math.max(2, Math.min(memberCount, 12))
  const fallback = isCategoryKey(category) ? category : null
  return Array.from({ length: n }, (_, i) => fallback ?? seedCategory(`${seed}:${i}`))
}

/** A face in the "Used by" pile — handle drives the link color, name the initials. */
export type UsedByFace = { handle: string; name: string; avatarUrl: string | null }
