'use client'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { CONFIDENCE_RANK, findingCategory, SEVERITY } from '@/lib/scan-taxonomy'
import { pluralize } from '@/lib/format'
import type { ScanDraftResult, ScanFinding } from '@/lib/skill-studio-client'

/** Stable note key, matching the registry's harmNoteKey: category:file:lineStart. */
function noteKey(f: ScanFinding): string {
  return `${f.category}:${f.file}:${f.lineStart}`
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/**
 * The scan-findings rail — docks beside the editor (replacing the old centered
 * modal) so the author keeps their code in view.
 *  - Header explains WHY publish was blocked (or that flagged is fine).
 *  - Each row names the pattern, links to the line, and says how to fix it.
 *  - It re-scans live as you edit, so a blocked panel needs no action button —
 *    fix the lines and it updates itself (closing once clean). Flagged → Publish,
 *    with an optional note per finding.
 */
export function ScanFindingsPanel({
  verdict,
  showNotes,
  notes,
  onNote,
  canAutofix,
  onAutofix,
  onJump,
  scanning,
}: {
  verdict: ScanDraftResult
  /** Render per-finding note inputs (flagged + public only). */
  showNotes: boolean
  notes: Record<string, string>
  onNote: (key: string, value: string) => void
  /** Whether a finding can be one-click fixed (e.g. a secret on a KEY=value line). */
  canAutofix: (f: ScanFinding) => boolean
  /** Apply the one-click fix for a finding. */
  onAutofix: (f: ScanFinding) => void
  onJump: (file: string, line: number) => void
  /** A live re-scan is in flight (debounced after an edit). */
  scanning: boolean
}) {
  const blocked = verdict.status === 'quarantined'
  const isSecret = verdict.reason === 'secret'
  // Only HIGH-confidence findings actually block a publish; medium/low are
  // worth-a-look warnings that would ship on their own. Splitting them is the
  // honest story: fix the blockers and you can publish.
  // Worst first — the dot colour is the severity signal, so the order should
  // reinforce it rather than follow scan-discovery order.
  const findings = [...verdict.findings].sort(
    (a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence],
  )
  const blockers = findings.filter((f) => f.confidence === 'high')
  const warnings = findings.filter((f) => f.confidence !== 'high')
  const grouped = blocked && blockers.length > 0 && warnings.length > 0
  const missingNotes = showNotes
    ? verdict.findings.filter((f) => !notes[noteKey(f)]?.trim()).length
    : 0

  const title = blocked ? 'Publish blocked' : 'Before you publish'
  const subtitle = isSecret
    ? 'This would publish a credential. Fix the line below, then re-check.'
    : blocked
      ? `Fix the ${blockers.length} ${pluralize(blockers.length, 'blocker')} below to publish.${
          warnings.length > 0 ? ' The rest are just worth a look.' : ''
        }`
      : 'These publish fine. Add a note on anything intentional so installers know why.'

  const renderFinding = (f: ScanFinding, i: number) => {
    const info = findingCategory(f.category)
    const sev = SEVERITY[f.confidence]
    const key = noteKey(f)
    return (
      <li key={`${key}:${i}`} className={`overflow-hidden rounded-xl ${sev.tint}`}>
        {/* The whole row jumps to the line — a bigger, more forgiving target than
            the file:line text alone. */}
        <button
          type="button"
          onClick={() => onJump(f.file, f.lineStart)}
          className="group flex w-full gap-2.5 px-4 py-3 text-left transition-colors hover:bg-(--ink)/[0.03]"
        >
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev.dot}`}
            title={sev.label}
            aria-label={sev.label}
          />
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-(--ink) group-hover:text-(--accent)">
              {info.label}
            </span>
            <span className="mt-0.5 block truncate font-mono text-xs text-(--ink-2)/70 group-hover:text-(--accent)">
              {baseName(f.file)}:{f.lineStart} →
            </span>
            <p className="mt-1 text-xs leading-[1.45] text-(--ink-2)">{info.fix}</p>
          </div>
        </button>
        {canAutofix(f) && (
          <div className="-mt-1 pb-3 pl-9 pr-4">
            <Button type="button" variant="secondary" size="sm" onClick={() => onAutofix(f)}>
              Replace with placeholder
            </Button>
          </div>
        )}
        {showNotes && (
          <input
            type="text"
            value={notes[key] ?? ''}
            onChange={(e) => onNote(key, e.target.value)}
            placeholder="Why is this OK? (optional)"
            className="mx-4 mb-3 w-[calc(100%-2rem)] rounded-lg border border-(--line) bg-(--bg) px-2.5 py-1.5 text-xs text-(--ink) transition-[border-color,box-shadow] duration-200 placeholder:text-(--ink-2)/50 focus:border-(--ink) focus:shadow-[0_0_0_3px_var(--accent-bg)] focus:outline-none"
          />
        )}
      </li>
    )
  }

  const sectionLabel = (text: string) => (
    <li className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-(--ink-2) first:pt-0">
      {text}
    </li>
  )

  return (
    // A plain card that leads the manage rail when there are issues. The parent
    // aside owns width and sticky positioning; the card sizes to its findings so
    // a couple of them read as a compact block, not a full-height void. A
    // max-height keeps a long list from outrunning the viewport; it scrolls
    // internally instead.
    <Panel
      as="section"
      padding="none"
      className="flex max-h-[calc(100vh-7rem)] w-full flex-col overflow-hidden"
    >
      <div className="border-b border-(--line) px-4 py-3">
        <p className="text-sm font-semibold text-(--ink)">{title}</p>
        {/* When the list is split into MUST FIX / WORTH A LOOK sections, those
            labels already say this — don't restate it here. */}
        {!grouped && <p className="mt-1 text-xs leading-[1.45] text-(--ink-2)">{subtitle}</p>}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {grouped ? (
          <>
            {sectionLabel('Must fix to publish')}
            {blockers.map((f, i) => renderFinding(f, i))}
            {sectionLabel('Worth a look')}
            {warnings.map((f, i) => renderFinding(f, blockers.length + i))}
          </>
        ) : (
          findings.map((f, i) => renderFinding(f, i))
        )}
      </ul>

      {/* No buttons here — publishing is the one Publish button in the editor's
          footer (enabled live the moment it's safe). This rail is the findings +
          notes; it re-scans as you edit and closes itself once clean. */}
      {(blocked || (showNotes && missingNotes > 0)) && (
        <div className="border-t border-(--line) px-4 py-3 text-xs text-(--ink-2)">
          {blocked
            ? scanning
              ? 'Re-scanning…'
              : 'Fixes update automatically as you edit.'
            : `${missingNotes} ${pluralize(missingNotes, 'flag has', 'flags have')} no note`}
        </div>
      )}
    </Panel>
  )
}
