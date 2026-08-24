/**
 * Waive a scanner quarantine an admin has reviewed and judged a false positive,
 * from the command line.
 *
 * This is the CLI twin of `POST /api/v1/admin/skills/:author/:slug/scan-override`
 * and deliberately has the same semantics: it records the review, it does NOT
 * clear the findings (they stay on the version and stay visible in the trust
 * panel), and it recomputes `latest_hash` immediately so the skill is
 * installable without waiting for a sync.
 *
 * There is no config file here on purpose. A committed list of overrides would
 * become a second source of truth the moment someone waived a quarantine in the
 * admin UI: the file would look authoritative while the database disagreed, and
 * a stale entry would read as an approval nobody gave. The database row is the
 * record; this script is just a way to write it when the UI is not to hand.
 *
 * The reason is required and should be specific enough to read back cold months
 * later — name the finding, name what it actually is. "False positive" is not a
 * reason, it is a restatement.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/scan-override.ts <author>/<slug> --reason "..."
 *   npx tsx --env-file-if-exists=.env scripts/scan-override.ts <author>/<slug> --reason "..." --admin taylor --apply
 *   npx tsx --env-file-if-exists=.env scripts/scan-override.ts <author>/<slug> --clear --apply
 *   npx tsx --env-file-if-exists=.env scripts/scan-override.ts --list
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { lastCleanHashPrisma } from '../src/lib/sync-manifest.js';

/** Same floor the HTTP route enforces. */
const MIN_REASON_LENGTH = 10;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const clear = process.argv.includes('--clear');
  const list = process.argv.includes('--list');
  const admin = flag('admin') ?? 'admin';
  const reason = (flag('reason') ?? '').trim();
  const target = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== reason && a !== admin);

  const prisma = createPrismaClient();
  try {
    if (list) {
      const rows = await prisma.skills.findMany({
        where: { NOT: { scan_override_at: null } },
        select: { id: true, scan_override_at: true, scan_override_by: true, scan_override_reason: true },
        orderBy: { id: 'asc' },
      });
      console.log(`${rows.length} override(s) in effect\n`);
      for (const r of rows) {
        const when = new Date(Number(r.scan_override_at) * 1000).toISOString().slice(0, 10);
        console.log(`  ${r.id}  ${when}  by ${r.scan_override_by ?? '(unknown)'}`);
        console.log(`    ${r.scan_override_reason ?? ''}\n`);
      }
      return;
    }

    if (!target || !target.includes('/')) {
      console.error('usage: scan-override.ts <author>/<slug> --reason "..." [--admin <handle>] [--apply]');
      console.error('       scan-override.ts <author>/<slug> --clear --apply');
      console.error('       scan-override.ts --list');
      process.exitCode = 1;
      return;
    }
    const [author, slug] = target.split('/', 2) as [string, string];
    const skill = await prisma.skills.findFirst({
      where: { author_id: author, slug },
      select: { id: true, moderation_status: true, scan_override_at: true },
    });
    if (!skill) {
      console.error(`no such skill: ${target}`);
      process.exitCode = 1;
      return;
    }

    if (clear) {
      console.log(`  ${apply ? 'clearing' : 'would clear'} override on ${target}`);
      if (apply) {
        await prisma.skills.update({
          where: { id: skill.id },
          data: { scan_override_at: null, scan_override_by: null, scan_override_reason: null },
        });
        // With the override gone the quarantine suppresses the hash again.
        await prisma.skills.update({
          where: { id: skill.id },
          data: { latest_hash: await lastCleanHashPrisma(prisma, skill.id) },
        });
      }
      return;
    }

    if (reason.length < MIN_REASON_LENGTH) {
      console.error(`--reason is required (${MIN_REASON_LENGTH} characters minimum): say why this quarantine is wrong.`);
      process.exitCode = 1;
      return;
    }
    // Show what the override will actually buy, so a no-op is visible as a no-op:
    // a skill can be unservable for reasons an override does not touch.
    const before = await lastCleanHashPrisma(prisma, skill.id);
    console.log(`  ${apply ? 'overriding' : 'would override'} ${target}`);
    console.log(`    servable hash now: ${before ?? 'NONE (quarantined)'}`);
    if (skill.scan_override_at != null) console.log('    note: an override is already set; this replaces it');
    if (!apply) {
      console.log('\nDry run. Re-run with --apply.');
      return;
    }
    await prisma.skills.update({
      where: { id: skill.id },
      data: {
        scan_override_at: Math.floor(Date.now() / 1000),
        scan_override_by: admin,
        scan_override_reason: reason,
      },
    });
    const after = await lastCleanHashPrisma(prisma, skill.id);
    await prisma.skills.update({ where: { id: skill.id }, data: { latest_hash: after } });
    console.log(`    servable hash after: ${after ?? 'STILL NONE — the block is not the scanner'}`);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
