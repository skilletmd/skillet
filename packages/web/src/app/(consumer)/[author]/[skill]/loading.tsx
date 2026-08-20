import { Shimmer } from '@/components/ui/shimmer'

// Route-level loading UI for a skill detail page. Shown while the server
// component awaits GET /v1/skills/:author/:slug (first paint / revalidation).
export default function SkillLoading() {
  return (
    <main
      className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] py-12 sm:py-16"
      aria-busy="true"
      aria-label="Loading skill"
    >
      <Shimmer className="mb-10 h-4 w-1/3" />

      <section className="border-b border-(--line) pb-10 sm:pb-12">
        <Shimmer className="h-3 w-16" />
        <Shimmer className="mt-3 h-12 w-2/3" />
        <Shimmer className="mt-4 h-4 w-1/3" />
        <Shimmer className="mt-6 h-4 w-full max-w-[68ch]" />
        <Shimmer className="mt-2 h-4 w-5/6 max-w-[68ch]" />
        <Shimmer className="mt-6 h-4 w-40" />
      </section>

      <section className="py-10 sm:py-12">
        <Shimmer className="h-3 w-24" />
        <Shimmer className="mt-3 h-7 w-32" />
        <div className="mt-6 flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
        <Shimmer className="mt-4 h-[52px] w-full rounded-lg" />
      </section>
    </main>
  )
}
