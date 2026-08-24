/**
 * Categorize skills the local heuristic could not, using the Anthropic API.
 *
 * This is a FALLBACK, not a replacement. The heuristic
 * (scripts/backfill-categories-heuristic.ts, and the prefill on the publish and
 * sync paths) stays the primary classifier: it is offline, instant, and works on
 * private skills, which is why it took over the hot path. But it decides by
 * keyword, and a keyword classifier has nothing to say about
 * "Quick-reference card for all caveman modes" or "Check Compound Engineering
 * health and repo-local config" — there is no category word in either. It
 * returns null, deliberately, rather than mis-filing. Those nulls are what this
 * clears.
 *
 * Run the heuristic backfill FIRST; this one only sees what it left behind, so
 * the API is spent on the genuinely hard cases and nothing else.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/backfill-categories-ai.ts --dry-run
 *   npx tsx --env-file-if-exists=.env scripts/backfill-categories-ai.ts
 *   ... --limit 25        # cap the number of API calls this run
 *
 * With no API key, there is a second route that needs none. The `claude` CLI
 * classifies using the operator's own Claude Code auth, but it only exists on a
 * workstation, never on the server — and the skills only exist in the server's
 * database. Rather than copy a database credential onto the workstation to
 * bridge that gap, the work moves instead of the secret:
 *
 *   ssh prod  '… scripts/backfill-categories-ai.ts --export' > pending.json
 *   local     '… scripts/backfill-categories-ai.ts --classify pending.json > map.json'
 *   ssh prod  '… scripts/backfill-categories-ai.ts --import' < map.json
 *
 * `--export` emits the pending skills as JSON, `--classify` turns that into an
 * id -> category map via the local CLI, and `--import` applies the map,
 * re-checking `category IS NULL` per row so it stays idempotent and so a stale
 * map cannot overwrite a category set in the meantime.
 *
 * PRIVACY: public skills only. Private skill content must never leave the
 * registry, and the selection below is the gate that guarantees it — the
 * classifier itself does not check visibility.
 *
 * Idempotent: only `category IS NULL` rows are selected and each write re-checks
 * null, so a re-run retries just the ones that stayed unresolved. Key-optional:
 * with no ANTHROPIC_API_KEY it reports zero and exits clean, same as the rest of
 * the registry.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { classifyUncategorizedSkillsPrisma, readStoredSkillMdPrisma } from '../src/classify/index.js';
import { isCategoryKey } from '../src/categories.js';
import { classifyBatchViaClaudeCli, claudeCliAvailable } from './lib/claude-cli-classify.js';

/** Skills per `claude -p` call — amortizes CLI startup. */
const CLI_BATCH = 25;

function readStdin(): string {
  try { return readFileSync(0, 'utf8'); }
  catch { return ''; }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const doExport = process.argv.includes('--export');
  const doImport = process.argv.includes('--import');
  const classifyFile = process.argv[process.argv.indexOf('--classify') + 1];
  const doClassify = process.argv.includes('--classify');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg === -1 ? undefined : Number(process.argv[limitArg + 1]);

  // --classify touches no database at all: it is the workstation half of the
  // split, reading exported JSON and writing a map to stdout.
  if (doClassify) {
    if (!(await claudeCliAvailable())) {
      console.error('the `claude` CLI is not on PATH — run this half on a workstation with Claude Code.');
      process.exitCode = 1;
      return;
    }
    const items = JSON.parse(readFileSync(classifyFile!, 'utf8')) as Array<{
      id: string; slug: string; description: string | null; body: string;
    }>;
    const out: Record<string, string> = {};
    for (let i = 0; i < items.length; i += CLI_BATCH) {
      const batch = items.slice(i, i + CLI_BATCH);
      try {
        for (const [id, cat] of await classifyBatchViaClaudeCli(batch)) {
          if (isCategoryKey(cat)) out[id] = cat;
        }
      } catch (err) {
        // A failed batch is skipped, never fatal: its skills stay unmapped and
        // the next run picks them up, because --import only ever fills nulls.
        console.error(`  ! batch ${i / CLI_BATCH + 1} failed: ${(err as Error).message}`);
      }
      console.error(`  classified ${Object.keys(out).length}/${items.length}`);
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  if (doImport) {
    const map = JSON.parse(readStdin() || '{}') as Record<string, string>;
    const prisma = createPrismaClient();
    let applied = 0, skipped = 0;
    try {
      for (const [id, category] of Object.entries(map)) {
        if (!isCategoryKey(category)) { skipped++; continue; }
        // Guarded on null: a map built minutes ago must not clobber a category
        // someone set since.
        const r = await prisma.skills.updateMany({
          where: { id, category: null, visibility: 'public' },
          data: { category },
        });
        if (r.count > 0) applied++; else skipped++;
      }
      const left = await prisma.skills.count({ where: { category: null, visibility: 'public' } });
      console.log(`Applied ${applied}, skipped ${skipped}. Still uncategorized: ${left}.`);
    } finally { await prisma.$disconnect(); }
    return;
  }

  if (doExport) {
    const prisma = createPrismaClient();
    try {
      const pending = await prisma.skills.findMany({
        where: { category: null, visibility: 'public' },
        select: { id: true, slug: true, description: true },
        orderBy: { created_at: 'asc' },
        ...(Number.isFinite(limit) && limit! > 0 ? { take: limit } : {}),
      });
      const out = [];
      for (const p of pending) {
        // The body is what makes the hard cases decidable — a description like
        // "Check health and repo-local config" has no category word in it.
        const body = (await readStoredSkillMdPrisma(prisma, p.id)).slice(0, 1200);
        out.push({ id: p.id, slug: p.slug, description: p.description, body });
      }
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      console.error(`exported ${out.length} pending skill(s)`);
    } finally { await prisma.$disconnect(); }
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set.');
    console.error('Either set one, or use the keyless route: --export | --classify | --import (see the header).');
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient();
  try {
    // The visibility filter IS the privacy boundary. Do not widen it.
    const pending = await prisma.skills.findMany({
      where: { category: null, visibility: 'public' },
      select: { id: true, slug: true, description: true },
      orderBy: { created_at: 'asc' },
      ...(Number.isFinite(limit) && limit! > 0 ? { take: limit } : {}),
    });

    console.log(`${pending.length} public skill(s) still uncategorized after the heuristic:\n`);
    for (const p of pending) {
      const d = String(p.description ?? '').replace(/\s+/g, ' ').trim();
      console.log(`  ${p.id}`);
      console.log(`    ${d.slice(0, 96) || '(no description)'}`);
    }

    if (pending.length === 0) return;
    if (dryRun) {
      console.log(`\nDry run: would send ${pending.length} skill(s) to the classifier.`);
      return;
    }

    console.log('');
    const classified = await classifyUncategorizedSkillsPrisma(prisma, pending);

    // Report what is STILL null, not just the win count. A silent shortfall here
    // is the failure mode that matters: the classifier returns null on a bad
    // response, a network error, and an unparseable reply alike, so "classified
    // 3" without the remainder reads as success when 16 quietly failed.
    const left = await prisma.skills.count({ where: { category: null, visibility: 'public' } });
    console.log(`\nClassified ${classified}/${pending.length}. Still uncategorized: ${left}.`);
    if (classified < pending.length) {
      console.log('Unresolved skills stay null and are safe to retry — re-run to pick them up.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
