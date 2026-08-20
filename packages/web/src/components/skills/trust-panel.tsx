'use client'

// The skill-trust panel — ONE model, two zones. A finding's confidence decides
// where it renders; its mere existence never raises an alarm.
//
//   high (or registry quarantined) → the SAFETY card (red, NEVER blocks install)
//   low / medium                   → a chip in "What this skill can do"
//   none                           → no Safety card, just a calm "scanned" line
//
// 1. "What this skill can do" — a wrapping row of CHIPS (tabs). Neutral. Holds
//    every sub-serious signal in one scannable list: computed capabilities (Run
//    commands, Use internet, …), action findings (a low destructive folds into
//    the Delete-files chip; a standalone low exfil is its own "Send data out"
//    chip), AND content findings (prompt-injection, obfuscation, a maybe-secret)
//    as their own chips. Clicking a chip opens its detail — describe + file:line
//    evidence — once, below the row. A chip carries a caution marker ONLY as a
//    "look at Safety" signal (a registry-flagged capability, or a HIGH-confidence
//    finding tagged to it); a sub-serious finding never marks a chip.
//
// 2. "Safety" — the SERIOUS card. Renders ONLY when a high-confidence finding is
//    present (or the registry quarantined the skill). Red, names the concern, and
//    is still NON-BLOCKING — the install/use action stays available. It expands
//    into the serious warnings, each through its plain-English meaning (never the
//    raw category id or rule tag) plus file:line evidence. A skill with no serious
//    finding shows NO Safety card.
//
// Demotion changes framing, not visibility: every chip keeps its file:line + the
// flagged line, viewable on expand. There is NO safety score and the design never
// says "safe". Honesty states are mandatory: a partial scan says so, unscanned
// files are listed, and an inert skill renders a calm, un-carded line.
//
// Every attacker-controlled field (file paths, snippets, why-text) is a React
// text child — never dangerouslySetInnerHTML — so a crafted path can't inject.

import { useState } from 'react'
import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import type {
  BlindSpot,
  CapabilityAnalysis,
  SecurityFinding,
  SecurityStatus,
  SkillCapability,
  SkillCapabilityContributor,
} from '@/lib/types'
import { CAPABILITY_ORDER } from '@/lib/types'
import { skillHref, skillViewHref } from '@/lib/urls'
import {
  capabilityLabel,
  capabilityDescribe,
  findingCategory,
  findingCapability,
  findingShape,
} from '@/lib/scan-taxonomy'
import { revealFinding, baseName } from '@/components/security-tab'
import { pluralize } from '@/lib/format'
import { SKILL_ENTRYPOINT } from '@/lib/skill-bundle'
import {
  CapabilityIcon,
  FindingIcon,
  WarningGlyph,
} from '@/components/skills/trust-icons'

/** How we actually check — framing shown atop the expanded verdict. */
const HOW_WE_CHECK =
  'An automatic scan flags these patterns. It matches code and text, not intent, so false positives are common. Treat them as things to check, not a verdict.'

/** A single evidence location, normalized so capabilities and risk findings
 *  render through the exact same view. */
type EvidenceLoc = {
  file: string
  line?: number
  lineEnd?: number
  /** The flagged lines for inline review — resolved server-side from the bundle
   *  (skill page, ≤3 dedented lines; see lib/evidence-snippet) or registry-
   *  provided (kits). Rendered as an escaped React child. */
  snippet?: string
  /** Plain-English "why", shown under the line for a flagged location. */
  note?: string
  /** Aggregate (kit) mode: the member skill this flagged location came from, so
   *  the kit panel can group the evidence by skill and link to it. */
  skill?: { author: string; slug: string }
}

/**
 * The shared drill-down: locations grouped by file (the entrypoint SKILL.md
 * leads, matching the file viewer), the filename named once, then ONE code block
 * per file with a line-number gutter — like a GitHub blob, not a stack of boxes.
 * The non-contiguous line numbers make it read as picked-out lines; each row
 * permalinks into the viewer. Used by both capability rows and findings so the
 * two can never drift.
 */
/** How many evidence LOCATIONS to show before the "Show N more" fold — a
 *  location cap, not a file cap, so one chatty file (a SKILL.md with 20 flagged
 *  lines) can't blow up the preview on its own. */
const EVIDENCE_PREVIEW_LOCS = 6

