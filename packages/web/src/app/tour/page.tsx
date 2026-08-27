import type { Metadata } from 'next'
import Link from 'next/link'
import { TOUR_STOPS, tourHref } from '@/lib/tour'
import {
  PAGE_CONTAINER_NARROW_CLASS,
  PAGE_LEDE_CLASS,
  PAGE_TITLE_CLASS,
} from '@/lib/page-layout'

export const metadata: Metadata = {
  title: 'Tour · Skillet',
  description:
    'Three pages covering how Skillet finds skills, keeps one copy current in every agent, and picks the one a task needs.',
  alternates: { canonical: '/tour' },
}

// The index exists so the three stops have a parent and a shared entry point.
// Deliberately thin: each stop states its own mechanism, and a summary page that
// restates all three competes with them.
export default function TourIndexPage() {
  return (
    <main className={PAGE_CONTAINER_NARROW_CLASS}>
      <h1 className={PAGE_TITLE_CLASS}>Tour</h1>
      <p className={PAGE_LEDE_CLASS}>
        Three pages, one mechanism each. Read the one you came for.
      </p>

      <ol className="mt-10 flex flex-col gap-3">
        {TOUR_STOPS.map((stop, i) => (
          <li key={stop.slug}>
            <Link
              href={tourHref(stop.slug)}
              className="group flex gap-4 rounded-xl border border-(--line) bg-(--card-soft) px-5 py-4 transition-colors duration-[150ms] hover:border-(--accent)"
            >
              <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--accent-bg) font-mono text-xs font-semibold text-(--accent)">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-(--ink) group-hover:underline group-hover:underline-offset-2">
                  {stop.name}
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-(--ink-2)">
                  {stop.blurb}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  )
}
