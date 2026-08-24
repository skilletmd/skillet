// How a scan finding is presented on the web — backed by the ONE scanner
// vocabulary in `@skillet/protocol` (`scan-vocabulary.ts`). The registry emits
// raw ids: a finding's `category` is a FLAGS key, a capability is a PERMISSIONS
// key. Every copy lookup here is therefore a DIRECT id lookup — no keyword
// matching, no synthetic catalog. Plain-English copy lives in the protocol; the
// web only renders it.
//
// Each FLAGS entry carries:
//   - label    — the name shown on every surface (skill page, updates, editor)
//   - describe — installer voice: what the pattern IS ("should I trust this?")
//   - fix      — author voice: how to fix / what to check ("ship-ready?")
// PERMISSIONS entries carry label + describe (installer voice; no fix).
//
// The SEVERITY scale below is presentation-only (driven by finding confidence)
// and stays in the web — it is not part of the shared vocabulary.

import { FLAGS, PERMISSIONS } from '@skillet/protocol'
import type { CapabilityKey, FindingConfidence } from './types'

export type { FindingConfidence }

/** Confidence rank for worst-first ordering, shared by every finding surface
 *  (the trust panel and the security tab) so they sort identically. */
export const CONFIDENCE_RANK: Record<FindingConfidence, number> = { low: 0, medium: 1, high: 2 }

/** The worst confidence across a set of findings (seeded at 'low'), via
 *  CONFIDENCE_RANK. Shared by the trust panel and the security tab so they derive
 *  the verdict severity identically. Empty set → 'low'. */
export function highestConfidence(
  findings: ReadonlyArray<{ confidence: FindingConfidence }>,
): FindingConfidence {
  return findings.reduce<FindingConfidence>(
    (acc, f) => (CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK[acc] ? f.confidence : acc),
    'low',
  )
}

export interface CategoryMeta {
  /** Plain-English name, identical on every surface. */
  label: string
  /** Installer-facing: what the pattern is. */
  describe: string
  /** Author-facing: how to fix it or what to confirm. */
  fix: string
}

/** Fallback copy for an id absent from the vocabulary (a true-unknown category
 *  the protocol doesn't describe). Reachable only when a finding's `category`
 *  matches no FLAGS entry. */
export const GENERIC: Omit<CategoryMeta, 'label'> = {
  describe: 'A pattern the scanner flags for a person to review.',
  fix: 'Read this line and confirm it’s intentional.',
}

/** Resolve a raw scanner category onto its presentation. A finding's `category`
 *  is a FLAGS id, so this is a direct lookup; an id with no vocabulary entry
 *  falls back to GENERIC with a humanized label. */
export function findingCategory(category: string): CategoryMeta {
  const entry = FLAGS[category]
  if (entry) {
    return { label: entry.label, describe: entry.describe, fix: entry.fix ?? '' }
  }
  return {
    label: category.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    ...GENERIC,
  }
}

/**
 * The capability an ACTION finding duplicates, so the trust panel folds it into
 * that capability (turning the capability amber) instead of showing a second,
 * near-identical chip. This is now the data tag on the vocabulary entry
 * (`FLAGS[category].permission`), not keyword logic: `destructive` →
 * `deletes-files`, `risky-call` → `runs-shell`. Returns null for findings with
 * no capability home (prompt injection, a hardcoded secret, a vulnerable dep,
 * obfuscation, agency, privilege, exfil) — those keep their own standalone chip.
 */
export function findingCapability(category: string): CapabilityKey | null {
  return (FLAGS[category]?.permission as CapabilityKey | undefined) ?? null
}

/**
 * Whether a finding describes something the skill DOES (`action` — fold a
 * sub-serious form into "What this skill can do") or a property of the files
 * (`content` — a sub-serious form goes to the quiet "also noticed" note). Read
 * straight off the vocabulary entry's `shape` tag (`FLAGS[category].shape`), the
 * single source of truth. An id with no vocabulary entry defaults to `content`
 * so an unrecognized sub-serious finding lands in the quiet note rather than
 * masquerading as a capability the skill has. High-confidence findings ignore
 * shape entirely — they always surface in the Safety card.
 */
export function findingShape(category: string): 'action' | 'content' {
  return FLAGS[category]?.shape ?? 'content'
}

/** Resolve a capability key to its installer-voice label, with a readable
 *  fallback for any future key not yet in the vocabulary. */
export function capabilityLabel(key: string): string {
  return (
    PERMISSIONS[key]?.label ??
    key.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
  )
}

/** One plain-English line per capability — "what this means" — shown when a chip
 *  is opened, benign or flagged. Neutral voice (the risk note, if any, is separate
 *  and amber). Drawn from the protocol PERMISSIONS vocabulary. */
export function capabilityDescribe(key: string): string | null {
  return PERMISSIONS[key]?.describe ?? null
}

/** The traffic-light severity scale — one consistent word, dot color, and faint
 *  row tint per confidence, shared by every surface. Amber is a brighter hue than
 *  red, so the red wash carries more weight to keep blockers reading strongest.
 *  Presentation-only (driven by finding confidence); not part of the shared
 *  vocabulary. */
export const SEVERITY: Record<FindingConfidence, { label: string; dot: string; tint: string }> = {
  low: { label: 'Minor', dot: 'bg-amber-300', tint: 'bg-amber-300/5' },
  medium: { label: 'Moderate', dot: 'bg-(--caution)', tint: 'bg-(--caution)/5' },
  high: { label: 'Serious', dot: 'bg-(--danger)', tint: 'bg-(--danger)/10' },
}
