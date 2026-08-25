// Phase 1 of the nightly mirror job: re-sync every curated seed in
// scripts/mirror-sources.json against the Prisma registry.
//
// Claiming (authors.mirror_claimed_at set) does not freeze sync, but it makes
// the author a real person: their profile is never overwritten from the seed
// file (guarded in SQL by lib/mirror-authors) and the curated maxSkills cap no
// longer applies (the engine default does). The denylist is authoritative
// here too: a denylisted seed is skipped, not synced.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { syncRepoSkillsPrisma, GitHubRateLimitError, skillHasModerationHistoryPrisma, deleteSkillPrisma } from '../sync/sync-repo.js';
import { runPrismaTransaction } from '../db/prisma-client.js';
import { upsertMirrorAuthorPrisma } from '../lib/mirror-authors.js';
import { normalizeRepoKey } from '../lib/mirror-screen.js';
import { guessCategory } from '../classify/heuristic.js';
import type { BlobStore } from '../blob-store/types.js';
import { createPrismaBlobStore } from '../blob-store/create-blob-store.js';
import { loadDenylist } from './denylist.js';
import { assertDurableBlobStoreForProd } from './require-durable-blob-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MirrorSource {
    handle: string;
    displayName: string;
    bio?: string;
    repo: string;
    license: string;
    logo: string;
    sourceUrl: string;
    maxSkills?: number;
    /** 'per-skill' forces per-skill bundles (skips coupled skills) — for repos
     *  whose unified bundle would fail path-safety or bust the size cap. */
    syncMode?: 'auto' | 'per-skill';
    /** Skill dirs to drop, matched as a path prefix. The per-source lever for a
     *  good repo carrying a demo or linter corpus that no global rule can name
     *  without taking real skills with it. See SyncContext.excludeDirs. */
    excludeDirs?: string[];
    /** GitHub owner type of the source repo. Gates the claim paths: a User
     *  source can be claimed as a personal account; NULL/'Organization' offers
     *  team-claim only (the conservative default). */
    ownerType?: 'User' | 'Organization';
}

export function loadSources(filePath?: string): MirrorSource[] {
    const raw = readFileSync(filePath ?? join(__dirname, '../../scripts/mirror-sources.json'), 'utf8');
    const parsed = JSON.parse(raw) as { sources?: MirrorSource[] };
    return (parsed.sources ?? []).filter((s) => {
        if (!s.license) {
            console.warn(`! skipping ${s.repo}: no license (redistribution not permitted)`);
            return false;
        }
        return true;
    });
}

export async function authorClaimedPrisma(prisma: PrismaClient, handle: string): Promise<boolean> {
    const row = await prisma.authors.findUnique({
        where: { id: handle },
        select: { mirror_claimed_at: true },
    });
    return row?.mirror_claimed_at != null;
}

/** Per-source outcome, aggregated into the nightly JSON summary line. */
export interface SourceSyncOutcome {
    handle: string;
    repo: string;
    status: 'ok' | 'failed' | 'gone' | 'denylisted' | 'not-attempted';
    error?: string;
}

export interface SyncAllResult {
    added: number;
    updated: number;
    unchanged: number;
    skipped: number;
    classified: number;
    failed: number;
    denylisted: number;
    /** Sources never attempted because a rate limit aborted the run. */
    notAttempted: number;
    rateLimited: boolean;
    sources: SourceSyncOutcome[];
}

export interface SyncAllOptions {
    dryRun?: boolean;
    token?: string;
    sources?: MirrorSource[];
    denylist?: Map<string, string>;
    fetchImpl?: typeof fetch;
    /** Defaults to createPrismaBlobStore(prisma). Tests inject MemoryBlobStore. */
    blobStore?: BlobStore;
}

