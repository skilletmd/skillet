import { cn } from '@/lib/cn'

/**
 * Shimmer placeholder bar — the single pulsing element every loading/skeleton
 * view uses. Callers pass only width/height/shape (and optional margin) via
 * `className`; the pulse, base radius, and tint are owned here so skeletons stay
 * consistent. Pass `rounded-full` / `rounded-lg` etc. to override the radius.
 * Renders a block-level `<span>` so it stays valid HTML inside `<p>` slots
 * (e.g. SettingRow titles).
 */
export function Shimmer({ className }: { className?: string }) {
  return <span className={cn('block animate-pulse rounded bg-(--line)', className)} />
}
