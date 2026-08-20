import type { Metadata } from 'next'
import Link from 'next/link'
import { FLAGS, PERMISSIONS, PERMISSION_ORDER } from '@skillet/protocol'
import { PAGE_LEDE_CLASS, PAGE_TITLE_CLASS, SECTION_TITLE_CLASS } from '@/lib/page-layout'
import { DOC_NAV } from '@/lib/docs-nav'
import { ChevronRight } from '@/components/ui/icons'

// The public explainer for how Skillet scans a skill and classifies what it
// finds — the consumer-voice counterpart to the per-skill trust panel. It
// teaches the same model the panel renders (so the page can never describe
// behavior the panel doesn't show) and lists the full vocabulary live from the
// protocol: the permissions (what a skill can do) and the flags (what gets
// checked). Tables are generated from @skillet/protocol, so they cannot drift.
// This is a bespoke page (its tables are generated), so it reproduces the
// standard DocArticle shell — title, lede, divider, prev/next, on-this-page —
// by hand so it matches the markdown docs. This is NOT the dev-gated
// /lab/scanner audit — no lints, no detector inventory, no author-facing fixes.

export const metadata: Metadata = {
  title: 'How scanning works · Skillet docs',
  description:
    'How Skillet scans a skill’s files, what the permissions and flags mean, and how findings are shown on a skill’s page.',
}

/** The two places a finding can land — the same model the trust panel applies. */
const ZONES: { name: string; tone: string; body: string }[] = [
  {
    name: 'Safety',
    tone: 'text-(--danger)',
    body: 'A serious, high-confidence finding: a `rm -rf /`, a leaked key, a reverse shell. Shown in red, unmissable, but never blocking. You see the warning and decide.',
  },
  {
    name: 'Permissions',
    tone: 'text-(--ink)',
    body: 'What the skill can do and access, listed plainly. Anything lower-confidence the scanner noticed (a documented install command, an injection-shaped line) shows here too, set apart, so you see everything without being alarmed.',
  },
]

const TH =
  'border-b border-(--line) px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-(--ink-2)'
const TD = 'border-t border-(--line) px-3 py-3 align-top text-sm text-(--ink)'
const TD_MUTED = 'border-t border-(--line) px-3 py-3 align-top text-sm text-(--ink-2)'

// Standard article chrome, computed the same way DocArticle does it.
const HEADINGS = [
  { id: 'what-the-scan-checks', text: 'What the scan checks' },
  { id: 'how-findings-are-shown', text: 'How findings are shown' },
  { id: 'permissions', text: 'Permissions' },
  { id: 'flags', text: 'Flags' },
]
const NAV_ITEMS = DOC_NAV.flatMap((s) => s.items)
const HERE_IDX = NAV_ITEMS.findIndex((i) => i.href === '/docs/scanner')
const PREV = HERE_IDX > 0 ? NAV_ITEMS[HERE_IDX - 1] : null
const NEXT = HERE_IDX >= 0 && HERE_IDX < NAV_ITEMS.length - 1 ? NAV_ITEMS[HERE_IDX + 1] : null

