/**
 * Re-run the category heuristic over skills that ALREADY have a category, and
 * move the ones a widened signal list now claims.
 *
 * The routine backfill (scripts/backfill-categories-heuristic.ts) only selects
 * `category IS NULL`, on purpose: a stored category may have been chosen by a
 * human through PATCH /v1/skills/:author/:slug/category, and a heuristic must
 * not overwrite a person. That leaves a gap. When SIGNALS gains a term, rows
 * classified before the change keep whatever the thinner list guessed —
 * vercel/writing-guidelines sat under `security` because nothing in the writing
 * lane matched "Review docs/prose for Writing Guidelines compliance".
 *
 * This closes that gap narrowly rather than re-classifying the world:
 *
 *   --to <category>   REQUIRED. Only propose moves INTO this category. Scoping
 *                     to the lane you just changed keeps an unrelated scoring
 *                     wobble from rewriting rows you were not thinking about.
 *   --apply           Write. Default is a dry run that prints every move.
 *   --include-owned   Also consider non-mirrored skills. Off by default: a
 *                     mirrored skill under an unclaimed author was categorized
 *                     by this heuristic and by nobody else, so moving it cannot
 *                     overwrite a human decision. A skill someone published, or
 *                     one whose author has claimed the namespace, can have been
 *                     set deliberately.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/reclassify-skills.ts --to writing
 *   npx tsx --env-file-if-exists=.env scripts/reclassify-skills.ts --to writing --apply
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { readStoredSkillMdPrisma } from '../src/classify/index.js';
import { guessCategory } from '../src/classify/heuristic.js';
import { isCategoryKey, CATEGORY_KEYS } from '../src/categories.js';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const includeOwned = process.argv.includes('--include-owned');
  const to = argValue('--to');

  if (!isCategoryKey(to)) {
    console.error(
      `--to <category> is required. One of: ${CATEGORY_KEYS.join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient();
  try {
    // Everything already classified as something else. Null rows belong to the
    // backfill, not here.
    const rows = await prisma.skills.findMany({
      where: { category: { not: null, notIn: [to] } },
      select: { id: true, slug: true, description: true, category: true, author_id: true },
      orderBy: { created_at: 'asc' },
    });

    let eligible = rows;
    if (!includeOwned) {
      const mirrored = new Set(
        (
          await prisma.skill_mirrors.findMany({
            where: { skill_id: { in: rows.map((r) => r.id) } },
            select: { skill_id: true },
          })
        ).map((m) => m.skill_id),
      );
      const claimed = new Set(
        (
          await prisma.authors.findMany({
            where: {
              id: { in: [...new Set(rows.map((r) => r.author_id))] },
              mirror_claimed_at: { not: null },
            },
            select: { id: true },
          })
        ).map((a) => a.id),
      );
      eligible = rows.filter((r) => mirrored.has(r.id) && !claimed.has(r.author_id));
    }

    console.log(
      `${rows.length} categorized skill(s); ${eligible.length} eligible ` +
        `(${includeOwned ? 'including owned' : 'unclaimed mirrors only'}).\n`,
    );

    const moves: { id: string; from: string; to: string }[] = [];
    for (const s of eligible) {
      const body = await readStoredSkillMdPrisma(prisma, s.id).catch(() => '');
      const guessed = guessCategory({ slug: s.slug, description: s.description, body });
      if (guessed !== to) continue;
      moves.push({ id: s.id, from: s.category as string, to });
    }

    for (const m of moves) console.log(`  ${m.from.padEnd(14)} -> ${m.to.padEnd(14)} ${m.id}`);

    if (!apply) {
      console.log(`\nWould move ${moves.length} skill(s) to ${to}. Re-run with --apply to write.`);
      return;
    }
    // Guarded on the category we read, so a concurrent edit (a human setting it
    // between the scan and the write) wins instead of being clobbered.
    let moved = 0;
    for (const m of moves) {
      const res = await prisma.skills.updateMany({
        where: { id: m.id, category: m.from },
        data: { category: m.to },
      });
      moved += res.count;
    }
    console.log(`\nMoved ${moved}/${moves.length} skill(s) to ${to}.`);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
