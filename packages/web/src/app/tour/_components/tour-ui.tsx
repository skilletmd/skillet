import type { ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { nextTourStop, tourHref, type TourSlug } from '@/lib/tour'

/**
 * Presentational shell for a tour stop.
 *
 * The register is the docs register (see `.claude/skills/docs-voice`): flat
 * present tense, mechanism before benefit, tables for anything with three or
 * more items, limits stated rather than omitted. The primitives here exist to
 * make that shape easy and the marketing shape awkward, which is why there is a
 * table and a definition list but no pull quote and no eyebrow.
 *
 * All type scale comes from Tailwind steps and the two sanctioned display
 * classes (`.text-display` / `.text-title`); no `text-[Npx]` lands here, which
 * is what `no-custom-font-sizes` enforces.
 */

const SHELL = 'mx-auto max-w-[720px] px-[clamp(16px,4vw,32px)]'

/** Body prose shared by every section, so paragraphs match across the three stops. */
const PROSE =
  'flex flex-col gap-4 text-(--ink-2) [&_p]:max-w-[66ch] [&_p]:leading-[1.6] [&_strong]:font-semibold [&_strong]:text-(--ink)'

export function TourHero({
  title,
  children,
  cta,
}: {
  title: string
  children: ReactNode
  cta: { label: string; href: string; note: string }
}) {
  return (
    <header className="relative overflow-hidden border-b border-(--line)">
      {/* Same warm wash the home hero uses, scoped here so globals.css keeps
          its `.marketing-home` prefix and this page owns its own background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,color-mix(in_srgb,var(--info)_10%,transparent),transparent_32%)]"
      />
      <div className={`${SHELL} relative pt-16 pb-14 sm:pt-24 sm:pb-20`}>
        <h1 className="text-display font-semibold tracking-[-0.025em] leading-[1.04] text-balance">
          {title}
        </h1>
        <div className="mt-5 max-w-[62ch] text-lg leading-[1.55] text-(--ink-2)">{children}</div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button href={cta.href} size="lg">
            {cta.label}
          </Button>
          <span className="text-sm text-(--ink-2)">{cta.note}</span>
        </div>
      </div>
    </header>
  )
}

export function TourSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-(--line) py-14 sm:py-16">
      <div className={SHELL}>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-balance">{title}</h2>
        <div className={`mt-5 ${PROSE}`}>{children}</div>
      </div>
    </section>
  )
}

/** Bold lead-in + colon. The docs signature list, for 2 to 4 related facts. */
export function TourList({ items }: { items: { term: string; body: ReactNode }[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.term} className="max-w-[66ch] leading-[1.6]">
          <dt className="inline font-semibold text-(--ink)">{item.term}:</dt>{' '}
          <dd className="inline text-(--ink-2)">{item.body}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Any three-or-more-item comparison. Cells are fragments, no terminal periods. */
export function TourTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[420px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-(--line)">
            {head.map((cell) => (
              <th key={cell} className="py-2 pr-4 font-semibold text-(--ink) last:pr-0">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-(--line) last:border-b-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="py-2.5 pr-4 align-top leading-[1.5] text-(--ink-2) last:pr-0 [&:first-child]:font-medium [&:first-child]:text-(--ink)"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Numbered steps, one clause each. */
export function TourSteps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="flex flex-col gap-5">
      {items.map((item, i) => (
        <li key={item.title} className="flex gap-4">
          <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--accent-bg) font-mono text-xs font-semibold text-(--accent)">
            {i + 1}
          </span>
          <div className="max-w-[62ch]">
            <p className="font-semibold text-(--ink)">{item.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-(--ink-2)">{item.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** The house "Good to know" callout: same flat register, higher stakes. */
export function TourNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="max-w-[66ch] border-l-[3px] border-(--accent) py-1 pl-4">
      <p className="font-semibold text-(--ink)">{label}</p>
      <div className="mt-1 leading-[1.6] text-(--ink-2)">{children}</div>
    </div>
  )
}

/** Limits. Every stop states them rather than leaving one out to look good. */
export function TourLimits({ children }: { children: ReactNode }) {
  return (
    <section className="border-b border-(--line) py-14 sm:py-16">
      <div className={SHELL}>
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">Limits</h2>
        <div className={`mt-5 ${PROSE}`}>{children}</div>
      </div>
    </section>
  )
}

/** Docs ending: next steps as annotated links, then stop. No summary paragraph. */
export function TourNext({
  from,
  cta,
  links,
}: {
  from: TourSlug
  cta: { label: string; href: string; note: string }
  links: { href: string; label: string; note: string }[]
}) {
  const next = nextTourStop(from)
  return (
    <section className="py-14 sm:py-16">
      <div className={SHELL}>
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">Next steps</h2>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button href={cta.href} size="lg">
            {cta.label}
          </Button>
          <span className="text-sm text-(--ink-2)">{cta.note}</span>
        </div>
        <ul className="mt-8 flex flex-col gap-2">
          {[
            ...links,
            { href: tourHref(next.slug), label: next.name, note: 'the next page of the tour' },
          ].map((link) => (
            <li key={link.href} className="max-w-[66ch] leading-[1.6]">
              <Link href={link.href} className="font-medium text-(--ink) underline underline-offset-2">
                {link.label}
              </Link>
              <span className="text-(--ink-2)">: {link.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Inline code in prose. One treatment so the three stops match. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="code-inline rounded-sm bg-(--accent-bg) px-1 py-0.5 font-mono text-(--accent)">
      {children}
    </code>
  )
}
