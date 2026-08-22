/**
 * Re-run the auto-screen over `pending_review` rows that never actually got one.
 *
 * When the screen was unauthenticated it exhausted GitHub's 60-per-hour
 * anonymous budget within a dozen repos, and every candidate after that was
 * written off as `rejected_screen` — a terminal state — on the strength of a
 * 429. Those rows were reopened once the screen learned to authenticate, but
 * reopening only restores them to the queue; it does not judge them. Without
 * this pass they would sit in `pending_review` forever, because discovery skips
 * anything already queued and so never re-screens it.
 *
 * This gives each one the verdict it should have had:
 *   passes            → stays `pending_review` (a human still decides)
 *   fails for real    → `rejected_screen` with the actual reason
 *   throttled again   → left alone, to be re-run later
 *
 * A human decision is never overwritten: rows carrying `decided_by` are skipped.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/rescreen-queue.ts --dry-run
 *   npx tsx --env-file-if-exists=.env scripts/rescreen-queue.ts --apply
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { screenCandidate, parseOwnerRepo } from '../src/lib/mirror-screen.js';

/** Be a good citizen even with 5000/hr: screening is several calls per repo. */
const DELAY_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  try {
    const rows = await prisma.mirror_review_queue.findMany({
      where: { status: 'pending_review', decided_by: null },
      select: { id: true, source_repo: true },
      orderBy: { created_at: 'asc' },
    });
    console.log(`${rows.length} unjudged pending row(s).${apply ? '' : ' (dry run)'}\n`);

    let passed = 0;
    let rejected = 0;
    let deferred = 0;
    for (const row of rows) {
      const parsed = parseOwnerRepo(row.source_repo);
      if (!parsed) {
        console.log(`  unparseable  ${row.source_repo}`);
        continue;
      }
      const screen = await screenCandidate({ prisma, owner: parsed.owner, repo: parsed.repo });
      await sleep(DELAY_MS);

      if (screen.transient) {
        deferred++;
        console.log(`  deferred     ${row.source_repo}`);
        continue;
      }
      if (screen.pass) {
        passed++;
        console.log(`  pass         ${row.source_repo}`);
        continue;
      }
      rejected++;
      console.log(`  reject       ${row.source_repo}  — ${(screen.notes ?? '').slice(0, 70)}`);
      if (apply) {
        await prisma.mirror_review_queue.updateMany({
          where: { id: row.id, status: 'pending_review' },
          data: { status: 'rejected_screen', screen_notes: screen.notes },
        });
      }
    }
    console.log(
      `\n${apply ? 'applied' : 'would apply'}: ${passed} stay pending, ` +
        `${rejected} rejected, ${deferred} deferred (still throttled).`,
    );
    if (!apply) console.log('Re-run with --apply to write.');
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
