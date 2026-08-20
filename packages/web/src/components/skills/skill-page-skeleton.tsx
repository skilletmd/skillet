import { Shimmer } from '@/components/ui/shimmer'

export function SkillInstallSkeleton() {
  return (
    <div
      className="h-12 w-36 animate-pulse surface-card"
      aria-busy="true"
      aria-label="Loading install control"
    />
  )
}

export function SkillOwnerControlsSkeleton() {
  return (
    <div className="pb-4" aria-busy="true" aria-label="Loading owner controls">
      <Shimmer className="h-9 w-full rounded-lg" />
    </div>
  )
}

export function SkillPageSkeleton() {
  return (
    <div className="relative animate-pulse" aria-busy="true" aria-label="Loading skill">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-(--line)/30" />
      <div className="relative mx-auto max-w-[1120px] px-[clamp(18px,4vw,40px)] py-10">
        <Shimmer className="h-10 w-2/3 max-w-md" />
        <Shimmer className="mt-4 h-4 w-full max-w-lg" />
      </div>
    </div>
  )
}
