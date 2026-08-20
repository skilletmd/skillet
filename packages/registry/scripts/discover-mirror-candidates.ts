/**
 * Discovery pass CLI: PROPOSE candidate repos into the mirror review queue.
 * Thin entry; the logic lives in src/mirror-ops/discovery.ts (typechecked,
 * tested). Never publishes — only admin approval promotes a candidate.
 *
 *   cd packages/registry
 *   set -a && . ./.env && set +a
 *   SKILLET_DISCOVERY_GITHUB_TOKEN=ghp_... \
 *   npx tsx scripts/discover-mirror-candidates.ts owner/repo other/repo
 *   ... --query "topic:claude-skills" --from-imports --min-quality 60 --dry-run
 *
 * Credential: a DEDICATED least-privilege token in SKILLET_DISCOVERY_GITHUB_TOKEN
 * (public-repo read only), DISTINCT from per-user tokens. GitHub Search has a
 * separate ~30 req/min limit; a limited response stops the pass rather than
 * reading as "no results".
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { discoverMirrorCandidates, DEFAULT_MIN_QUALITY_SCORE } from '../src/mirror-ops/discovery.js';

export { discoverMirrorCandidates, searchRepos, loadDenylist, DiscoveryRateLimitError, DISCOVERY_TOKEN_ENV, DEFAULT_MIN_QUALITY_SCORE, type DiscoverOptions, type DiscoverResult } from '../src/mirror-ops/discovery.js';

function flagValue(name: string): string | undefined {
    const idx = process.argv.indexOf(name);
    const val = idx !== -1 ? process.argv[idx + 1] : undefined;
    return val && !val.startsWith('--') ? val : undefined;
}

async function main(): Promise<void> {
    const dryRun = process.argv.includes('--dry-run');
    const fromImports = process.argv.includes('--from-imports');
    const query = flagValue('--query');
    const minQuality = flagValue('--min-quality');
    const repos = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--query' && all[i - 1] !== '--min-quality');
    const prisma = createPrismaClient();
    try {
        const result = await discoverMirrorCandidates({
            prisma,
            repos,
            ...(query ? { searchQuery: query } : {}),
            fromImports,
            minQualityScore: minQuality != null ? Number(minQuality) : DEFAULT_MIN_QUALITY_SCORE,
            dryRun,
        });
        for (const e of result.enqueued)
            console.log(`  ${e.status}: ${e.repo} → @${e.handle ?? '?'}`);
        for (const s of result.skipped)
            console.log(`  skip: ${s.repo} (${s.reason})`);
        if (result.rateLimited) {
            console.warn('GitHub Search rate limit reached; pass stopped early');
            process.exitCode = 1;
        }
    }
    finally {
        await prisma.$disconnect();
    }
}

const invokedDirectly =
    process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
