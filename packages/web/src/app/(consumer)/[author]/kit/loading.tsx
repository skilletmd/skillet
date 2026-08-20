import { Shimmer } from '@/components/ui/shimmer'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'

// Route-level loading UI for a kit page — mirrors KitPageLayout (cover-forward
// hero + two-column body) so the skeleton matches what resolves. Covers both the
// named kit (/[author]/kit/[slug]) and the virtual author-kit (/[author]/kit);
// without it these fall back to the author-profile skeleton, which is the wrong
// shape. Keep in sync with KitPageLayout / RecipeBoxHero.
export default function KitLoading() {
  // Varied chip widths so the permissions row reads like real capability pills.
  const chipWidths = ['w-40', 'w-32', 'w-44', 'w-36', 'w-28', 'w-40', 'w-32', 'w-36']
  return (
    <div className="relative">
      <main className={`relative ${PAGE_CONTAINER_CLASS}`} aria-busy="true" aria-label="Loading kit">
        {/* Hero — 300px cover well beside the identity + actions. */}
        <div className="grid items-center gap-12 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[300px]">
            <Shimmer className="aspect-square w-full rounded-2xl" />
          </div>
          <div>
            <Shimmer className="h-12 w-2/3 rounded-lg" />
            <Shimmer className="mt-4 h-4 w-44" />
            <Shimmer className="mt-4 h-4 w-full max-w-[54ch]" />
            <Shimmer className="mt-2 h-4 w-3/4 max-w-[46ch]" />
            <Shimmer className="mt-5 h-4 w-32" />
            <div className="mt-6 flex flex-wrap gap-3">
              <Shimmer className="h-11 w-32 rounded-full" />
              <Shimmer className="h-11 w-40 rounded-full" />
            </div>
            <Shimmer className="mt-6 h-4 w-16" />
          </div>
        </div>

        {/* Body — capabilities → skills on the left, rail on the right. */}
        <div className="mt-10 grid gap-10 border-t border-(--line) pt-8 lg:grid-cols-[minmax(0,1fr)_var(--rail-content)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-8">
            <section>
              <Shimmer className="h-3 w-28" />
              <div className="mt-3 flex flex-wrap gap-2">
                {chipWidths.map((w, i) => (
                  <Shimmer key={i} className={`h-9 rounded-lg ${w}`} />
                ))}
              </div>
            </section>

            <section>
              <Shimmer className="h-3 w-36" />
              <div className="mt-4 flex flex-col gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Shimmer key={i} className="h-16 w-full rounded-2xl" />
                ))}
              </div>
            </section>
          </div>

          <aside>
            <Shimmer className="h-3 w-20" />
            <Shimmer className="mt-3 h-9 w-9 rounded-full" />
            <Shimmer className="mt-8 h-3 w-28" />
            <div className="mt-3 flex flex-col gap-3">
              <Shimmer className="h-4 w-full" />
              <Shimmer className="h-4 w-2/3" />
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
