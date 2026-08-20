// `skillet status` — surfaces the current state of every skill in the local kit,
// with quarantined and flagged entries called out so a kit member can see
// what is being held by server-side harm scan (§3.2).

import { readState } from "../kit/store.js";
import type { SkillEntry } from "../kit/types.js";

export type StatusBucket = "quarantined" | "flagged" | "pending" | "clean";

export interface StatusEntry {
  slug: string;
  bucket: StatusBucket;
  hash: string;
  /** Highest-severity finding from the last sync — null when clean/pending. */
  topConfidence: "low" | "medium" | "high" | null;
  /** Total findings from the last sync — 0 for clean/pending. */
  totalFindings: number;
}

export interface StatusReport {
  total: number;
  byBucket: Record<StatusBucket, number>;
  entries: StatusEntry[];
  /**
   * Quick-flag for callers: true when at least one skill is quarantined.
   * `skillet status` exits non-zero in this case so it can be wired into CI.
   */
  hasQuarantined: boolean;
}

function bucketFor(entry: SkillEntry): StatusBucket {
  const status = entry.scan?.status;
  if (status === "quarantined") return "quarantined";
  if (status === "flagged") return "flagged";
  if (status === "pending") return "pending";
  return "clean";
}

export async function status(): Promise<StatusReport> {
  const state = await readState();
  const entries: StatusEntry[] = [];
  const byBucket: Record<StatusBucket, number> = {
    quarantined: 0,
    flagged: 0,
    pending: 0,
    clean: 0,
  };

  const slugs = Object.keys(state.skills).sort();
  for (const slug of slugs) {
    const entry = state.skills[slug]!;
    const bucket = bucketFor(entry);
    byBucket[bucket] += 1;
    entries.push({
      slug,
      bucket,
      hash: entry.hash,
      topConfidence: entry.scan?.findings_summary.topConfidence ?? null,
      totalFindings: entry.scan?.findings_summary.total ?? 0,
    });
  }

  // Quarantined first, then flagged, then pending, then clean — operator's
  // first read should land on the entries that need attention.
  const order: Record<StatusBucket, number> = {
    quarantined: 0,
    flagged: 1,
    pending: 2,
    clean: 3,
  };
  entries.sort(
    (a, b) => order[a.bucket] - order[b.bucket] || a.slug.localeCompare(b.slug),
  );

  return {
    total: entries.length,
    byBucket,
    entries,
    hasQuarantined: byBucket.quarantined > 0,
  };
}
