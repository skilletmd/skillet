// Kits are just skills: a kit has no capabilities of its own — its
// manifest is the deduped UNION of its member skills' capability reports. A
// capability appears if ANY member has it; it is `risky` if risky in ANY member;
// evidence is merged across members. There is NO kit-specific detection here.
//
// Null-vs-empty roll-up (mirrors the per-skill wire contract):
//   - returns `null`  when NO member has a computed report (every entry is
//     null/undefined — "not analyzed", so the panel renders nothing).
//   - returns `{ capabilities: [], analysis }` when at least one member was
//     computed but the union is empty (all inert).
//   - returns a non-empty report otherwise.
//
// Analysis roll-up (KTD5 honesty): the kit is `'partial'` if ANY member is null
// (never computed) OR any computed member is itself `'partial'`; `'full'` only
// when every member is computed AND full. So a kit with an un-analyzed member
// never shows a clean "No capabilities detected".

import type {
  CapabilityAnalysis,
  CapabilityKey,
  SkillCapabilityContributor,
  SkillCapabilityEvidence,
  SkillCapabilityReport,
} from './types'
import { CAPABILITY_ORDER } from './types'

/** One member skill's report plus its identity, so the union can attribute each
 *  capability back to the skills that contribute it. */
export interface KitMemberReport {
  author: string
  slug: string
  report: SkillCapabilityReport | null | undefined
}

/** Stable identity of one evidence location. Dedup on (file,lineStart,lineEnd,
 *  source) so a duplicated/mirrored member skill never double-counts its lines. */
function evidenceKey(e: SkillCapabilityEvidence): string {
  return `${e.file} ${e.lineStart} ${e.lineEnd} ${e.source}`
}

/**
 * Union member-skill capability reports into a single kit manifest, recording
 * which member skills contribute each capability (so the kit page can name the
 * one risky skill instead of leaving it to hide in the crowd).
 *
 * @param members one entry per member: its identity + {@link SkillCapabilityReport},
 *   or a `null`/`undefined` report (member never had a computed report).
 */
export function unionCapabilities(members: KitMemberReport[]): SkillCapabilityReport | null {
  const computed = members.filter(
    (m): m is KitMemberReport & { report: SkillCapabilityReport } =>
      m.report !== null && m.report !== undefined,
  )
  // No member was ever analyzed → make no claim (distinct from "computed, none").
  if (computed.length === 0) return null

  // Partial if any member was not computed (dropped above) OR is itself partial.
  const anyNotComputed = computed.length < members.length
  const anyPartial = computed.some((m) => m.report.analysis === 'partial')
  const analysis: CapabilityAnalysis = anyNotComputed || anyPartial ? 'partial' : 'full'

  const byKey = new Map<
    CapabilityKey,
    {
      risky: boolean
      evidence: SkillCapabilityEvidence[]
      seen: Set<string>
      contributors: Map<string, SkillCapabilityContributor>
    }
  >()

  for (const { author, slug, report } of computed) {
    for (const cap of report.capabilities) {
      let entry = byKey.get(cap.capability)
      if (!entry) {
        entry = { risky: false, evidence: [], seen: new Set(), contributors: new Map() }
        byKey.set(cap.capability, entry)
      }
      // Risky rolls up: risky if risky in ANY member.
      entry.risky = entry.risky || cap.risky
      for (const e of cap.evidence ?? []) {
        const id = evidenceKey(e)
        if (!entry.seen.has(id)) {
          entry.seen.add(id)
          entry.evidence.push(e)
        }
      }
      // Attribute this capability to its source skill (deduped by author/slug;
      // risky if risky for this skill in any of its occurrences). Skip members
      // with no identity (a malformed kit entry).
      if (author && slug) {
        const ckey = `${author}/${slug}`
        const existing = entry.contributors.get(ckey)
        if (existing) existing.risky = existing.risky || cap.risky
        else entry.contributors.set(ckey, { author, slug, risky: cap.risky })
      }
    }
  }

  // Computed-but-inert (all members [] ) → an empty list so the panel can say
  // "none" (or, when `analysis` is partial, "couldn't fully analyze") — never "?".
  // CAPABILITY_ORDER is the exhaustive web order, so no detected key is dropped.
  const capabilities = CAPABILITY_ORDER.filter((k) => byKey.has(k)).map((capability) => {
    const v = byKey.get(capability)!
    // Risky-first, then alphabetical by handle, so a flagged member leads the list.
    const skills = [...v.contributors.values()].sort(
      (a, b) =>
        Number(b.risky) - Number(a.risky) ||
        a.author.localeCompare(b.author) ||
        a.slug.localeCompare(b.slug),
    )
    return { capability, risky: v.risky, evidence: v.evidence, skills }
  })
  return { capabilities, analysis }
}