function EvidenceLines({
  locations,
  hrefFor,
}: {
  locations: EvidenceLoc[]
  /** Kit (aggregate): build a cross-page deep-link to the source skill's viewer
   *  for a file (and line); rows render as links. Skill page: omit — rows fire the
   *  in-page revealFinding event instead (the on-page viewer). Either way the
   *  container, gutter, and dedent are identical. */
  hrefFor?: (file: string, line?: number) => string | undefined
}) {
  const byFile = new Map<string, EvidenceLoc[]>()
  for (const loc of locations) {
    const arr = byFile.get(loc.file) ?? []
    arr.push(loc)
    byFile.set(loc.file, arr)
  }
  const groups = [...byFile.entries()].sort(([a], [b]) =>
    a === SKILL_ENTRYPOINT ? -1 : b === SKILL_ENTRYPOINT ? 1 : 0,
  )
  // A broad capability can hit dozens of lines; cap the list to a glanceable
  // preview and expand the rest inline on demand. Cap by total LOCATION count —
  // take lines across as many file groups as fit and truncate the last group —
  // so one chatty file can't dominate. Applies to capabilities and findings.
  const [showAll, setShowAll] = useState(false)
  const shown: [string, EvidenceLoc[]][] = []
  let budget = showAll ? Infinity : EVIDENCE_PREVIEW_LOCS
  for (const [file, locs] of groups) {
    if (budget <= 0) break
    const take = locs.slice(0, budget)
    shown.push([file, take])
    budget -= take.length
  }
  const hiddenCount = locations.length - shown.reduce((n, [, locs]) => n + locs.length, 0)

  return (
    <div className="space-y-3">
      {shown.map(([file, locs]) => {
        // Gutter is sized to THIS block's widest line number (editor-style), so a
        // block of single-digit lines doesn't get a big empty cell while a 3-digit
        // block looks tight. tabular-nums + a ch width = exactly N digits wide.
        const maxDigits = Math.max(1, ...locs.map((l) => String(l.line ?? 0).length))
        const gutter = `${maxDigits}ch`
        const codeOffset = `calc(0.75rem + ${gutter} + 0.75rem)` // px-3 + gutter + gap-3
        const headerCls =
          'block w-full border-b border-(--line) bg-(--surface) px-3 py-1.5 text-left font-mono text-xs text-(--ink-2)'
        const fileHref = hrefFor?.(file)
        return (
          <div key={file} className="overflow-hidden rounded-lg border border-(--line)">
            {/* Filename header bar: opens the file (line 1). Skill page → in-page
                viewer event; kit → deep-link into that skill's viewer. */}
            {hrefFor ? (
              fileHref ? (
                <Link
                  href={fileHref}
                  aria-label={`Open ${file}`}
                  title={`Open ${file}`}
                  className={`${headerCls} transition-colors hover:text-(--accent)`}
                >
                  {file}
                </Link>
              ) : (
                <div className={headerCls}>{file}</div>
              )
            ) : (
              <button
                type="button"
                onClick={() => revealFinding(file, 1)}
                aria-label={`Open ${file}`}
                title={`Open ${file}`}
                className={`${headerCls} transition-colors hover:text-(--accent)`}
              >
                {file}
              </button>
            )}
            <div className="bg-(--bg) py-1 font-mono text-xs leading-[1.6]">
              {locs.map((loc, i) => {
                const code = loc.snippet ?? null
                const label = `${baseName(loc.file)}${loc.line != null ? `:${loc.line}` : ''}`
                const lineNo = loc.line != null && (
                  <span
                    style={{ width: gutter }}
                    className="shrink-0 select-none text-right tabular-nums text-(--ink-2)/50 transition-colors group-hover/ln:text-(--accent)"
                  >
                    {loc.line}
                  </span>
                )
                // Text child — React escapes it.
                const codeSpan = (
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-(--ink)">
                    {code ?? ''}
                  </span>
                )
                const rowCls = 'flex w-full items-baseline gap-3 px-3 py-0.5 text-left'
                const rowHover = 'group/ln transition-colors hover:bg-(--ink-2)/5'
                const rowHref = hrefFor?.(loc.file, loc.line)
                return (
                  <div key={`${loc.line ?? 0}:${i}`}>
                    {hrefFor ? (
                      rowHref ? (
                        <Link
                          href={rowHref}
                          aria-label={label}
                          title={label}
                          className={`${rowCls} ${rowHover}`}
                        >
                          {lineNo}
                          {codeSpan}
                        </Link>
                      ) : (
                        <div className={rowCls}>
                          {lineNo}
                          {codeSpan}
                        </div>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => revealFinding(loc.file, loc.line)}
                        aria-label={label}
                        title={label}
                        className={`${rowCls} ${rowHover}`}
                      >
                        {lineNo}
                        {codeSpan}
                      </button>
                    )}
                    {/* Per-line note: only when it's genuine prose, never the
                        scanner's raw rule id (e.g. "risky-call:js-child-process-
                        spawn-sync" — no spaces). The category meaning already shows
                        once above; a machine tag under every line is just noise.
                        Muted, not amber, so it reads as a quiet annotation. */}
                    {loc.note && /\s/.test(loc.note) && (
                      <p
                        style={{ paddingLeft: codeOffset }}
                        className="pb-1 pr-3 leading-[1.5] text-(--ink-2)"
                      >
                        {loc.note}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {locations.length > EVIDENCE_PREVIEW_LOCS && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="font-mono text-xs text-(--ink-2) transition-colors hover:text-(--ink)"
        >
          {showAll ? 'Show less' : `Show ${hiddenCount} more ${pluralize(hiddenCount, 'line')}`}
        </button>
      )}
    </div>
  )
}

/**
 * Aggregate (kit) mode evidence for a flagged finding. A kit has no single
 * bundle to point into, but the registry served the flagged `snippet` alongside
 * the scan we already fetched — so we render the actual flagged line(s) through
 * the SAME {@link EvidenceLines} the skill page uses (filename-header container,
 * line-number gutter), grouped under the member skill they came from (a link
 * into that skill's page for full context). Identical to the skill page, minus
 * the row-level permalinks (no on-page viewer — the skill link is the
 * navigation). Snippet withheld (secret/quarantined) → the file:line still
 * renders, just with a blank code cell. Text is a React child, so a crafted path
 * or snippet can't inject.
 */
function FindingEvidenceBySkill({ locations }: { locations: EvidenceLoc[] }) {
  const bySkill = new Map<
    string,
    { skill?: { author: string; slug: string }; locs: EvidenceLoc[] }
  >()
  for (const loc of locations) {
    const key = loc.skill ? `${loc.skill.author}/${loc.skill.slug}` : ''
    const group = bySkill.get(key) ?? { skill: loc.skill, locs: [] }
    group.locs.push(loc)
    bySkill.set(key, group)
  }

  return (
    <div className="flex flex-col gap-4">
      {[...bySkill.values()].map((group, gi) => (
        <div key={group.skill ? `${group.skill.author}/${group.skill.slug}` : `g${gi}`}>
          {group.skill && (
            <Link
              href={skillHref(group.skill.author, group.skill.slug)}
              className="mb-1.5 inline-flex items-center gap-1.5 font-mono text-sm text-(--ink) transition-colors hover:underline"
            >
              @{group.skill.author}/{group.skill.slug}
            </Link>
          )}
          <EvidenceLines
            locations={group.locs}
            hrefFor={
              group.skill
                ? (file, line) => skillViewHref(group.skill!.author, group.skill!.slug, file, line)
                : () => undefined
            }
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Aggregate (kit) mode evidence under an open PERMISSION row. Layer 1: the
 * flagged line(s) behind the row (snippet grouped by skill), so a cautioned
 * permission is judge-able. Layer 2: the remaining contributing skills as links —
 * the factual "who uses this" for a benign permission, and the fallback for a
 * flag whose snippet wasn't served. A skill shown in layer 1 is dropped from
 * layer 2 so it isn't named twice.
 */
function AggregateEvidence({
  flaggedLocations,
  skills,
}: {
  flaggedLocations: EvidenceLoc[]
  skills?: SkillCapabilityContributor[]
}) {
  const flaggedKeys = new Set(
    flaggedLocations.filter((l) => l.skill).map((l) => `${l.skill!.author}/${l.skill!.slug}`),
  )
  const otherSkills = (skills ?? []).filter((s) => !flaggedKeys.has(`${s.author}/${s.slug}`))
  if (flaggedLocations.length === 0 && otherSkills.length === 0) return null

  return (
    <div className="mt-3 flex flex-col gap-3">
      {flaggedLocations.length > 0 && <FindingEvidenceBySkill locations={flaggedLocations} />}
      {otherSkills.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {otherSkills.map((s) => (
            <li key={`${s.author}/${s.slug}`}>
              <Link
                href={skillHref(s.author, s.slug)}
                className={`inline-flex items-center gap-1.5 text-sm transition-colors hover:underline ${
                  s.risky ? 'text-(--warning)' : 'text-(--ink)'
                }`}
              >
                <span className="font-mono">
                  @{s.author}/{s.slug}
                </span>
                {s.risky && <span className="text-xs text-(--warning)">flagged</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The "Unscanned files" body: a plain list of files the scanner couldn't read
 * (no lines/snippet — they were never inspected). Same filename-row styling as
 * the evidence headers, but no code block. Skill page: each row reveals the file
 * in the on-page viewer. Kit: grouped by member skill, each row deep-links into
 * that skill's viewer. Text is a React child, so a crafted path can't inject.
 */
/** The kit members with no computed report — each links to its skill page, so a
 *  reader can go check what isn't covered. Mirrors {@link BlindSpotList}'s rows. */
/**
 * One-line disclosure for the quiet honesty area.
 *
 * These lists are long (a template-heavy skill contributes a dozen unreadable
 * files) and are rarely why someone opened the panel, so a full-height list
 * pushed the actual verdict off-screen. The COUNT is the signal and leads; the
 * list itself is one click away. Collapsed is the default, never hidden.
 */
function QuietDisclosure({
  label,
  note,
  children,
}: {
  label: string
  note: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-sm leading-[1.5] text-(--ink-2)"
      >
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="font-semibold text-(--ink)">{label}</span>
        <span className="min-w-0 truncate">{note}</span>
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </div>
  )
}

function UnscannedSkillList({ skills }: { skills: { author: string; slug: string }[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-(--line)">
      {skills.map((s) => (
        <Link
          key={`${s.author}/${s.slug}`}
          href={skillHref(s.author, s.slug)}
          className="block w-full border-b border-(--line) bg-(--surface) px-3 py-1.5 text-left font-mono text-xs text-(--ink-2) transition-colors last:border-b-0 hover:text-(--accent)"
        >
          @{s.author}/{s.slug}
        </Link>
      ))}
    </div>
  )
}

function BlindSpotList({ files, aggregate }: { files: BlindSpot[]; aggregate: boolean }) {
  const rowCls =
    'block w-full border-b border-(--line) text-left last:border-b-0 bg-(--surface) px-3 py-1.5 font-mono text-xs text-(--ink-2) transition-colors hover:text-(--accent)'

  if (!aggregate) {
    // Skill page: flat list; clicking reveals the file in the on-page viewer.
    return (
      <div className="overflow-hidden rounded-lg border border-(--line)">
        {files.map((b, i) => (
          <button
            key={`${b.file}:${i}`}
            type="button"
            onClick={() => revealFinding(b.file, 1)}
            aria-label={`Open ${b.file}`}
            title={`Open ${b.file}`}
            className={rowCls}
          >
            {b.file}
          </button>
        ))}
      </div>
    )
  }

  // Kit: group by source skill; each file deep-links into that skill's viewer.
  const bySkill = new Map<string, { skill?: { author: string; slug: string }; files: string[] }>()
  for (const b of files) {
    const key = b.skill ? `${b.skill.author}/${b.skill.slug}` : ''
    const group = bySkill.get(key) ?? { skill: b.skill, files: [] }
    group.files.push(b.file)
    bySkill.set(key, group)
  }
  return (
    <div className="flex flex-col gap-3">
      {[...bySkill.values()].map((group, gi) => (
        <div key={group.skill ? `${group.skill.author}/${group.skill.slug}` : `g${gi}`}>
          {group.skill && (
            <Link
              href={skillHref(group.skill.author, group.skill.slug)}
              className="mb-1.5 inline-flex font-mono text-sm text-(--ink) transition-colors hover:underline"
            >
              @{group.skill.author}/{group.skill.slug}
            </Link>
          )}
          <div className="overflow-hidden rounded-lg border border-(--line)">
            {group.files.map((file, i) =>
              group.skill ? (
                <Link
                  key={`${file}:${i}`}
                  href={skillViewHref(group.skill.author, group.skill.slug, file)}
                  className={rowCls}
                >
                  {file}
                </Link>
              ) : (
                <div key={`${file}:${i}`} className={rowCls}>
                  {file}
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function TrustPanel({
  capabilities,
  analysis,
  findings,
  blindSpots,
  unscannedSkills,
  unavailableSkills,
  status,
  source,
  aggregate = false,
}: {
  /** Four-state contract: `undefined`/`null` = never computed; `[]` = computed,
   *  none found; non-empty = the detected manifest. */
  capabilities?: SkillCapability[] | null
  analysis?: CapabilityAnalysis | null
  /** Threat findings, skill page only on a single skill; the union (per member)
   *  on a kit. Every finding surfaces in the Safety verdict; a finding tagged to a
   *  present permission ALSO marks that permission with a caution glyph. */
  findings?: SecurityFinding[]
  /** Files the scanner couldn't inspect (the detail behind a `partial` analysis).
   *  Surfaced as the "Unscanned files" list inside the verdict. Skill page:
   *  `{ file }` (reveal in-viewer). Kit: `{ file, skill }` (deep-link per member). */
  blindSpots?: BlindSpot[]
  /** Aggregate (kit) mode: member skills with no computed report at all. They are
   *  what actually drives a `partial` roll-up when no blind-spot files exist, so
   *  the panel names them ("not yet scanned") instead of implying unreadable files. */
  unscannedSkills?: { author: string; slug: string }[]
  /** Aggregate (kit) mode: member skills with NO installable version, so the kit
   *  resolves no hash for them. They were scanned; every version was held or
   *  withdrawn. Kept apart from `unscannedSkills` because "not yet scanned" says
   *  the opposite of what happened to them. */
  unavailableSkills?: { author: string; slug: string }[]
  /** The registry's authoritative scan verdict for a SINGLE skill. When present it
   *  is OR'd with finding confidence so a quarantined skill reads "Blocked" even
   *  when its served findings aren't high-confidence (e.g. withheld secrets).
   *  Omit on a kit (aggregate mode) — there's no single registry status, so the
   *  verdict stays finds-derived, exactly as before. */
  status?: SecurityStatus
  /** Minor-trust marks (signed / basic eval), floated right of the lead eyebrow. */
  source?: React.ReactNode
  /** Kit/union mode: capabilities are aggregated across member skills, so there's
   *  no single codebase to point into — a permission row lists its contributing
   *  member skills, and findings deep-link into the member they came from. */
  aggregate?: boolean
}) {
  // One chip's detail opens at a time; the Safety card expands on its own.
  const [openCap, setOpenCap] = useState<string | null>(null)
  const [verdictOpen, setVerdictOpen] = useState(false)
  const toggleCap = (k: string) => setOpenCap((cur) => (cur === k ? null : k))

  const caps = Array.isArray(capabilities) ? capabilities : null
  const finds = findings ?? []
  const blinds = blindSpots ?? []
  const unscanned = unscannedSkills ?? []
  const unavailable = unavailableSkills ?? []
  // Nothing computed, nothing flagged, nothing unscanned — make no claim either
  // way. EXCEPT a quarantined verdict: the registry condemned this skill even
  // though it served no capabilities/findings/blind-spots (withheld secrets), so
  // it must still reach the Safety card below, never render as nothing.
  if (
    caps === null &&
    finds.length === 0 &&
    blinds.length === 0 &&
    status !== 'quarantined'
  )
    return null

  const capList = caps ?? []
  const partial = analysis === 'partial'

  // Normalize a finding into an evidence location carrying its flagged snippet +
  // source skill (aggregate mode), so it renders the same wherever it lands.
  const findingLoc = (f: SecurityFinding): EvidenceLoc => ({
    file: f.file,
    line: typeof f.line === 'number' ? f.line : undefined,
    snippet: f.snippet,
    note: f.why,
    skill: f.skill,
  })

  // --- Zone partition (computed once; shared by the skill + kit render paths).
  // Confidence decides the zone. high → Safety; low/med · action → a neutral
  // capability row; low/med · content → the "Also noticed" note. Existence alone
  // never alarms. The registry `quarantined` verdict is authoritative: it IS the
  // serious tier, so when set, ALL served findings surface in the Safety card
  // (a withheld-secret report can serve only sub-serious rows yet still be
  // quarantined), and the sub-serious zones stay empty.
  // Used capabilities only, in canonical order. Absence is silent — we never
  // render a "not used" row. Computed before the finding partition so a finding
  // can be folded away when the capabilities already describe it.
  const used = CAPABILITY_ORDER.map((key) => capList.find((c) => c.capability === key)).filter(
    (c): c is SkillCapability => Boolean(c),
  )
  const presentCaps = new Set(used.map((c) => c.capability))

  // A `curl … | sh` (exfil:fetch-pipe-shell) is fully described by the two
  // capabilities it implies — "Use the internet" + "Run commands". When BOTH are
  // already shown, its own "Send data out" chip is redundant, so fold it away and
  // let the capabilities carry it — fewer chips, nothing lost. (A high-confidence
  // fetch-pipe-shell in a real script stays: it's serious, not a sub-serious chip.)
  const foldedRedundant = (f: SecurityFinding) =>
    f.confidence !== 'high' &&
    f.why === 'exfil:fetch-pipe-shell' &&
    presentCaps.has('network') &&
    presentCaps.has('runs-shell')
  const scanFinds = finds.filter((f) => !foldedRedundant(f))

  const quarantined = status === 'quarantined'
  const seriousFinds = quarantined ? scanFinds : scanFinds.filter((f) => f.confidence === 'high')
  const subSerious = quarantined ? [] : scanFinds.filter((f) => f.confidence !== 'high')
  const actionFinds = subSerious.filter((f) => findingShape(f.category) === 'action')
  const noticedFinds = subSerious.filter((f) => findingShape(f.category) === 'content')

  // Sub-serious action findings inform in "What this skill can do": fold into the
  // present permission they duplicate, else stand as their own calm row.
  const foldedByCap = new Map<string, SecurityFinding[]>()
  const standaloneByCat = new Map<string, SecurityFinding[]>()
  for (const f of actionFinds) {
    const permKey = findingCapability(f.category)
    if (permKey && presentCaps.has(permKey)) {
      const arr = foldedByCap.get(permKey) ?? []
      arr.push(f)
      foldedByCap.set(permKey, arr)
    } else {
      const arr = standaloneByCat.get(f.category) ?? []
      arr.push(f)
      standaloneByCat.set(f.category, arr)
    }
  }
  const standaloneRows = [...standaloneByCat.entries()]
  // "What this skill can do" carries every sub-serious signal as a chip: computed
  // capabilities, standalone action findings, AND content findings (prompt-
  // injection, obfuscation, …). Only SERIOUS findings break out into the Safety
  // card. So one scannable list instead of a list plus a separate note.
  const hasChips = used.length > 0 || standaloneRows.length > 0 || noticedFinds.length > 0

  // The Safety card renders only for a serious finding (or the registry
  // quarantined the skill — the withheld-secret case has no served high finding).
  const serious = seriousFinds.length > 0 || quarantined

  // A permission row's caution marker is purely a "look at Safety below" pointer,
  // so it only makes sense when the Safety card is actually rendered. When nothing
  // is serious there is no card to point at — a marker there would alarm on a skill
  // we just called fine. So the set is empty unless `serious`; then a row is marked
  // when the registry flagged the capability or a high-confidence finding is tagged
  // to it. A sub-serious finding NEVER marks a row (it informs in place instead).
  const cautioned = new Set<string>()
  if (serious) {
    for (const c of capList) if (c.risky) cautioned.add(c.capability)
    for (const f of seriousFinds) {
      const k = findingCapability(f.category)
      if (k && presentCaps.has(k)) cautioned.add(k)
    }
  }

  // Serious warnings, grouped by category. All high-confidence, so order is by
  // group size (most-evidence first), then declaration order.
  const seriousMap = new Map<string, SecurityFinding[]>()
  for (const f of seriousFinds) {
    const arr = seriousMap.get(f.category) ?? []
    arr.push(f)
    seriousMap.set(f.category, arr)
  }
  const seriousGroups = [...seriousMap.entries()]
    .map(([category, list]) => ({ category, list }))
    .sort((a, b) => b.list.length - a.list.length)
  const safetyExpandable = seriousGroups.length > 0

  // "Scanned" = the threat scan actually ran. Inert: nothing computed, nothing
  // flagged, nothing unscanned — a calm line, no cards. NEVER inert when serious:
  // a quarantined skill with no served data must show the red Safety card, not the
  // benign "Just instructions" line (`serious` gates the Safety card on `!showInert`).
  const scanned =
    analysis === 'full' || analysis === 'partial' || finds.length > 0 || blinds.length > 0
  const showInert = !hasChips && finds.length === 0 && blinds.length === 0 && !serious

  const iconCls = (caution: boolean) =>
    `h-[18px] w-[18px] shrink-0 transition-colors ${
      caution ? 'text-(--warning)' : 'text-(--ink-2) group-hover:text-(--ink)'
    }`

  // The minor-trust marks ride the lead eyebrow (Permissions, or Safety when a
  // serious skill has no capabilities of its own).
  const sourceNode = source ? <div className="min-w-0 shrink-0">{source}</div> : null

  // Mode-aware evidence for a set of findings: skill page renders the actual
  // flagged lines (revealable); a kit groups by source member skill. A plain
  // function (called inline, not as <ZoneEvidence/>) so it doesn't define a new
  // component type each render and remount the evidence subtree on every toggle.
  const zoneEvidence = (list: SecurityFinding[]) =>
    aggregate ? (
      <FindingEvidenceBySkill locations={list.map(findingLoc)} />
    ) : (
      <EvidenceLines locations={list.map(findingLoc)} />
    )

  // Name the serious concern(s) in the Safety line — cap at two + "+N more".
  // seriousNames is empty only when seriousFinds is (findingCategory always
  // labels), so a quarantined withheld-secret report falls to the generic line.
  const seriousNames = seriousGroups.map((g) => findingCategory(g.category).label)
  const shownSerious =
    seriousNames.length <= 2
      ? seriousNames.join(', ')
      : `${seriousNames.slice(0, 2).join(', ')} +${seriousNames.length - 2} more`
  const safetyLabel =
    seriousNames.length > 0 ? `Serious: ${shownSerious}` : 'Serious: review carefully'

  // The passive "Scanned, nothing serious" acknowledgement line was removed — an
  // all-clear with no finding earns nothing, and the permission chips already
  // carry the signal. The unscanned-files + partial-scan honesty below stays.
  // Content findings grouped by category for the "Also noticed" note. The names
  // for the collapsed label come straight off the groups (one per category), so
  // the label order matches the render order — cap at two + "+N more".
  const noticedMap = new Map<string, SecurityFinding[]>()
  for (const f of noticedFinds) {
    const arr = noticedMap.get(f.category) ?? []
    arr.push(f)
    noticedMap.set(f.category, arr)
  }
  const noticedGroups = [...noticedMap.entries()].map(([category, list]) => ({ category, list }))

  // "What this skill can do" is a wrapping row of chips (tabs), not a stack of
  // full-width rows — the open chip's detail shows once, below the row. Computed
  // capabilities, standalone action findings, and content findings all share the
  // row; only serious findings break out into the Safety card.
  type ChipItem =
    | { key: string; kind: 'cap'; cap: SkillCapability }
    | { key: string; kind: 'flag'; category: string; list: SecurityFinding[] }
  // Permission chips = what the skill can DO/access: computed capabilities plus
  // sub-serious ACTION findings (they describe an action, so they belong with the
  // permissions). Flag chips = CONTENT findings (prompt-injection, obfuscation, a
  // maybe-secret) — the scanner noticed them in the files; they are NOT permissions,
  // so they sit apart under a quiet "Flagged" label.
  const permChips: ChipItem[] = [
    ...used.map((cap): ChipItem => ({ key: `cap:${cap.capability}`, kind: 'cap', cap })),
    ...standaloneRows.map(
      ([category, list]): ChipItem => ({ key: `flag:${category}`, kind: 'flag', category, list }),
    ),
  ]
  const flagChips: ChipItem[] = noticedGroups.map(
    ({ category, list }): ChipItem => ({ key: `flag:${category}`, kind: 'flag', category, list }),
  )
  // ONE Permissions list (design "Option A"): the "worth a look" items — flagged
  // findings, plus any capability a SERIOUS finding is tagged to — sort to the
  // front in a caution tint; the routine capabilities follow, plain. This
  // replaces the old split (a permissions row + a separate muted "Flagged" row)
  // that put a ⚠ in two places and read as two competing sections.
  //
  // A capability is cautioned ONLY when a high-confidence finding is tied to it
  // (`serious-tagged`) — the cross-reference to the Safety card. It is NOT
  // cautioned by `capability.risky`, which means "evidence overlaps ANY finding"
  // and at kit-aggregate scale lights up most of the list (a single member's
  // overlap flips the union), reading as noise.
  const seriousTaggedCaps = new Set<string>()
  for (const f of seriousFinds) {
    const k = findingCapability(f.category)
    if (k && presentCaps.has(k)) seriousTaggedCaps.add(k)
  }
  // A capability is cautioned when a serious finding is tied to it, OR (single
  // skill only) it's a registry-risky capability while something serious is
  // present. In AGGREGATE (kit) mode `risky` is skipped: it means "evidence
  // overlaps ANY member's finding", so the union lights up most of the list.
  const capCaution = (cap: SkillCapability): boolean =>
    seriousTaggedCaps.has(cap.capability) || (serious && !aggregate && cap.risky === true)
  const isCautionChip = (it: ChipItem): boolean =>
    it.kind === 'flag' || capCaution(it.cap)
  const orderedChips: ChipItem[] = [...permChips, ...flagChips].sort(
    (a, b) => Number(isCautionChip(b)) - Number(isCautionChip(a)),
  )
  const openChip = orderedChips.find((it) => it.key === openCap) ?? null

  const renderChip = (it: ChipItem) => {
    const open = openCap === it.key
    const caution = isCautionChip(it)
    const label =
      it.kind === 'cap' ? capabilityLabel(it.cap.capability) : findingCategory(it.category).label
    return (
      <button
        key={it.key}
        type="button"
        onClick={() => toggleCap(it.key)}
        aria-expanded={open}
        data-caution={caution}
        data-open={open}
        // Caution chips carry a soft amber tint (border + fill + icon) — a "this
        // is more sensitive" cue, not a verdict. The open state's accent fill is
        // listed AFTER the caution fill so it wins when a caution chip is open.
        // Active state is a FILL + accent text, never a thin contrasting outline:
        // a 1px accent border renders unevenly at fractional zoom.
        className="group inline-flex items-center gap-1.5 rounded-lg border border-(--line) px-2.5 py-1.5 text-sm text-(--ink) transition-colors data-[caution=true]:border-(--warning-line)/40 data-[caution=true]:bg-(--warning-bg) hover:bg-(--accent-bg) data-[open=true]:bg-(--accent-bg) data-[open=true]:text-(--accent)"
      >
        {it.kind === 'cap' ? (
          <CapabilityIcon capability={it.cap.capability} className={iconCls(caution)} />
        ) : (
          <FindingIcon category={it.category} className={iconCls(caution)} />
        )}
        <span className="min-w-0">{label}</span>
      </button>
    )
  }

  return (
    <section className="space-y-8">
      {/* --- Permissions: what the skill can access + any content flags --- */}
      {hasChips ? (
        <div>
          <div className="flex items-baseline justify-between gap-x-4">
            <Eyebrow>Permissions</Eyebrow>
            {sourceNode}
          </div>
          {/* Wrapping chip row — compact, scannable. Each chip toggles its detail
              in the one panel below (tab behavior), so a long list stays a couple
              of rows instead of a tall stack. */}
          {/* ONE list: cautionary items (sensitive capabilities + flagged
              findings) first in a caution tint, routine capabilities after. */}
          {orderedChips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {orderedChips.map((it) => renderChip(it))}
            </div>
          )}

          {/* The open chip's detail — describe + evidence — shown once below the row. */}
          {openChip &&
            (() => {
              if (openChip.kind === 'cap') {
                const cap = openChip.cap
                const describe = capabilityDescribe(cap.capability)
                const capLocs: EvidenceLoc[] = cap.evidence.map((e) => ({
                  file: e.file,
                  line: e.lineStart,
                  lineEnd: e.lineEnd,
                  snippet: e.snippet,
                }))
                // A folded sub-serious action finding adds its flagged line here —
                // neutral, no marker. Carries the "why" annotation.
                const foldLocs = (foldedByCap.get(cap.capability) ?? []).map(findingLoc)
                const locations = [...capLocs, ...foldLocs]
                const skillCount = cap.skills?.length ?? 0
                // File count, not raw location count: "55 places" over-signals
                // (many are prose mentions in SKILL.md); the number of files it
                // touches is the honest, tangible scope.
                const fileCount = new Set(locations.map((l) => l.file)).size
                const countLabel = aggregate
                  ? skillCount > 0
                    ? `${skillCount} ${pluralize(skillCount, 'skill')}`
                    : null
                  : `${fileCount} ${pluralize(fileCount, 'file')}`
                return (
                  <Panel className="mt-3 p-4 sm:p-5">
                    {(describe || countLabel) && (
                      <div className="flex items-baseline justify-between gap-x-4">
                        {describe ? (
                          <p className="max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">
                            {describe}
                          </p>
                        ) : (
                          <span />
                        )}
                        {countLabel && (
                          <span className="shrink-0 text-xs text-(--ink-2)">{countLabel}</span>
                        )}
                      </div>
                    )}
                    {aggregate ? (
                      <AggregateEvidence flaggedLocations={foldLocs} skills={cap.skills} />
                    ) : locations.length > 0 ? (
                      <div className="mt-3.5">
                        <EvidenceLines locations={locations} />
                      </div>
                    ) : null}
                  </Panel>
                )
              }
              const meta = findingCategory(openChip.category)
              return (
                <Panel className="mt-3 p-4 sm:p-5">
                  {meta.describe && (
                    <p className="max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">
                      {meta.describe}
                    </p>
                  )}
                  <div className="mt-3.5">{zoneEvidence(openChip.list)}</div>
                </Panel>
              )
            })()}
        </div>
      ) : showInert ? (
        // Inert: computed, nothing to run. Keep the section header for consistency
        // with every other skill — the answer to "what can it do?" is just the calm
        // line — but no card, no chips.
        <div>
          <div className="flex items-baseline justify-between gap-x-4">
            <Eyebrow>Permissions</Eyebrow>
            {sourceNode}
          </div>
          <p className="mt-3 text-sm leading-[1.5] text-(--ink-2)">
            {partial
              ? "Some files couldn't be scanned, so this may be incomplete."
              : 'Just instructions. No commands, network, or file access.'}
          </p>
        </div>
      ) : null}

      {/* --- Safety card: SERIOUS findings only. Red, names the concern, never
          blocks the install. No card at all when nothing serious. --- */}
      {serious && !showInert && (
        <div>
          <div className="flex items-baseline justify-between gap-x-4">
            <Eyebrow>Safety</Eyebrow>
            {!hasChips && sourceNode}
          </div>
          <Panel padding="none" className="mt-3">
            <div className="p-3.5 sm:p-4">
              {safetyExpandable ? (
                <button
                  type="button"
                  onClick={() => setVerdictOpen((p) => !p)}
                  aria-expanded={verdictOpen}
                  data-status="serious"
                  className="group flex w-full items-center gap-2.5 text-left text-sm text-(--ink)"
                >
                  <WarningGlyph className="h-[18px] w-[18px] shrink-0 text-(--danger)" />
                  <span className="flex-1 font-semibold">{safetyLabel}</span>
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={`shrink-0 text-(--ink-2) transition-transform duration-200 ${
                      verdictOpen ? 'rotate-90' : ''
                    }`}
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
              ) : (
                <div
                  data-status="serious"
                  className="flex items-center gap-2.5 text-sm text-(--ink)"
                >
                  <WarningGlyph className="h-[18px] w-[18px] shrink-0 text-(--danger)" />
                  <span className="font-semibold">{safetyLabel}</span>
                </div>
              )}
              {/* Non-blocking is the whole point: serious doesn't gate the install. */}
              <p className="mt-2 text-xs leading-[1.5] text-(--ink-2)">
                This doesn&rsquo;t block the install. It&rsquo;s a warning to review before you use
                the skill.
              </p>
            </div>

            {verdictOpen && safetyExpandable && (
              <div className="space-y-4 border-t border-(--line) px-4 pb-4 pt-4 sm:px-5">
                <p className="max-w-[68ch] text-xs leading-[1.5] text-(--ink-2)">{HOW_WE_CHECK}</p>

                {seriousGroups.map((g) => {
                  const meta = findingCategory(g.category)
                  return (
                    <div key={g.category} className="flex gap-2.5">
                      <FindingIcon
                        category={g.category}
                        className="mt-0.5 h-[18px] w-[18px] shrink-0 text-(--danger)"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-(--ink)">{meta.label}</p>
                        {meta.describe && (
                          <p className="mt-0.5 max-w-[68ch] text-sm leading-[1.5] text-(--ink-2)">
                            {meta.describe}
                          </p>
                        )}
                        <div className="mt-2.5">
                          {zoneEvidence(g.list)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* --- Quiet honesty: the partial fallback, the not-yet-scanned member list,
          and the unscanned-files list. --- */}
      {scanned && !showInert && (blinds.length > 0 || partial) && (
        <div className="space-y-2">
          {/* Not-yet-scanned members drive `partial` when there are no blind-spot
              files. Name them (accurate) instead of implying unreadable files. */}
          {unscanned.length > 0 && (
            <QuietDisclosure
              label={
                unscanned.length === 1 ? '1 skill not yet scanned' : `${unscanned.length} skills not yet scanned`
              }
              note="so this may be incomplete"
            >
              <UnscannedSkillList skills={unscanned} />
            </QuietDisclosure>
          )}

          {/* Held / withdrawn members. They WERE scanned, so they never belong in
              the line above. Cause stays unstated: a scanner hold and a yank both
              land here, and the panel can't tell them apart from a null hash. */}
          {unavailable.length > 0 && (
            <QuietDisclosure
              label={
                unavailable.length === 1
                  ? '1 skill with no installable version'
                  : `${unavailable.length} skills with no installable version`
              }
              note="held or withdrawn, so nothing to include"
            >
              <UnscannedSkillList skills={unavailable} />
            </QuietDisclosure>
          )}

          {/* Unscanned files — unverified, not flagged. Listed for honesty. */}
          {blinds.length > 0 && (
            <QuietDisclosure
              label={blinds.length === 1 ? '1 unscanned file' : `${blinds.length} unscanned files`}
              note={"in formats the scan couldn\u2019t read"}
            >
              <BlindSpotList files={blinds} aggregate={aggregate} />
            </QuietDisclosure>
          )}

          {/* Partial with nothing nameable behind it. */}
          {partial && blinds.length === 0 && unscanned.length === 0 && unavailable.length === 0 && (
            <p className="text-xs leading-[1.5] text-(--ink-2)">
              This may be incomplete, since not everything could be scanned.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
