'use client'

// Public security tab.
//
// The expandable findings panel on the skill detail page. Collapsed by default
// — a skill page should not open on a wall of scanner output — and the copy is
// written to inform without scaring: "N signals", not "malware". Static
// analysis flags patterns, not intent, and the disclaimer says so plainly.
// Findings rows are only shown for flagged / quarantined; a clean scan renders
// the summary line and disclaimer alone. The `pending` state never reaches
// here (the page gates on it).

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from '@/components/ui/icons'
import type { FindingConfidence, SecurityFinding, SkillSecurity } from '@/lib/types'
import { findingCategory, SEVERITY, CONFIDENCE_RANK, highestConfidence } from '@/lib/scan-taxonomy'
import { formatShortDate } from '@/lib/feed-format'
import { pluralize } from '@/lib/format'
import { SKILLET_EVENTS } from '@/lib/events'
// Category labels/descriptions and the severity scale live in one place —
// `@/lib/scan-taxonomy` — so this tab, the updates modal, and the editor rail
// never drift. This surface uses the installer-facing `describe` copy.

// Exported so the unified trust panel fires the file-viewer jump through the
// exact same event — one mechanism, no drift.
export function revealFinding(file: string, line: number | undefined) {
  window.dispatchEvent(
    new CustomEvent(SKILLET_EVENTS.revealFinding, { detail: { path: file, line: line ?? 1 } }),
  )
}

/** Just the filename — the directory path is engineer noise on a card meant to
 *  inform a non-engineer "where", not navigate a repo. */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/**
 * Findings grouped by what they are — ten of the same pattern read as one note
 * across ten places, not ten scary cards. Each group explains the pattern once;
 * the places are a compact, clickable list that jumps into the file.
 */
