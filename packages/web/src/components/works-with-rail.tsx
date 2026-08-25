import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { ArrowRight } from '@/components/ui/icons'
import { ClaudeLogo, CursorLogo, HermesLogo, OpenAiLogo } from '@/components/brand-logos'

function RuntimeDot({
  children,
  size = 'h-6 w-6',
}: {
  children: React.ReactNode
  size?: string
}) {
  return (
    <span
      className={`flex ${size} items-center justify-center rounded-full border border-(--line) bg-(--surface) text-(--ink-2) ring-2 ring-(--bg)`}
    >
      {children}
    </span>
  )
}

/** The overlapped row of runtime logo dots, at a legible size. */

/**
 * Compact inline variant — the same "runs anywhere" reminder as a single quiet
 * line (icons + label), sized to sit under a detail-page action button, aligned
 * with the header's meta line. No eyebrow; it's a brand note, not a section.
 */

/**
 * Sidebar section listing the runtimes a catalog object runs on. Shared by the
 * skill and kit detail pages so both rails end on the same note.
 */
export function WorksWithRail() {
  return (
    <section className="py-4 first:pt-0">
      <Eyebrow>Works with</Eyebrow>
      <Link
        href="/docs/runtimes"
        className="mt-3 flex flex-col items-start gap-2.5 text-sm text-(--ink-2) transition-colors hover:text-(--ink)"
      >
        <span className="flex -space-x-1.5">
          <RuntimeDot>
            <ClaudeLogo className="h-3 w-3" />
          </RuntimeDot>
          <RuntimeDot>
            <OpenAiLogo className="h-3 w-3" />
          </RuntimeDot>
          <RuntimeDot>
            <CursorLogo className="h-3 w-3" />
          </RuntimeDot>
          <RuntimeDot>
            <HermesLogo className="h-3 w-3" />
          </RuntimeDot>
        </span>
        <span className="inline-flex items-center gap-1">
          Claude, Codex, Cursor &amp; more <ArrowRight className="text-(--accent)" />
        </span>
      </Link>
    </section>
  )
}
