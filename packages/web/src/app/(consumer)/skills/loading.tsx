import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { Shimmer } from '@/components/ui/shimmer'

// Route-level loading UI for the skills directory. Mirrors the live layout:
// compact PageHeader (title + action + lede), directory tabs, search, then the
// card grid.
export default function SkillsLoading() {
  return (
    <main
      className={`marketing-home consumer-theme ${PAGE_CONTAINER_CLASS}`}
      aria-busy="true"
      aria-label="Loading skills"
    >
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">Skills</h1>
          <div className="h-9 w-28 animate-pulse rounded-lg border border-(--line) bg-(--surface)" />
        </div>
        <p className="mt-1.5 text-base text-(--ink-2)">Loading the directory…</p>
      </div>

      <div className="mb-6 flex gap-6 border-b border-(--line) pb-3">
        {['Skills', 'Kits', 'People'].map((t) => (
          <Shimmer key={t} className="h-4 w-12" />
        ))}
      </div>

      <div className="mb-6 h-[48px] w-full animate-pulse surface-card" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex h-[164px] animate-pulse flex-col gap-3 surface-card p-5"
          >
            <Shimmer className="h-4 w-1/2" />
            <Shimmer className="h-3 w-full" />
            <div className="mt-auto flex items-center justify-between">
              <Shimmer className="h-3 w-1/3" />
              <Shimmer className="h-7 w-20" />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