function FindingGroups({
  findings,
  interactive,
}: {
  findings: SecurityFinding[]
  /** Locations jump to the line in the file viewer when interactive; away from
   *  it (the modal) they're plain text and the "Inspect" link does the jumping. */
  interactive: boolean
}) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { info: { label: string; describe: string }; items: SecurityFinding[]; top: FindingConfidence }
    >()
    for (const f of findings) {
      const g = map.get(f.category) ?? {
        info: findingCategory(f.category),
        items: [],
        top: 'low' as FindingConfidence,
      }
      g.items.push(f)
      if (CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK[g.top]) g.top = f.confidence
      map.set(f.category, g)
    }
    return [...map.values()].sort((a, b) => CONFIDENCE_RANK[b.top] - CONFIDENCE_RANK[a.top])
  }, [findings])

  return (
    <ul className="space-y-2.5">
      {groups.map((g) => (
        <li
          key={g.info.label}
          className={`rounded-xl border border-(--line) p-4 ${SEVERITY[g.top].tint}`}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY[g.top].dot}`}
              title={SEVERITY[g.top].label}
              aria-label={SEVERITY[g.top].label}
            />
            <span className="text-sm font-semibold text-(--ink)">{g.info.label}</span>
            <span className="text-xs text-(--ink-2)">
              · {g.items.length} {pluralize(g.items.length, 'place')}
            </span>
          </div>
          <p className="mt-1 max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">{g.info.describe}</p>
          {interactive ? (
            // Skill page: one quiet "Where" line, each location clicks to jump to
            // the line in the file viewer.
            <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-(--ink-2)">
              <span className="shrink-0 font-medium">Where</span>
              {g.items.map((f, i) => (
                <span
                  key={`${f.file}:${f.line ?? 0}:${i}`}
                  className="inline-flex items-baseline gap-2"
                >
                  {i > 0 && (
                    <span aria-hidden="true" className="text-(--ink-2)/40">
                      ·
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => revealFinding(f.file, f.line)}
                    className="font-mono text-(--ink-2)/80 transition-colors hover:text-(--accent)"
                  >
                    {baseName(f.file)}
                    {typeof f.line === 'number' ? `:${f.line}` : ''}
                  </button>
                </span>
              ))}
            </p>
          ) : null}
          {interactive && g.items.some((f) => f.note) && (
            <div className="mt-2 space-y-1">
              {g.items
                .filter((f) => f.note)
                .map((f, i) => (
                  <p
                    key={`note:${f.file}:${f.line ?? 0}:${i}`}
                    className="max-w-[68ch] text-xs leading-[1.5] text-(--ink-2)"
                  >
                    <span className="font-medium text-(--ink)">Author&rsquo;s note</span>{' '}
                    <span className="font-mono text-(--ink-2)/80">
                      {baseName(f.file)}
                      {typeof f.line === 'number' ? `:${f.line}` : ''}
                    </span>
                    <span className="mt-0.5 block">{f.note}</span>
                  </p>
                ))}
            </div>
          )}
          {!interactive ? (
            // Modal: no file viewer to jump into, so peek the flagged line inline.
            <div className="mt-2.5 space-y-2">
              {g.items.map((f, i) => (
                <div key={`${f.file}:${f.line ?? 0}:${i}`}>
                  <p className="text-xs text-(--ink-2)">
                    <span className="font-medium">Where</span>{' '}
                    <span className="font-mono text-(--ink-2)/80">
                      {baseName(f.file)}
                      {typeof f.line === 'number' ? `:${f.line}` : ''}
                    </span>
                  </p>
                  {f.snippet && (
                    <pre className="mt-1 overflow-x-auto rounded-md border border-(--line) bg-(--bg) px-2.5 py-1.5 font-mono text-xs leading-[1.5] text-(--ink)">
                      {f.snippet}
                    </pre>
                  )}
                  {f.note && (
                    <p className="mt-1.5 text-xs leading-[1.5] text-(--ink-2)">
                      <span className="font-medium text-(--ink)">Author&rsquo;s note</span>{' '}
                      {f.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * The trust bar that sits directly above the file viewer: provenance on the left
 * (passed in as `source`), the scan verdict on the right, on one justified line.
 * The scan's explanation + findings drop full-width below the line when expanded,
 * so the left/right split never cramps them.
 */
export function SecurityTab({
  data,
  source,
  defaultOpen = false,
  collapsible = true,
  inspectHref,
}: {
  data: SkillSecurity
  source?: ReactNode
  /** Start expanded — used when the tab is the whole point of the surface (e.g.
   *  the Updates "why flagged" modal), vs. a quiet panel on the skill page. */
  defaultOpen?: boolean
  /** When false the findings are always shown and the summary is static — the
   *  modal IS the reveal, so there's nothing to collapse. */
  collapsible?: boolean
  /** Set when rendered away from the file viewer (the Updates modal): locations
   *  become plain text (no dead "jump to line"), and a link points to this URL —
   *  the skill page — where the full report + file viewer live. */
  inspectHref?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const expanded = collapsible ? open : true
  const scannedAt = data.scannedAt ? formatShortDate(data.scannedAt) || null : null

  // Clean: provenance left, a quiet "Scanner found no issues" line right —
  // parallel to the flagged copy, just outcome-positive. No box.
  if (data.status === 'clean') {
    return (
      <TrustBar source={source}>
        <span
          className="flex items-center gap-2 text-sm text-(--ink-2)"
          aria-label="Scanner found no issues"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
            className="shrink-0 text-(--success)"
          >
            <circle cx="8" cy="8" r="6.5" />
            <path d="M5.5 8.2l1.8 1.8 3.2-3.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Scanner found no issues</span>
          {scannedAt ? <span>· {scannedAt}</span> : null}
        </span>
      </TrustBar>
    )
  }

  // Flagged / quarantined: a single one-line verdict with a traffic-light dot
  // (green / amber / red), that expands to the meaning + grouped findings.
  const quarantined = data.status === 'quarantined'
  const findings = data.findings
  const n = findings.length
  const highest = highestConfidence(findings)
  const level: 'low' | 'medium' | 'high' = quarantined || highest === 'high' ? 'high' : highest
  const noun = pluralize(n, 'pattern')

  // The one collapsed line carries the lede — what was found, in plain terms —
  // so you understand it without expanding. The explanation + the list of places
  // live behind the arrow.
  const summary =
    level === 'high'
      ? quarantined
        ? 'Blocked: a serious issue was found'
        : `Scanner found ${n} serious ${noun}`
      : level === 'medium'
        ? `Scanner found ${n} ${noun} to review`
        : `Scanner found ${n} low-risk ${noun}`

  // Provenance left, verdict right on one line; the explanation + grouped
  // findings expand full-width below so the split never cramps them.
  return (
    <div>
      {/* Collapsible (skill page): the verdict line IS the toggle. Non-collapsible
          (modal): the modal title already states the verdict, so we skip this
          line and lead straight with the explanation + findings. */}
      {collapsible && (
        <TrustBar source={source}>
          <button
            type="button"
            onClick={() => setOpen((p) => !p)}
            aria-expanded={open}
            className="group inline-flex items-center gap-2 text-sm text-(--ink-2) hover:text-(--ink)"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY[highest].dot}`}
              aria-hidden="true"
            />
            <span>{summary}</span>
            {scannedAt ? <span>· {scannedAt}</span> : null}
            <ChevronRight
              className={`shrink-0 h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            />
          </button>
        </TrustBar>
      )}

      {expanded && (
        <div className={collapsible ? 'mt-3 space-y-3' : 'space-y-3'}>
          <p className="max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">
            We flag patterns like network calls and shell commands. Worth a look, not proof of a
            problem.
          </p>
          {n > 0 && <FindingGroups findings={findings} interactive={!inspectHref} />}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <p className="text-xs text-(--ink-2)">
              Something off?{' '}
              <span
                title="Abuse reporting is coming in a future release."
                className="cursor-not-allowed underline decoration-dashed"
              >
                Report this skill
              </span>
            </p>
            {inspectHref && (
              <Link
                href={inspectHref}
                className="inline-flex items-center gap-1 text-xs font-medium text-(--accent) hover:underline"
              >
                Inspect on the skill page
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One justified row sitting just above the file viewer: the scan verdict on the
 * left (every skill is scanned, so it anchors the row), and the optional source
 * (`source`, only on mirrored skills) floated right. With no source, the verdict
 * stays left-aligned on its own.
 */
function TrustBar({ source, children }: { source?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {children}
      {source ? <div className="min-w-0">{source}</div> : null}
    </div>
  )
}
