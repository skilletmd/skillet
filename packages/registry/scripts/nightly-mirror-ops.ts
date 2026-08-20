/**
 * Nightly mirror ops — thin CLI entry for the scheduled loop that keeps the
 * mirrored library current and the review queue fed. Run by PM2
 * (cron_restart, see ecosystem.config.cjs) on the registry host; safe to run
 * by hand any time (a MySQL advisory lock makes overlapping runs exit early):
 *
 *   cd packages/registry
 *   set -a && . ./.env && set +a
 *   npx tsx scripts/nightly-mirror-ops.ts [--dry-run]
 *
 * The logic lives in src/mirror-ops/nightly.ts (typechecked, tested):
 * phase 1 seed re-sync, phase 2 discovered-mirror re-sync, phase 3 discovery.
 * The last stdout line is a JSON summary (the monitoring hook); exit code is
 * 0 only for a fully clean run.
 *
 * Tokens: SKILLET_MIRROR_GITHUB_TOKEN (or GITHUB_TOKEN) for sync — required;
 * SKILLET_DISCOVERY_GITHUB_TOKEN for the search-driven discovery pass.
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { runNightlyMirrorOps } from '../src/mirror-ops/nightly.js';

async function main(): Promise<void> {
    const dryRun = process.argv.includes('--dry-run');
    const prisma = createPrismaClient();
    try {
        const result = await runNightlyMirrorOps(prisma, { dryRun });
        process.exitCode = result.exitCode;
    }
    catch (err) {
        console.error(`nightly mirror ops failed: ${(err as Error).message}`);
        process.exitCode = 1;
    }
    finally {
        await prisma.$disconnect();
    }
}

const invokedDirectly =
    process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
