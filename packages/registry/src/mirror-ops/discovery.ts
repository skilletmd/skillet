// Phase 3 of the nightly mirror job: PROPOSE candidate repos into the mirror
// review queue — it NEVER publishes a mirror directly. Every candidate flows
// through the same `screenCandidate` gate and lands as `pending_review` or
// `rejected_screen`; only a human admin approval (routes/mirror-queue.ts) can
// promote it to a live reserved-claimable mirror.
//
// Candidate seeds: explicit repos, GitHub searches (topics can't be OR'd, so
// each runs separately), and the source_repo provenance of real imports —
// importing a repo you don't own is itself the nomination signal.
//
// Idempotent + resumable: a repo already in-flight in the queue, already live,
// or already a (claimed or unclaimed) mirror author is skipped without burning
// a GitHub call. The GitHub Search API has a separate ~30 req/min limit, so a
// search pass honors rate-limit headers and STOPS on a limit rather than
// treating it as "no results".
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { dedupeMirrorsBy } from '@skillet/protocol';
import { newId } from '../db/index.js';
import { screenCandidate, parseOwnerRepo, normalizeRepoKey } from '../lib/mirror-screen.js';
import { assessCandidateQuality } from '../lib/mirror-quality.js';
// Single source of truth for the in-flight states (mirrors the in-flight
// unique index on mirror_review_queue); imported, not re-declared, so the
// index and every query site cannot drift apart.
import { IN_FLIGHT } from '../routes/mirror-queue.js';
import { loadDenylist } from './denylist.js';

const GH_API = 'https://api.github.com';

/** Env var holding the dedicated discovery token (NOT a per-user token). */
export const DISCOVERY_TOKEN_ENV = 'SKILLET_DISCOVERY_GITHUB_TOKEN';

/** Default quality bar — candidates below this never reach the review queue. */
export const DEFAULT_MIN_QUALITY_SCORE = 60;

export { loadDenylist };

export interface DiscoverOptions {
    prisma: PrismaClient;
    /** Explicit candidate repos ("owner/repo" or GitHub URLs). */
    repos?: string[];
    /** Optional GitHub repository-search query — rate-limited separately. */
    searchQuery?: string;
    /** Additional search queries — each runs separately (topics can't be OR'd). */
    searchQueries?: string[];
    /** Max repos to take from a search query. */
    searchLimit?: number;
    /** Normalized `owner/repo` keys discovery must never propose. Defaults to
     *  scripts/mirror-denylist.json. */
    denylist?: Map<string, string>;
    /** Reject candidates scoring below this on the mechanical quality rubric
     *  (0-100). Unset/0 disables the gate (no extra GitHub calls). */
    minQualityScore?: number;
    /** Seed candidates from the `source_repo` provenance of real imports. */
    fromImports?: boolean;
    /** Dedicated discovery token; defaults to env SKILLET_DISCOVERY_GITHUB_TOKEN. */
    token?: string;
    /** Injectable fetch for tests (mirrors sync-repo.ts / mirror-screen.ts). */
    fetchImpl?: typeof fetch;
    /** List candidates without writing any queue rows. */
    dryRun?: boolean;
}

export interface DiscoverResult {
    enqueued: Array<{ repo: string; handle: string | null; status: string }>;
    skipped: Array<{ repo: string; reason: string }>;
    /** True when GitHub Search rate-limited us — distinct from "no results". */
    rateLimited: boolean;
}

/** Raised when GitHub signals a rate limit; the caller backs off / stops. */
export class DiscoveryRateLimitError extends Error {
    constructor(public resetSeconds: number | null) {
        super('GitHub Search API rate limit reached');
        this.name = 'DiscoveryRateLimitError';
    }
}

function isRateLimited(res: Response): boolean {
    if (res.status === 429)
        return true;
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
        return true;
    return false;
}

function resetSecondsOf(res: Response): number | null {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter && /^\d+$/.test(retryAfter))
        return Number(retryAfter);
    const reset = res.headers.get('x-ratelimit-reset');
    if (reset && /^\d+$/.test(reset)) {
        return Math.max(0, Number(reset) - Math.floor(Date.now() / 1000));
    }
    return null;
}