/** Sync every mirror-sources.json entry. Reused by the nightly ops runner. */
export async function syncAllSourcesPrisma(prisma: PrismaClient, opts: SyncAllOptions = {}): Promise<SyncAllResult> {
    const { dryRun = false, token } = opts;
    assertDurableBlobStoreForProd();
    const blobStore = opts.blobStore ?? createPrismaBlobStore(prisma);
    const sources = opts.sources ?? loadSources();
    const denylist = opts.denylist ?? loadDenylist();

    const result: SyncAllResult = {
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        classified: 0,
        failed: 0,
        denylisted: 0,
        notAttempted: 0,
        rateLimited: false,
        sources: [],
    };

    for (let i = 0; i < sources.length; i++) {
        const src = sources[i]!;
        console.log(`\n@${src.handle}  <-  ${src.repo} (${src.license})`);
        const [owner, repo] = src.repo.split('/');
        if (!owner || !repo) {
            console.warn(`  ! invalid repo "${src.repo}"`);
            result.failed++;
            result.sources.push({ handle: src.handle, repo: src.repo, status: 'failed', error: 'invalid repo' });
            continue;
        }
        // The denylist is the operator kill switch and wins over the seed file.
        const key = normalizeRepoKey(src.repo);
        if (key && denylist.has(key)) {
            console.warn(`  ! denylisted: ${denylist.get(key)}`);
            result.denylisted++;
            result.sources.push({ handle: src.handle, repo: src.repo, status: 'denylisted' });
            continue;
        }
        // Claiming establishes ownership but does not freeze the sync: a claimed
        // brand keeps mirroring from its GitHub source. It DOES lift the curated
        // maxSkills cap (engine default applies, same as a self-connected repo),
        // and the profile upsert below is claim-guarded in SQL.
        const claimed = await authorClaimedPrisma(prisma, src.handle);
        const skillCap = claimed ? undefined : src.maxSkills;
        if (!dryRun) {
            try {
                await upsertMirrorAuthorPrisma(prisma, src.handle, owner, src.repo, src.ownerType ?? null, {
                    displayName: src.displayName,
                    bio: src.bio ?? null,
                    avatarUrl: src.logo,
                    profileUrl: src.sourceUrl,
                    sourceUrl: src.sourceUrl,
                });
            }
            catch (err) {
                console.error(`  ! @${src.handle} skipped: ${(err as Error).message}`);
                result.failed++;
                result.sources.push({ handle: src.handle, repo: src.repo, status: 'failed', error: (err as Error).message });
                continue;
            }
        }
        try {
            const r = await syncRepoSkillsPrisma(prisma, owner, repo, {
                authorHandle: src.handle,
                repoFull: src.repo,
                license: src.license,
                blobStore,
                ...(token ? { token } : {}),
                ...(skillCap != null ? { maxSkills: skillCap } : {}),
                ...(src.syncMode ? { syncMode: src.syncMode } : {}),
                ...(src.excludeDirs?.length ? { excludeDirs: src.excludeDirs } : {}),
                ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
                dryRun,
            });
            result.added += r.added;
            result.updated += r.updated;
            result.unchanged += r.unchanged;
            result.skipped += r.skipped;
            result.sources.push({ handle: src.handle, repo: src.repo, status: 'ok' });
            console.log(`  +${r.added} ~${r.updated} =${r.unchanged} skip:${r.skipped} (${r.total} skills)`);
            // The engine silently slices past the cap; surface the truncation so a
            // growing repo doesn't drop new skills with no trace in the logs.
            if (skillCap != null && r.total === skillCap) {
                console.warn(`  ! @${src.handle} hit maxSkills=${skillCap}; skills past the cap were not synced`);
            }
            // Auto-categorize this source's still-uncategorized public skills.
            // Runs AFTER the sync (never inside a DB txn), scoped to this author,
            // fail-soft. Uses the local deterministic heuristic (no LLM, no
            // network) — the same prefill the publish route applies — so a
            // wrong guess is a one-click fix and every import lands categorized.
            if (!dryRun) {
                try {
                    const pending = await prisma.skills.findMany({
                        where: { author_id: src.handle, category: null, visibility: 'public' },
                        select: { id: true, slug: true, description: true },
                    });
                    let n = 0;
                    for (const skill of pending) {
                        const guess = guessCategory({ slug: skill.slug, description: skill.description });
                        if (!guess) continue;
                        await prisma.skills.update({ where: { id: skill.id }, data: { category: guess } });
                        n++;
                    }
                    result.classified += n;
                    if (n > 0)
                        console.log(`  categorized ${n} skill${n === 1 ? '' : 's'}`);
                }
                catch (err) {
                    console.warn(`  ! @${src.handle} classify skipped: ${(err as Error).message}`);
                }
            }
        }
        catch (err) {
            if (err instanceof GitHubRateLimitError) {
                // Quota is gone; iterating the remaining sources would just fail
                // one by one. Abort the loop and report what was never attempted.
                result.rateLimited = true;
                result.failed++;
                result.sources.push({ handle: src.handle, repo: src.repo, status: 'failed', error: err.message });
                for (const rest of sources.slice(i + 1)) {
                    result.notAttempted++;
                    result.sources.push({ handle: rest.handle, repo: rest.repo, status: 'not-attempted' });
                }
                console.error(`  ! GitHub rate limit reached; ${result.notAttempted} sources not attempted`);
                break;
            }
            console.error(`  ! @${src.handle} failed: ${(err as Error).message}`);
            result.failed++;
            result.sources.push({ handle: src.handle, repo: src.repo, status: 'failed', error: (err as Error).message });
        }
    }

    return result;
}

/** Break-glass removal of ONE seed source's mirrored data. Refuses claimed
 *  authors and refuses entirely (naming the blockers) when any of the
 *  source's skills carry reports or moderation actions — never a partial,
 *  trail-erasing delete. */
export async function clearSourcePrisma(prisma: PrismaClient, src: MirrorSource): Promise<void> {
    if (await authorClaimedPrisma(prisma, src.handle)) {
        throw new Error(`@${src.handle} is claimed; refusing to clear a real owner's account`);
    }
    const skills = await prisma.skills.findMany({
        where: { author_id: src.handle },
        select: { id: true },
    });
    const blocked: string[] = [];
    for (const { id } of skills) {
        if (await skillHasModerationHistoryPrisma(prisma, id))
            blocked.push(id);
    }
    if (blocked.length > 0) {
        throw new Error(`refusing to clear @${src.handle}: moderation history on ${blocked.join(', ')}`);
    }
    for (const { id } of skills) {
        await runPrismaTransaction(prisma, (tx) => deleteSkillPrisma(tx, id));
    }
    // Drop the linked kit first (its owner_id FK references the author).
    await prisma.kits.deleteMany({ where: { owner_id: src.handle, source_type: 'linked' } });
    await prisma.authors.deleteMany({ where: { id: src.handle, is_mirror: 1 } });
    console.log(`cleared @${src.handle} (${skills.length} skills)`);
}