export default function ScanningDoc() {
  const permissions = PERMISSION_ORDER.map((id) => PERMISSIONS[id]).filter(Boolean)
  const flags = Object.values(FLAGS)

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1">
        <h1 className={PAGE_TITLE_CLASS}>How Skillet scans a skill</h1>
        <p className={PAGE_LEDE_CLASS}>
          Every published skill is scanned, and the results sit on its page. Here&rsquo;s what the
          scan looks at, what it means, and how to read any skill&rsquo;s trust panel.
        </p>
        <hr className="my-6 border-(--line)" />

        <section className="scroll-mt-24">
          <h2 id="what-the-scan-checks" className={`scroll-mt-24 ${SECTION_TITLE_CLASS}`}>
            What the scan checks
          </h2>
          <p className="mt-3 text-base leading-[1.6] text-(--ink-2)">
            Skillet reads a skill&rsquo;s files (its instructions and any bundled code) and matches
            them against patterns for risky capabilities and threats. It matches code and text, not
            intent, so <strong className="text-(--ink)">false positives are common</strong>: an
            install command in the docs, a `system:` line in an AI-SDK example, a `DROP TABLE` in a
            best-practices note all look like their dangerous cousins. Treat a finding as something to
            check, not a verdict.
          </p>
          <p className="mt-3 text-base leading-[1.6] text-(--ink-2)">
            Confidence decides how loudly a finding shows. Skillet warns strongly when something is
            genuinely serious and simply informs when it isn&rsquo;t, so the rare red warning stays
            meaningful. It never blocks an install; you keep the final call.
          </p>
        </section>

        <section className="mt-10">
          <h2 id="how-findings-are-shown" className={`scroll-mt-24 ${SECTION_TITLE_CLASS}`}>
            How findings are shown
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {ZONES.map((z) => (
              <div key={z.name} className="rounded-lg border border-(--line) p-4">
                <dt className={`text-sm font-semibold ${z.tone}`}>{z.name}</dt>
                <dd className="mt-1.5 text-sm leading-[1.5] text-(--ink-2)">{z.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">
            A clean skill shows no Safety card at all, just its permissions. Wherever a finding
            lands, you can expand it to see the exact file and line it came from.
          </p>
        </section>

        <section className="mt-10">
          <h2 id="permissions" className={`scroll-mt-24 ${SECTION_TITLE_CLASS}`}>
            Permissions
          </h2>
          <p className="mt-2 max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">
            What a skill can do: the capabilities Skillet detects, most-impactful first.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} w-1/4`}>Permission</th>
                  <th className={TH}>What it means</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((p) => (
                  <tr key={p.id}>
                    <td className={`${TD} font-medium`}>{p.label}</td>
                    <td className={TD_MUTED}>{p.describe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 id="flags" className={`scroll-mt-24 ${SECTION_TITLE_CLASS}`}>
            Flags
          </h2>
          <p className="mt-2 max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">
            What gets checked: the threat patterns Skillet looks for. A high-confidence match shows
            in Safety; anything lower informs alongside the skill&rsquo;s permissions.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} w-1/4`}>Flag</th>
                  <th className={TH}>What it means</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id}>
                    <td className={`${TD} font-medium`}>{f.label}</td>
                    <td className={TD_MUTED}>{f.describe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="mt-10 max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">
          Scanning is one guardrail. For the rest (approving other people&rsquo;s updates, signing,
          and keeping your own skills private), see{' '}
          <Link href="/docs/safety" className="text-(--accent) underline">
            Safety
          </Link>
        </p>

        {/* Prev/next navigation — matches DocArticle. */}
        <div className="mt-12 flex items-center justify-between border-t border-(--line) pt-6 text-sm">
          {PREV ? (
            <Link
              href={PREV.href}
              className="flex items-center gap-2 text-(--ink-2) hover:text-(--ink)"
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M10 4L6 8l4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {PREV.title}
            </Link>
          ) : (
            <div />
          )}
          {NEXT ? (
            <Link
              href={NEXT.href}
              className="flex items-center gap-2 text-(--ink-2) hover:text-(--ink)"
            >
              {NEXT.title}
              <ChevronRight className="text-base" />
            </Link>
          ) : (
            <div />
          )}
        </div>

      </article>

      {/* Right rail: on-page anchor nav — matches DocArticle. */}
      <aside className="hidden w-48 shrink-0 xl:block">
        <div className="sticky top-20">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
            On this page
          </p>
          <ul className="space-y-1.5">
            {HEADINGS.map((h) => (
              <li key={h.id}>
                <Link
                  href={`#${h.id}`}
                  className="block text-xs leading-relaxed text-(--ink-2) hover:text-(--ink)"
                >
                  {h.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}
