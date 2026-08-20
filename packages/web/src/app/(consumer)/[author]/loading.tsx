import { Shimmer } from '@/components/ui/shimmer'

// Route-level loading UI for an author profile. Shown while the server
// component awaits GET /v1/authors/:username (first paint / revalidation).
export default function AuthorLoading() {
  return (
    <main
      className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] py-12 sm:py-16"
      aria-busy="true"
      aria-label="Loading author profile"
    >
      <Shimmer className="mb-10 h-4 w-1/4" />

      <section className="grid gap-8 border-b border-(--line) pb-10 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-start sm:pb-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <Shimmer className="h-24 w-24 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <Shimmer className="h-3 w-28" />
            <Shimmer className="mt-3 h-11 w-1/2" />
            <Shimmer className="mt-3 h-4 w-32" />
            <Shimmer className="mt-5 h-4 w-full max-w-[56ch]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-(--line) bg-(--line)">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-(--surface) p-4">
              <Shimmer className="h-3 w-16" />
              <Shimmer className="mt-2 h-6 w-12" />
            </div>
          ))}
        </div>
      </section>

      <section className="py-10 sm:py-12">
        <Shimmer className="h-3 w-28" />
        <Shimmer className="mt-3 h-7 w-48" />
        <div className="mt-6 divide-y divide-(--line) border-y border-(--line)">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_180px]">
              <div>
                <Shimmer className="h-5 w-1/3" />
                <Shimmer className="mt-2 h-4 w-full max-w-[68ch]" />
                <Shimmer className="mt-3 h-4 w-40" />
              </div>
              <Shimmer className="h-5 w-16 sm:ml-auto" />
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
