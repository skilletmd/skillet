import { getSkill } from '@/lib/registry'
import { renderOgImage } from '@/app/api/og/render'
import { OG } from '@/lib/og'

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Branded skill card via the shared renderer — its real generated cover, the
// author's avatar, and a facepile of people who use it. No generateStaticParams
// / force-static: the catalog is live, so this renders on-demand per skill URL.

export default async function SkillPageOGImage({
  params,
}: {
  params: Promise<{ author: string; skill: string }>
}) {
  const { author, skill: slug } = await params
  // The card reads only description/installs/category/faces — never capabilities —
  // so skip the `/scan` hydration roundtrip (R5).
  const skill = await getSkill(author, slug, { skipScan: true }).catch(() => null)
  return renderOgImage(
    OG.skill({
      author,
      slug,
      description: skill?.description,
      installs: skill?.installCount,
      category: skill?.category,
      faces: skill?.usedByPeople?.map((p) => p.handle).filter(Boolean),
    }),
  )
}
