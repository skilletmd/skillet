import { DocNav } from '@/components/doc-nav'
import { DOC_NAV } from '@/lib/docs-nav'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-home">
      {/* No top padding on the narrowest screens so the sticky context bar sits
          flush under the header; the two-column layout (sm+) gets its normal
          top spacing. */}
      <div className="mx-auto flex max-w-[1120px] flex-col gap-4 px-[clamp(16px,4vw,32px)] pt-0 pb-12 sm:flex-row sm:gap-8 sm:pb-16">
        <DocNav sections={DOC_NAV} />
        {/* Top spacing lives on each column, not the shared row, so the sticky
            sidebar sits at its pinned position from scroll 0 (no lead-in). */}
        <div className="min-w-0 flex-1 pt-10 sm:pt-6">{children}</div>
      </div>
    </div>
  )
}
