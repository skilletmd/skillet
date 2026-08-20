// Pure view-model for the /lab/scanner audit page. Kept out of page.tsx so the
// row assembly + gate are unit-testable without rendering a server component.
//
// One vocabulary, two lanes: Permissions (what a skill CAN do — the 7
// capabilities) and Flags (the threat categories). Both are read from the
// protocol `SCAN_VOCABULARY` and cross-referenced against the committed detector
// inventory, with the lint's findings attached inline to the offending row.

import {
  PERMISSIONS,
  FLAGS,
  PERMISSION_ORDER,
  SCAN_VOCABULARY,
} from '@skillet/protocol'
import {
  lintTaxonomy,
  type DetectorManifest,
  type LintFinding,
  type Vocabulary,
} from '@/lib/scan-taxonomy-lint'

/** /lab/scanner is dev-only: it exposes the scanner's detector vocabulary +
 *  coverage gaps, which we don't surface publicly. Blocked in production (the
 *  page calls notFound()). Other /lab tools stay noindex+unlinked only. */
export function labScannerBlocked(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'production'
}

/** One vocabulary row — copy + its detector cross-reference + inline lint. */
export interface VocabRow {
  /** Which lane this id belongs to — the single table's Type column. */
  kind: 'permission' | 'flag'
  /** The emitted id (capability id or threat-category id). */
  id: string
  label: string
  describe: string
  /** Author-facing fix — flags only; null for permissions. */
  fix: string | null
  /** Emitting detector ids from the inventory (flags only; permissions carry no
   *  per-capability breakdown, so this is empty for them). */
  detectors: string[]
  /** True when at least one detector emits this id per the inventory. */
  emitted: boolean
  /** True when the detector builds its why tags dynamically (can't enumerate). */
  partial: boolean
  findings: LintFinding[]
}

export interface ScannerAudit {
  summary: { error: number; warn: number; info: number; total: number }
  /** The whole vocabulary as ONE list — permissions first, then flags — for the
   *  single-table render. `permissions`/`flags` are the same rows split by kind. */
  rows: VocabRow[]
  permissions: VocabRow[]
  flags: VocabRow[]
}

/** The real protocol vocabulary wired into the lint's injectable shape. */
export function realVocabulary(): Vocabulary {
  return SCAN_VOCABULARY
}

/**
 * Assemble the audit view-model: run the lint, then group every finding onto the
 * vocabulary row it targets (`permission:` / `flag:`), so the page renders each
 * issue inline on the offending entry.
 */
export function buildScannerAudit(vocabulary: Vocabulary, manifest: DetectorManifest): ScannerAudit {
  const findings = lintTaxonomy(vocabulary, manifest)
  const byTarget = new Map<string, LintFinding[]>()
  for (const f of findings) {
    const list = byTarget.get(f.target) ?? []
    list.push(f)
    byTarget.set(f.target, list)
  }
  const at = (target: string) => byTarget.get(target) ?? []

  const emittedCaps = new Set(manifest.capabilities)
  const partialSet = new Set(manifest.partialDetectors)

  // Permissions — the capabilities, in canonical chip order.
  const permissions: VocabRow[] = PERMISSION_ORDER.map((id) => {
    const entry = vocabulary[id] ?? PERMISSIONS[id]
    return {
      kind: 'permission' as const,
      id,
      label: entry?.label ?? id,
      describe: entry?.describe ?? '',
      fix: null,
      detectors: [],
      emitted: emittedCaps.has(id),
      partial: partialSet.has(id),
      findings: at(`permission:${id}`),
    }
  })

  // Flags — the threat categories, alphabetical for a stable scan.
  const flags: VocabRow[] = Object.keys(FLAGS)
    .sort()
    .map((id) => {
      const entry = vocabulary[id] ?? FLAGS[id]
      const inv = manifest.threatCategories[id]
      return {
        kind: 'flag' as const,
        id,
        label: entry?.label ?? id,
        describe: entry?.describe ?? '',
        fix: entry?.fix ?? null,
        detectors: inv?.detectors ?? [],
        emitted: Boolean(inv),
        partial: partialSet.has(id),
        findings: at(`flag:${id}`),
      }
    })

  const summary = { error: 0, warn: 0, info: 0, total: findings.length }
  for (const f of findings) summary[f.severity]++

  // One list for the single-table render: permissions first, then flags.
  return { summary, rows: [...permissions, ...flags], permissions, flags }
}
