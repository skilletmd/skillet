/**
 * Seed + auto-sync the registry with MIRROR skills from public GitHub repos.
 * Thin CLI entry; the loop lives in src/mirror-ops/sync-sources.ts (typechecked,
 * tested) and the reusable engine in src/sync/sync-repo.ts (shared with
 * self-serve connect-your-repo).
 *
 *   cd packages/registry
 *   set -a && . ./.env && set +a
 *   npx tsx scripts/sync-mirror-skills.ts [--dry-run]
 *   npx tsx scripts/sync-mirror-skills.ts --clear <handle>
 *
 * Mirrors publish under a reserved brand handle with the org's logo, scanned
 * and platform-attested. Claiming (mirror_claimed_at set) does not freeze
 * sync, but it lifts the curated per-source maxSkills cap and freezes the
 * profile: a claimed author's name/avatar/bio are never overwritten from the
 * seed file. A seed removed from mirror-sources.json keeps syncing via the
 * nightly job's phase 2; the retire lever is scripts/mirror-denylist.json,
 * which is authoritative across all phases.
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { loadSources, syncAllSourcesPrisma, clearSourcePrisma } from '../src/mirror-ops/sync-sources.js';

async function main(): Promise<void> {
    const dryRun = process.argv.includes('--dry-run');
    const clearIdx = process.argv.indexOf('--clear');
    const prisma = createPrismaClient();
    try {
        if (clearIdx !== -1) {
            const handle = process.argv[clearIdx + 1];
            if (!handle || handle.startsWith('--')) {
                console.error('--clear requires a source handle (break-glass, one source at a time)');
                process.exitCode = 1;
                return;
            }
            const src = loadSources().find((s) => s.handle === handle);
            if (!src) {
                console.error(`no seed with handle "${handle}" in mirror-sources.json`);
                process.exitCode = 1;
                return;
            }
            await clearSourcePrisma(prisma, src);
            return;
        }
        const token = process.env.SKILLET_MIRROR_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
        const r = await syncAllSourcesPrisma(prisma, { dryRun, ...(token ? { token } : {}) });
        console.log(`\ntotal: +${r.added} ~${r.updated} =${r.unchanged} skip:${r.skipped} fail:${r.failed} categorized:${r.classified}`);
        if (r.failed > 0 || r.rateLimited)
            process.exitCode = 1;
    }
    finally {
        await prisma.$disconnect();
    }
}

const invokedDirectly =
    process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
