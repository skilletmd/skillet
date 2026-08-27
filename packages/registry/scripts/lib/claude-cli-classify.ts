/**
 * Classify skills by shelling out to the local `claude` CLI in headless mode
 * (`claude -p`), reusing the operator's Claude Code auth — no ANTHROPIC_API_KEY.
 *
 * This is a LOCAL OPS convenience for the backfill script only; it is never
 * imported by the registry server (which classifies via the API path in
 * src/classify). Batched (many skills per invocation) so the CLI's per-call
 * startup is amortized, and pinned to Haiku since classification is a one-word
 * decision. Keyed by skill id (not slug) so cross-author slug collisions can't
 * mismatch a result.
 */
import { CATEGORY_KEYS, isCategoryKey, type CategoryKey } from '../../src/categories.js';
// Subprocess handling moved to claude-cli.ts when suggestion phrasing needed the
// same transport. Re-exported so existing importers of this module are unchanged.
import { runClaudeCli, claudeCliAvailable } from './claude-cli.js';

export { claudeCliAvailable };

export interface ClassifyItem {
  id: string;
  slug: string;
  description: string | null;
  /** SKILL.md head, optional. The cases that reach this classifier are the ones
   *  the keyword heuristic could not decide, and they are usually undecidable
   *  from the description ALONE — "Check Compound Engineering health and
   *  repo-local config" names no category. The body is what carries the signal,
   *  so include it when the caller has it. */
  body?: string | null;
}

/** Build the batched classification prompt for a set of skills. */
export function buildBatchPrompt(items: ClassifyItem[]): string {
  const keys = CATEGORY_KEYS.join(', ');
  const rows = items.map((it) => ({
    id: it.id,
    slug: it.slug,
    desc: (it.description ?? '').slice(0, 400),
    ...(it.body ? { body: it.body.slice(0, 700) } : {}),
  }));
  return (
    `You sort AI agent skills into exactly one category.\n` +
    `Allowed category keys (use verbatim): ${keys}\n\n` +
    `For EACH skill below, choose the single best key. Reply with ONLY a JSON ` +
    `array of {"id","category"} objects — no prose, no code fences, one entry ` +
    `per skill, echoing the id exactly. Judge by what the skill DOES; the ` +
    `slug and description are the strongest signal and \`body\` is context.\n\n` +
    `Skills:\n${JSON.stringify(rows)}`
  );
}

/**
 * Parse the CLI's `result` text into id → raw-category. Tolerates code fences
 * and leading prose (a stray "Sure," or a name prefix) by extracting the first
 * JSON array in the text. Returns an empty map on anything unparseable rather
 * than throwing, so one bad batch never aborts the run.
 */
export function parseBatchResult(resultText: string): Map<string, string> {
  const out = new Map<string, string>();
  const start = resultText.indexOf('[');
  const end = resultText.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const row of parsed) {
    if (row && typeof row === 'object') {
      const id = (row as { id?: unknown }).id;
      const category = (row as { category?: unknown }).category;
      if (typeof id === 'string' && typeof category === 'string') out.set(id, category);
    }
  }
  return out;
}

/**
 * Classify one batch of skills via the CLI. Returns id → valid CategoryKey for
 * every skill the model resolved to a real taxonomy key; skills it omitted or
 * mis-answered are simply absent (they stay null and retry next run).
 */
export async function classifyBatchViaClaudeCli(
  items: ClassifyItem[],
): Promise<Map<string, CategoryKey>> {
  const result = new Map<string, CategoryKey>();
  if (items.length === 0) return result;
  const resultText = await runClaudeCli(buildBatchPrompt(items));
  const raw = parseBatchResult(resultText);
  for (const [id, category] of raw) {
    if (isCategoryKey(category)) result.set(id, category);
  }
  return result;
}
