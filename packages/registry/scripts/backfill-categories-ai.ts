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
 * PRIVACY: public skills only. Private skill content must never leave the
 * registry, and the selection below is the gate that guarantees it — the
 * classifier itself does not check visibility.
 *
 * Idempotent: only `category IS NULL` rows are selected and each write re-checks
 * null, so a re-run retries just the ones that stayed unresolved. Key-optional:
 * with no ANTHROPIC_API_KEY it reports zero and exits clean, same as the rest of
 * the registry.
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { classifyUncategorizedSkillsPrisma } from '../src/classify/index.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg === -1 ? undefined : Number(process.argv[limitArg + 1]);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — nothing to do.');
    console.error('The heuristic covers the rest; this fallback needs a key.');
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
