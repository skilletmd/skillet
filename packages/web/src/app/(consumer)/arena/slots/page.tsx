import type { Metadata } from 'next'
import { AuthorAboutRow } from '@/components/author-about-row'
import { KitSlotsList, KitSlotsProvider } from '@/components/arena/kit-slots'
import { KitPageLayout } from '@/components/kits/kit-page-layout'
import { KIT_SLOTS, SLOTS_KIT, SLOTS_KIT_ENTRIES } from '@/lib/arena/slots'

export const metadata: Metadata = {
  title: 'Kit as slots · Skillet',
  description: 'A kit as the jobs you do. Merge the skills that fight over one job, after a blind pick.',
  robots: { index: false, follow: false },
}

/** Preview: the skills on Taylor's Mac as jobs. Compare with /arena/slots/before. */
export default function KitSlotsPreviewPage() {
  return (
    <KitSlotsProvider slots={KIT_SLOTS}>
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
        list={<KitSlotsList />}
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
    </KitSlotsProvider>
  )
}
