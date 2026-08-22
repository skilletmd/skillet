/**
 * Backfill categories for skills that are still uncategorized, using the LOCAL
 * heuristic (no LLM, no network) — so it covers PUBLIC and PRIVATE alike. This is
 * the counterpart to the publish-time prefill (src/classify/heuristic.ts) for
 * rows that predate that wiring, e.g. a repo imported before the heuristic
 * landed.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/backfill-categories-heuristic.ts            # apply
 *   npx tsx --env-file-if-exists=.env scripts/backfill-categories-heuristic.ts --dry-run  # count only
 *
 * Idempotent: only `category IS NULL` rows are selected and each update is
 * guarded on null, so re-runs only touch skills still missing a category.
 * Reads each skill's stored SKILL.md so the body contributes to the guess.
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { readStoredSkillMdPrisma } from '../src/classify/index.js';
import { guessCategory } from '../src/classify/heuristic.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createPrismaClient();
  try {
    const pending = await prisma.skills.findMany({
      where: { category: null },
      select: { id: true, slug: true, description: true },
      orderBy: { created_at: 'asc' },
    });
    console.log(`${pending.length} uncategorized skill(s).`);

    // A dry run scores exactly what a real run would score, including the stored
    // SKILL.md body, and differs only in not writing. It used to print the count
    // and return, which told an operator nothing about what was about to change.
    let set = 0;
    const unmatched: string[] = [];
    for (const s of pending) {
      const body = await readStoredSkillMdPrisma(prisma, s.id).catch(() => '');
      const guessed = guessCategory({ slug: s.slug, description: s.description, body });
      if (!guessed) {
        unmatched.push(s.id);
        continue;
      }
      if (dryRun) {
        set++;
        console.log(`  ${s.id} → ${guessed}`);
        continue;
      }
      const res = await prisma.skills.updateMany({
        where: { id: s.id, category: null },
        data: { category: guessed },
      });
      if (res.count > 0) {
        set++;
        console.log(`  ${s.id} → ${guessed}`);
      }
    }
    if (unmatched.length > 0) {
      // Naming these is the point: a skill nothing matches is either genuinely
      // uncategorizable (a fixture, a bundle index) or a gap in SIGNALS, and you
      // cannot tell which from a count.
      console.log(`\nno signal matched (${unmatched.length}, left null):`);
      for (const id of unmatched) console.log(`  ${id}`);
    }
    console.log(
      `\n${dryRun ? 'Would categorize' : 'Categorized'} ${set}/${pending.length}.` +
        (dryRun ? ' Re-run without --dry-run to write.' : ''),
    );
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