/**
 * Query the GitHub repository-search API for candidate repos. Honors the
 * separate Search rate limit: on a rate-limited response it THROWS
 * `DiscoveryRateLimitError` (never returns "[]", which would look like an
 * empty result and silently stall discovery).
 */
export async function searchRepos(query: string, opts: { token?: string; fetchImpl?: typeof fetch; limit?: number }): Promise<string[]> {
    const f = opts.fetchImpl ?? globalThis.fetch;
    const limit = opts.limit ?? 30;
    const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': 'skillet-mirror-discovery',
        'x-github-api-version': '2022-11-28',
    };
    if (opts.token)
        headers.authorization = `Bearer ${opts.token}`;
    const url = `${GH_API}/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`;
    const res = await f(url, { headers });
    if (isRateLimited(res))
        throw new DiscoveryRateLimitError(resetSecondsOf(res));
    if (!res.ok)
        throw new Error(`GitHub search → HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as {
        items?: Array<{ full_name?: string }>;
    } | null;
    return (body?.items ?? [])
        .map((it) => it.full_name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/**
 * Distinct `owner/repo` provenance of imported skills — the candidate seed for
 * a `--from-imports` pass. Mirror authors already carry their own source, so
 * skills published under a mirror handle are excluded.
 */
async function importSourceRepos(prisma: PrismaClient): Promise<string[]> {
    const mirrorAuthors = await prisma.authors.findMany({
        where: { is_mirror: 1 },
        select: { id: true },
    });
    const mirrorIds = new Set(mirrorAuthors.map((a) => a.id));
    const rows = await prisma.skills.findMany({
        where: { source_repo: { not: null } },
        select: { source_repo: true, author_id: true },
        distinct: ['source_repo'],
    });
    return rows
        .filter((r) => !mirrorIds.has(r.author_id) && r.source_repo != null)
        .map((r) => r.source_repo as string);
}

/** Normalized keys already occupying an in-flight queue slot. */
async function inflightKeys(prisma: PrismaClient): Promise<Set<string>> {
    const rows = await prisma.mirror_review_queue.findMany({
        where: { status: { in: [...IN_FLIGHT] } },
        select: { normalized_repo_key: true },
    });
    return new Set(rows.map((r) => r.normalized_repo_key));
}

/**
 * Normalized keys of repos that already back a mirror author (live, claimed or
 * not) — those are already published, so discovery must not re-enqueue them.
 */
async function existingMirrorKeys(prisma: PrismaClient): Promise<Map<string, boolean>> {
    const rows = await prisma.authors.findMany({
        where: { is_mirror: 1, mirror_source_url: { not: null } },
        select: { mirror_source_url: true, mirror_claimed_at: true },
    });
    const map = new Map<string, boolean>();
    for (const r of rows) {
        const key = r.mirror_source_url ? normalizeRepoKey(r.mirror_source_url) : null;
        if (key)
            map.set(key, r.mirror_claimed_at != null);
    }
    return map;
}

/**
 * Discovery pass: screen each candidate and enqueue it into the review queue.
 * Never publishes. Idempotent/resumable: skips repos already queued, live, or
 * claimed before making any per-repo GitHub call.
 */
export async function discoverMirrorCandidates(opts: DiscoverOptions): Promise<DiscoverResult> {
    const { prisma } = opts;
    const token = opts.token ?? process.env[DISCOVERY_TOKEN_ENV] ?? undefined;
    const result: DiscoverResult = { enqueued: [], skipped: [], rateLimited: false };

    const raw: string[] = [...(opts.repos ?? [])];
    if (opts.fromImports) {
        raw.push(...(await importSourceRepos(prisma)));
    }
    const queries = [
        ...(opts.searchQuery ? [opts.searchQuery] : []),
        ...(opts.searchQueries ?? []),
    ];
    for (const query of queries) {
        try {
            const found = await searchRepos(query, {
                token,
                fetchImpl: opts.fetchImpl,
                limit: opts.searchLimit,
            });
            raw.push(...found);
        }
        catch (err) {
            if (err instanceof DiscoveryRateLimitError) {
                // Honor the limit: stop querying, flag it, and do NOT treat as
                // "no results" — candidates gathered so far still get screened.
                result.rateLimited = true;
                break;
            }
            throw err;
        }
    }

    // Collapse case/URL-form variants to one candidate via the canonical
    // normalized key (@skillet/protocol root).
    const candidates = dedupeMirrorsBy(raw, (c) => c, (c) => normalizeRepoKey(c));

    const seenInflight = await inflightKeys(prisma);
    const mirrors = await existingMirrorKeys(prisma);
    const seenThisRun = new Set<string>();
    const denylist = opts.denylist ?? loadDenylist();
    const minScore = opts.minQualityScore ?? 0;

    for (const source of candidates) {
        const parsed = parseOwnerRepo(source);
        const key = normalizeRepoKey(source);
        if (!parsed || !key) {
            result.skipped.push({ repo: source, reason: 'unparseable source' });
            continue;
        }
        if (seenThisRun.has(key)) {
            result.skipped.push({ repo: source, reason: 'duplicate in this run' });
            continue;
        }
        seenThisRun.add(key);

        if (denylist.has(key)) {
            result.skipped.push({ repo: source, reason: `denylisted: ${denylist.get(key)}` });
            continue;
        }
        if (mirrors.has(key)) {
            result.skipped.push({ repo: source, reason: mirrors.get(key) ? 'already claimed' : 'already live' });
            continue;
        }
        if (seenInflight.has(key)) {
            result.skipped.push({ repo: source, reason: 'already in the review queue' });
            continue;
        }

        // Screen against the live GitHub source. Handle is DERIVED from the
        // owner login inside screenCandidate — never submitter-supplied.
        const screen = await screenCandidate({
            prisma,
            owner: parsed.owner,
            repo: parsed.repo,
            ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        });
        let status = screen.pass ? 'pending_review' : 'rejected_screen';
        let notes = screen.notes;
        const repoFull = `${parsed.owner}/${parsed.repo}`;

        // Quality gate: legality passed, now is it plausibly good? Below the
        // bar → rejected_screen with the scored notes; above it → the score
        // travels into screen_notes so the admin queue can rank candidates.
        if (screen.pass && minScore > 0) {
            const quality = await assessCandidateQuality({
                owner: parsed.owner,
                repo: parsed.repo,
                ...(token ? { token } : {}),
                ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
            });
            const summary = `quality ${quality.score}/100 across ${quality.skillCount} skills — ${quality.notes.join('; ')}`;
            if (quality.hardFail) {
                status = 'rejected_screen';
                notes = `quality: ${quality.hardFail}`;
            }
            else if (quality.score < minScore) {
                status = 'rejected_screen';
                notes = `below quality bar (${quality.score} < ${minScore}): ${summary}`;
            }
            else {
                notes = summary;
            }
        }

        if (opts.dryRun) {
            result.enqueued.push({ repo: repoFull, handle: screen.derivedHandle, status });
            continue;
        }

        try {
            await prisma.mirror_review_queue.create({
                data: {
                    id: newId(),
                    source_repo: repoFull,
                    normalized_repo_key: key,
                    source_owner_login: screen.ownerLogin,
                    source_owner_id: screen.ownerId,
                    derived_handle: screen.derivedHandle,
                    owner_type: screen.ownerType,
                    license: screen.license,
                    status,
                    submitted_by: 'discovery',
                    screen_notes: notes,
                },
            });
            // Reserve the in-flight slot for the rest of this run.
            if (status !== 'rejected_screen')
                seenInflight.add(key);
            result.enqueued.push({ repo: repoFull, handle: screen.derivedHandle, status });
        }
        catch (err) {
            // Lost the race against the in-flight unique index (concurrent run).
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                result.skipped.push({ repo: repoFull, reason: 'already in the review queue' });
                continue;
            }
            throw err;
        }
    }

    return result;
}
