/**
 * Nightly mirror ops — thin CLI entry for the scheduled loop that keeps the
 * mirrored library current and the review queue fed. Run by PM2
 * (cron_restart, see ecosystem.config.cjs) on the registry host; safe to run
 * by hand any time (a MySQL advisory lock makes overlapping runs exit early):
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/nightly-mirror-ops.ts [--dry-run]
 *   ... --force            # run even if one completed within MIN_INTERVAL_HOURS
 *
 * PM2 starts a `cron_restart` app IMMEDIATELY on (re)start as well as on the
 * schedule, so every `pm2 startOrReload` kicks off a full crawl — ~25 minutes
 * of GitHub API burn nobody asked for. Two guards, because the first one alone
 * had it backwards:
 *
 *   1. SCHEDULED HOUR. A deploy at any other hour exits in milliseconds. This
 *      is the one that actually stops deploy-triggered crawls; keep the hour in
 *      lockstep with `cron_restart` in ecosystem.config.cjs.
 *   2. MIN INTERVAL. A floor on frequency, for a double-fire inside the hour.
 *
 * The min-interval guard was doing this job alone and could not: on deploy the
 * stamp is usually stale, so the DEPLOY got the full crawl and the 06:00 cron
 * then skipped as "too recent". Between 2026-08-22 and 2026-08-25 every single
 * 06:00 firing skipped and every real run was a deploy. One missed by twelve
 * minutes (11.8h since the last run, against a 12h floor).
 *
 * Neither is a lock: overlap is still handled by the MySQL advisory lock inside
 * runNightlyMirrorOps.
 *
 * The logic lives in src/mirror-ops/nightly.ts (typechecked, tested):
 * phase 1 seed re-sync, phase 2 discovered-mirror re-sync, phase 3 discovery.
 * The last stdout line is a JSON summary (the monitoring hook); exit code is
 * 0 only for a fully clean run.
 *
 * Tokens: SKILLET_MIRROR_GITHUB_TOKEN (or GITHUB_TOKEN) for sync — required;
 * SKILLET_DISCOVERY_GITHUB_TOKEN for the search-driven discovery pass.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { runNightlyMirrorOps } from '../src/mirror-ops/nightly.js';

/** A completed run inside this window makes the next start a no-op. Half a day:
 *  comfortably under the 24h cron gap, so a real 06:00 firing never trips it. */
const MIN_INTERVAL_HOURS = 12;
/** Must match `cron_restart` for mirror-nightly in ecosystem.config.cjs. Local
 *  hour, because that is what PM2's cron expression is evaluated in. */
const SCHEDULED_HOUR = Number(process.env.SKILLET_MIRROR_HOUR ?? 6);

/** Where the last completed run is stamped: beside the PM2 logs, so it is not a
 *  tracked file and survives a rebuild. Resolved from this file, not cwd, so a
 *  hand-run from anywhere reads the same stamp PM2's run wrote. */
const STAMP_PATH = join(
    fileURLToPath(new URL('../../../logs/', import.meta.url)),
    'mirror-nightly-last-run',
);

function hoursSinceLastRun(): number | null {
    try {
        const raw = readFileSync(STAMP_PATH, 'utf8').trim();
        const then = Number(raw);
        if (!Number.isFinite(then)) return null;
        return (Date.now() - then) / 3_600_000;
    }
    catch {
        return null; // never run, or unreadable — treat as due
    }
}

function stampRun(): void {
    try {
        mkdirSync(dirname(STAMP_PATH), { recursive: true });
        writeFileSync(STAMP_PATH, String(Date.now()), 'utf8');
    }
    catch (err) {
        // A missing stamp only costs an extra run; never fail the job over it.
        console.warn(`could not write run stamp: ${(err as Error).message}`);
    }
}

async function main(): Promise<void> {
    const dryRun = process.argv.includes('--dry-run');
    const force = process.argv.includes('--force');

    // Guard 1: only at the scheduled hour. PM2 gives the process no way to tell
    // a cron restart from a deploy restart, so the clock is the signal.
    const hour = new Date().getHours();
    if (!force && !dryRun && hour !== SCHEDULED_HOUR) {
        console.log(
            `not the scheduled hour (now ${hour}:00, scheduled ${SCHEDULED_HOUR}:00); skipping. ` +
                `Pass --force to run anyway.`,
        );
        return;
    }

    // Guard 2: and not twice within the window.
    const since = hoursSinceLastRun();
    if (!force && !dryRun && since !== null && since < MIN_INTERVAL_HOURS) {
        console.log(
            `last run completed ${since.toFixed(1)}h ago (< ${MIN_INTERVAL_HOURS}h); skipping. ` +
                `Pass --force to run anyway.`,
        );
        return;
    }

    const prisma = createPrismaClient();
    try {
        const result = await runNightlyMirrorOps(prisma, { dryRun });
        if (!dryRun) stampRun();
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
