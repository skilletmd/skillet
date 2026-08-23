/**
 * Retire a mirrored author: delete its skills, its linked kit and its author row,
 * and stop the nightly bringing it back.
 *
 * `sync-mirror-skills.ts --clear` only resolves handles that appear in
 * mirror-sources.json, so it cannot touch a mirror that arrived through the
 * review queue. Those are exactly the ones a curation decision lands on, and
 * without this the only lever was editing rows by hand.
 *
 * Removal alone is not enough: a queue-approved mirror is re-synced by nightly
 * phase 2 (work list = `mirror_review_queue` where status is 'live'), and
 * discovery would re-propose the repo on the next sweep. So this also flips the
 * queue row to 'rejected' and prints the denylist entry to paste into
 * scripts/mirror-denylist.json, which is authoritative across all three phases.
 *
 * Safety comes from clearSourcePrisma: it refuses a claimed author, and refuses
 * any author whose skills carry reports or moderation history, so the record of
 * a moderation decision cannot be erased by a curation one.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/retire-mirror.ts <handle> [<handle>...]
 *   npx tsx --env-file-if-exists=.env scripts/retire-mirror.ts <handle> --apply
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { clearSourcePrisma } from '../src/mirror-ops/sync-sources.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const handles = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (handles.length === 0) {
    console.error('usage: retire-mirror.ts <handle> [<handle>...] [--apply]');
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient();
  try {
    const denylist: string[] = [];
    for (const handle of handles) {
      const author = await prisma.authors.findUnique({
        where: { id: handle },
        select: { id: true, is_mirror: true, mirror_source_url: true, mirror_claimed_at: true },
      });
      if (!author) {
        console.log(`  ${handle}: no such author`);
        continue;
      }
      if (author.is_mirror !== 1) {
        console.log(`  ${handle}: not a mirror, refusing`);
        continue;
      }
      const count = await prisma.skills.count({ where: { author_id: handle } });
      const repo = (author.mirror_source_url ?? '').replace(/^https?:\/\/github\.com\//, '');
      console.log(`  ${apply ? 'retiring' : 'would retire'} @${handle} — ${count} skills — ${repo || '(no source)'}`);
      if (repo) denylist.push(repo);

      if (!apply) continue;
      try {
        await clearSourcePrisma(prisma, { handle } as never);
      }
      catch (err) {
        // Claimed, or carries moderation history. Both are deliberate refusals.
        console.log(`    refused: ${(err as Error).message}`);
        continue;
      }
      // Stop nightly phase 2 re-syncing it. Not delete: the row is the record
      // that this repo was seen, judged and retired.
      const n = await prisma.mirror_review_queue.updateMany({
        where: { derived_handle: handle, status: 'live' },
        data: { status: 'rejected', screen_notes: 'retired: removed from the catalog by a curation decision' },
      });
      if (n.count > 0) console.log(`    queue row(s) marked rejected: ${n.count}`);
    }

    if (denylist.length > 0) {
      console.log('\nAdd to scripts/mirror-denylist.json so discovery cannot re-propose these:\n');
      for (const repo of denylist) console.log(`  ${repo}`);
    }
    if (!apply) console.log('\nDry run. Re-run with --apply to delete.');
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
