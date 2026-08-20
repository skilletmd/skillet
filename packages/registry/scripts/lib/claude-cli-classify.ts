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
import { spawn } from 'node:child_process';
import { CATEGORY_KEYS, isCategoryKey, type CategoryKey } from '../../src/categories.js';

// Same tier the API classifier uses — cheap + fast for a single-token decision.
const CLI_MODEL = 'claude-haiku-4-5-20251001';

export interface ClassifyItem {
  id: string;
  slug: string;
  description: string | null;
}

/** Build the batched classification prompt for a set of skills. */
export function buildBatchPrompt(items: ClassifyItem[]): string {
  const keys = CATEGORY_KEYS.join(', ');
  const rows = items.map((it) => ({
    id: it.id,
    slug: it.slug,
    desc: (it.description ?? '').slice(0, 400),
  }));
  return (
    `You sort AI agent skills into exactly one category.\n` +
    `Allowed category keys (use verbatim): ${keys}\n\n` +
    `For EACH skill below, choose the single best key. Reply with ONLY a JSON ` +
    `array of {"id","category"} objects — no prose, no code fences, one entry ` +
    `per skill, echoing the id exactly.\n\n` +
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

/** Run one `claude -p` invocation and return its `result` text. */
function runClaudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', prompt, '--output-format', 'json', '--model', CLI_MODEL],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      try {
        const env = JSON.parse(stdout) as { result?: string };
        resolve(env.result ?? '');
      } catch {
        // Non-JSON stdout (older CLI, or a plain-text fallback) — use as-is.
        resolve(stdout);
      }
    });
  });
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

/** True when the `claude` CLI is available on PATH (checked before a run). */
export function claudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
