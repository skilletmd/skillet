/**
 * Backfill categories for public skills that are still uncategorized.
 *
 *   cd packages/registry
 *   REGISTRY_DB_PATH=./registry.db npx tsx scripts/backfill-skill-categories.ts
 *   ... --dry-run
 *
 * Runs the AI classifier over every public skill with `category IS NULL`,
 * reading each skill's stored SKILL.md. Re-runnable and idempotent: only null
 * rows are selected, so a second run only retries skills the classifier couldn't
 * resolve last time (or ones added since). Key-optional — with no
 * ANTHROPIC_API_KEY it reports zero classified and exits clean. Never touches
 * private skills (their content must not leave the registry).
 *
 * This is the standalone on-demand path. Mirror sync classifies newly-synced
 * skills at ingest (scripts/sync-mirror-skills.ts); this catches everything that
 * predates that wiring, plus any owned skills that were never classified.
 *
 * Two backends:
 *   default    → the Anthropic API classifier (needs ANTHROPIC_API_KEY).
 *   --via-claude → shell out to the local `claude` CLI, reusing your Claude Code
 *                  auth (no API key). Batched + Haiku-pinned. Local ops only.
 */
import { pathToFileURL } from 'node:url';
import { query } from '../tests/legacy-sqlite-query.js';
import { classifyUncategorizedSkills } from '../src/classify/index.js';
import {
  classifyBatchViaClaudeCli,
  claudeCliAvailable,
} from './lib/claude-cli-classify.js';
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { throwSqliteCliRetired } from '../src/db/cli-store-retired.js'

/** Skills per `claude -p` invocation — amortizes the CLI's per-call startup. */
const CLI_BATCH_SIZE = 40;

interface PendingSkill {
  id: string;
  slug: string;
  description: string | null;
}

/** Public skills still awaiting a category. Private skills are excluded — their
 *  content never goes to the classifier. */
export function pendingSkills(db: DatabaseSync): PendingSkill[] {
  return query<PendingSkill>(
    db,
    `SELECT id, slug, description FROM skills
       WHERE category IS NULL AND visibility = 'public'
       ORDER BY created_at ASC`,
  );
}

/** Classify pending skills by piping batches through the local `claude` CLI.
 *  Re-checks category IS NULL per skill (idempotent) and writes each resolved
 *  category. Returns the count newly classified. */
async function backfillViaClaudeCli(
  db: DatabaseSync,
  pending: PendingSkill[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let classified = 0;
  for (let i = 0; i < pending.length; i += CLI_BATCH_SIZE) {
    const batch = pending.slice(i, i + CLI_BATCH_SIZE);
    let resolved: Map<string, string>;
    try {
      resolved = await classifyBatchViaClaudeCli(batch);
    } catch {
      // A failed batch is skipped, not fatal — its skills stay null and retry.
      resolved = new Map();
    }
    for (const [id, category] of resolved) {
      const current = db.prepare('SELECT category FROM skills WHERE id = ?').get(id) as
        | { category: string | null }
        | undefined;
      if (!current || current.category != null) continue;
      db.prepare('UPDATE skills SET category = ? WHERE id = ?').run(category, id);
      classified++;
    }
    onProgress?.(Math.min(i + CLI_BATCH_SIZE, pending.length), pending.length);
  }
  return classified;
}

export async function backfillCategories(
  db: DatabaseSync,
  opts: { dryRun?: boolean; viaClaude?: boolean } = {},
): Promise<{ candidates: number; classified: number }> {
  const pending = pendingSkills(db);
  if (opts.dryRun) {
    return { candidates: pending.length, classified: 0 };
  }
  const classified = opts.viaClaude
    ? await backfillViaClaudeCli(db, pending, (done, total) =>
        console.log(`  ${done}/${total}…`),
      )
    : await classifyUncategorizedSkills(db, pending);
  return { candidates: pending.length, classified };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const viaClaude = process.argv.includes('--via-claude');
  throwSqliteCliRetired('backfill-skill-categories')
}


const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
