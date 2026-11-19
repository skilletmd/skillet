import type { Metadata } from 'next'
import { AuthorAboutRow } from '@/components/author-about-row'
import { KitPageLayout } from '@/components/kits/kit-page-layout'
import { SLOTS_KIT, SLOTS_KIT_ENTRIES } from '@/lib/arena/slots'

export const metadata: Metadata = {
  title: 'Kit as a list · Skillet',
  description: "Today's kit page, with the same kit the slots preview uses.",
  robots: { index: false, follow: false },
}

/** Today's kit page with the same kit as /arena/slots, for a side-by-side. */
export default function KitListPreviewPage() {
  return (
    <KitPageLayout
      kitId={SLOTS_KIT.id}
      name={SLOTS_KIT.name}
      owner={SLOTS_KIT.owner}
      ownerAvatar={SLOTS_KIT.ownerAvatar}
      description={SLOTS_KIT.description}
      skillCount={SLOTS_KIT_ENTRIES.length}
      categories={SLOTS_KIT_ENTRIES.map((s) => s.category ?? null)}
      heroSeed={SLOTS_KIT.id}
      skills={SLOTS_KIT_ENTRIES}
      capabilities={null}
      authorRow={
        <AuthorAboutRow
          inline
          handle={SLOTS_KIT.owner}
          displayName={SLOTS_KIT.ownerName}
          avatarUrl={SLOTS_KIT.ownerAvatar}
          follow={null}
        />
      }
    />
  )
}
