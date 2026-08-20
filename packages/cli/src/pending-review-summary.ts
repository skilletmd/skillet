import { bold, dim, cyan } from "./cli-colors.js";

/**
 * One-line summary of the skills sync held for review (new arrivals and
 * updates alike) — the interactive-sync replacement for the old per-skill
 * diff prompts. Silent when nothing is waiting.
 */
export function printPendingReviewSummary(
  pending: Array<{ slug: string; range: string }>,
): void {
  if (pending.length === 0) return;
  // Same split as the home menu: updates and new arrivals are different
  // decisions, so each kind gets its own line.
  const updates = pending.filter((p) => p.range !== "new");
  const arrivals = pending.filter((p) => p.range === "new");
  console.log("");
  if (arrivals.length > 0) {
    const items = arrivals.map((p) => p.slug).join(", ");
    console.log(`${arrivals.length} new skill${arrivals.length === 1 ? "" : "s"} to add: ${items}`);
  }
  if (updates.length > 0) {
    const items = updates.map((p) => `${p.slug} ${dim(`(${p.range})`)}`).join(", ");
    console.log(`${updates.length} skill update${updates.length === 1 ? "" : "s"} to review: ${items}`);
  }
  console.log(dim("  Review with ") + cyan(bold("skillet pending")));
}
