/**
 * Reusable engine that syncs a public GitHub repo's skills into the registry,
 * content-addressed and idempotent. Shared by ops mirror seeding
 * (scripts/sync-mirror-skills.ts) and self-serve "connect your repo"
 * (routes/connected-repos.ts). See docs/plans/connect-your-repo.md.
 *
 * It writes skills/versions/blobs/files + a `skill_mirrors` provenance row, runs
 * the scan in the same transaction, and attests each version with the platform
 * key (lib/platform-signing.ts) — there is no author key to sign with, and
 * unsigned versions are rejected by device sync. They still render
 * "GitHub-synced / unverified" (external_author provenance). The CALLER
 * owns the `authors` row (an ops mirror sets is_mirror=1; a connected repo uses the
 * user's already-claimed handle), so this engine never decides claim/mirror policy.
 */
import type { DatabaseSync } from '../db/sqlite-handle.js';
import type { PrismaClient } from '@prisma/client';
import { canonicalContentHash, validateBundle, BundleError, MAX_BUNDLE_BYTES, isExcludedDiscoveryPath, isCoupledSkillMarkdown, classifyImport, dedupeMirrorsBy, slugify as canonicalSlugify } from '@skillet/protocol';
import { humanizeSlug } from '@skillet/protocol/humanize';
import { blobHash, newId } from '../db/index.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { runPrismaTransaction } from '../db/prisma-client.js';
import { slugify as kitSlugify } from '../slug.js';
import { classifyVersionBumpPrisma, deriveVersionLabelPrisma } from '../version-label.js';
import { secretsBlockingScan } from '../scanner/scanner.js';
import { resolveScanCachedPrisma } from '../scanner/runner.js';
import { publishKitVersionPrisma } from '../lib/kit-mutations.js';
import { computeSkillTokens } from '../lib/skill-tokens.js';
import { findKitBySourceRepoPrisma } from '../lib/kit-payload.js';
import { attestVersionRowIfUnsignedPrisma } from '../lib/platform-signing.js';
import { lastCleanHashPrisma } from '../lib/sync-manifest.js';
import { persistVersionScanPrisma } from '../lib/skill-publish.js';
import { toSkillId } from '@skillet/protocol/skill-id';
import { ghFetch } from './gh-fetch.js';
import type { BlobStore } from '../blob-store/types.js';
import { putFileBlobs } from '../blob-store/put-file-blobs.js';
const GH_API = 'https://api.github.com';
const GH_RAW = 'https://raw.githubusercontent.com';
// Size limits come from the protocol (§2.1), the same caps direct-publish and
// the web importer enforce (MAX_BUNDLE_BYTES = 25 MB). Sync MUST NOT invent its
// own caps: a tighter bundle cap silently nulls out a 5–25 MB skill on the next
// sync, and a per-file cap silently drops oversized files into a hollow skill
// whose content hash then diverges from what publish computes. See
// docs/plans/skill-dependency-closure.md (cap-mismatch note).
export interface TreeBlob {
    path: string;
    size: number;
}
export interface DiscoveredGitHubSkill {
    dir: string;
    slug: string;
    name: string;
    description: string;
    /** SKILL.md references a path outside its own folder (`../`) — see classifyImport. */
    coupled: boolean;
    files: TreeBlob[];
}
export interface Discovery {
    owner: string;
    repo: string;
    ref: string;
    sha: string | null;
    skills: DiscoveredGitHubSkill[];
    /** All non-excluded repo blobs, for a unified (whole-repo) bundle. */
    allFiles: TreeBlob[];
}
export interface SyncContext {
    /** Handle the skills are published under (must already exist in `authors`). */
    authorHandle: string;
    /** "owner/repo", stored as skill_mirrors.source_repo. */
    repoFull: string;
    license: string | null;
    /** Blob backend for skill file bytes (R2 in prod, memory in tests). */
    blobStore: BlobStore;
    /** GitHub token for higher rate limits / private repos (optional for public). */
    token?: string;
    /** Sync only these skill dirs (relative to repo root). Undefined = all skills. */
    selectedDirs?: string[];
    /** Skill dirs to drop, matched as a path PREFIX (a dir and everything under
     *  it). For a repo whose skills are real but whose tree also carries a
     *  demo/linter corpus that the global fixture-segment rule can't name:
     *  flutter/agent-plugins ships `tool/dart_skills_lint/example/skills/{valid,
     *  invalid}` as its linter's own test corpus. `example` is NOT a global
     *  exclusion — eleven live skills across topoteretes and tradermonty are
     *  real skills that happen to sit under `examples/`. This is the per-source
     *  lever for that case. Excluded dirs are absent from `seen`, so previously
     *  published ones tombstone on the next sync. */
    excludeDirs?: string[];
    /** Name for the linked kit (user-chosen). Defaults to the humanized repo name. */
    kitName?: string;
    /** Bundle >1 skill into a linked kit. Default true (a multi-skill repo is a
     *  kit). false publishes the skills loose, with no kit. */
    bundle?: boolean;
    /** 'per-skill' bypasses the coupled-repo unified classification and syncs each
     *  skill dir as its own bundle, SKIPPING coupled skills (their `../` refs can't
     *  resolve standalone). For repos whose stray shared files (hooks/, mcp.json)
     *  make a unified bundle fail path-safety, or whose whole-repo size busts the
     *  bundle cap, while the individual skills are clean. Default: auto-classify. */
    syncMode?: 'auto' | 'per-skill';
    maxSkills?: number;
    dryRun?: boolean;
    /** Injectable for tests. */
    fetchImpl?: typeof fetch;
}
/** Default upper bound on skills synced per repo when no explicit cap is given. */
export const DEFAULT_MAX_SKILLS_PER_SYNC = 500;
/** GitHub API quota exhausted. Batch callers (the nightly mirror job) abort
 *  their remaining sources on this instead of iterating through failures. */
export class GitHubRateLimitError extends Error {
    constructor() {
        super('GitHub rate limit reached');
        this.name = 'GitHubRateLimitError';
    }
}
export interface SyncResult {
    added: number;
    updated: number;
    unchanged: number;
    skipped: number;
    ref: string;
    sha: string | null;
    total: number;
    /** Slugs of all skills currently synced from this repo (for the UI). */
    skills: string[];
    /** The linked kit id when the repo has >1 skill, else null. */
    kitId: string | null;
    /** The linked kit name, when one exists. */
    kitName: string | null;
    /** Vanished-upstream skills kept because they carry reports/moderation history. */
    tombstonesSkipped?: number;
    /** Vanished-upstream skills whose delete threw (logged, source not wedged). */
    tombstonesFailed?: number;
}
function ghHeaders(token?: string): Record<string, string> {
    const h: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': 'skillet-sync',
        'x-github-api-version': '2022-11-28',
    };
    if (token)
        h.authorization = `Bearer ${token}`;
    return h;
}
/**
 * The repo is not there any more: deleted, renamed, or gone private.
 *
 * Distinct from a transient failure because the retry never succeeds. A mirror
 * we discovered months ago whose repo has since vanished would otherwise fail
 * on every nightly run forever, and take the whole job's exit code with it.
 */
export class GitHubRepoGoneError extends Error {
    constructor(public readonly url: string) {
        super(`GitHub ${url} → HTTP 404 (repo gone)`);
        this.name = 'GitHubRepoGoneError';
    }
}

async function ghJson<T>(url: string, ctx: Pick<SyncContext, 'token' | 'fetchImpl'>): Promise<T> {
    const res = await ghFetch(url, { headers: ghHeaders(ctx.token) }, { fetchImpl: ctx.fetchImpl });
    if (!res.ok) {
        if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
            throw new GitHubRateLimitError();
        }
        if (res.status === 404) throw new GitHubRepoGoneError(url);
        throw new Error(`GitHub ${url} → HTTP ${res.status}`);
    }
    return (await res.json()) as T;
}
async function fetchRaw(owner: string, repo: string, ref: string, path: string, ctx: Pick<SyncContext, 'token' | 'fetchImpl'>): Promise<Uint8Array> {
    const encPath = path
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
    const headers: Record<string, string> = { 'user-agent': 'skillet-sync' };
    if (ctx.token)
        headers.authorization = `Bearer ${ctx.token}`;
    const res = await ghFetch(`${GH_RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/${encPath}`, {
        headers,
    }, { fetchImpl: ctx.fetchImpl });
    if (!res.ok)
        throw new Error(`download ${path} failed (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
}
/** Read `name`/`description` from a SKILL.md YAML frontmatter block. Handles
 *  plain scalars and block scalars (`>`/`>-`/`>+` fold to spaces, `|` variants
 *  keep newlines) — vendors like MongoDB and Stripe write `description: >-`,
 *  and a line-based parse would store the literal indicator as the value. */
export function parseFrontmatter(md: string): {
    name?: string;
    description?: string;
} {
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m)
        return {};
    const lines = m[1]!.split(/\r?\n/);
    const out: Record<string, string> = {};
    for (let i = 0; i < lines.length; i++) {
        const kv = lines[i]!.match(/^([a-zA-Z_]+):\s*(.*)$/);
        if (!kv)
            continue;
        const key = kv[1]!;
        const rest = kv[2]!.trim();
        const scalar = rest.match(/^([>|])[+-]?$/);
        if (scalar) {
            // Block scalar: collect the following more-indented lines.
            const block: string[] = [];
            while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || lines[i + 1]!.trim() === '')) {
                block.push(lines[++i]!.trim());
            }
            while (block.length > 0 && block[block.length - 1] === '')
                block.pop();
            out[key] = block.join(scalar[1] === '>' ? ' ' : '\n').trim();
        }
        else {
            out[key] = rest.replace(/^['"]|['"]$/g, '');
        }
    }
    return { name: out['name'], description: out['description'] };
}
export function slugify(input: string): string {
    return canonicalSlugify(input, { fallback: 'skill', maxLength: 64 });
}
/** Re-root a repo-relative path to the skill's own root (strip the skill dir). */
export function reroot(repoPath: string, skillDir: string): string {
    if (!skillDir)
        return repoPath;
    const prefix = skillDir.endsWith('/') ? skillDir : skillDir + '/';
    return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
}
/** Find every SKILL.md, group sibling files under each, parse name/description. */
export async function discover(owner: string, repo: string, ctx: SyncContext): Promise<Discovery> {
    const meta = await ghJson<{
        default_branch?: string;
    }>(`${GH_API}/repos/${owner}/${repo}`, ctx);
    const ref = meta.default_branch ?? 'main';
    const branch = await ghJson<{
        commit?: {
            sha?: string;
        };
    }>(`${GH_API}/repos/${owner}/${repo}/branches/${encodeURIComponent(ref)}`, ctx).catch(() => ({ commit: undefined }));
    const sha = branch.commit?.sha ?? null;
    const tree = await ghJson<{
        tree?: Array<{
            path?: string;
            type?: string;
            size?: number;
        }>;
    }>(`${GH_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, ctx);
    // Exclude tool-mirror dot-dirs (.claude/.gemini/.codex-plugin), VCS/CI, build,
    // and deps — the same rule the web importer uses (@skillet/protocol), so both
    // paths discover the same skills and never publish generated duplicates.
    const blobs: TreeBlob[] = (tree.tree ?? [])
        .filter((t) => t.type === 'blob' && typeof t.path === 'string')
        .filter((t) => !isExcludedDiscoveryPath(t.path as string))
        .map((t) => ({ path: t.path as string, size: typeof t.size === 'number' ? t.size : 0 }));
    const skillDirs = blobs
        .filter((b) => b.path === 'SKILL.md' || b.path.endsWith('/SKILL.md'))
        .map((b) => (b.path === 'SKILL.md' ? '' : b.path.slice(0, -'/SKILL.md'.length)))
        .sort((a, b) => b.length - a.length);
    const claimed = new Set<string>();
    const raw: Array<{
        skill: DiscoveredGitHubSkill;
        body: string;
        base: string;
    }> = [];
    for (const dir of skillDirs) {
        const prefix = dir ? dir + '/' : '';
        const files = blobs.filter((b) => (dir === '' ? true : b.path.startsWith(prefix)) && !claimed.has(b.path));
        if (!files.some((file) => file.path === `${prefix}SKILL.md`))
            continue;
        for (const file of files)
            claimed.add(file.path);
        const skillMd = await fetchRaw(owner, repo, ref, `${prefix}SKILL.md`, ctx).catch(() => null);
        const text = skillMd ? Buffer.from(skillMd).toString('utf8') : '';
        const fm = text ? parseFrontmatter(text) : {};
        const base = dir ? dir.split('/').pop()! : repo;
        // No description, no skill. The description IS the trigger an agent
        // matches on, so a skill without one can never be selected — it is dead
        // weight in the catalog and in every installer's context. In practice it
        // means a scaffold or fixture: EveryInc's `custom-skill` and
        // `default-skill` carry an empty description and nothing else.
        if (!fm.description || !fm.description.trim())
            continue;
        raw.push({
            skill: {
                dir,
                // Provisional: the real slug is assigned after dedupe, below.
                slug: '',
                name: fm.name || base,
                description: fm.description || '',
                coupled: isCoupledSkillMarkdown(text),
                files,
            },
            body: text.trim(),
            base,
        });
    }
    // Drop mirror copies (e.g. plugins/<tool>/skills/x duplicating skills/x), the
    // same content-dedupe the web importer applies.
    const survivors = dedupeMirrorsBy(raw, (r) => r.skill.dir, (r) => r.body || null);
    // Slugs are assigned HERE, after dedupe, and never before it. `skillDirs` is
    // sorted longest-path-first, so a tool-mirror copy (providers/codex/plugin/
    // skills/stripe-projects) is visited before the canonical one it duplicates
    // (skills/stripe-projects). Uniquifying during discovery therefore handed the
    // clean slug to the copy and left the survivor — the canonical dir dedupe
    // keeps — holding the collision suffix: `redis-search-2` for two copies,
    // `stripe-projects-6` for six. Deduping first means the suffix only ever
    // appears for a genuine same-slug collision between distinct skills.
    const usedSlugs = new Set<string>();
    const skills = survivors.map((r) => {
        const wanted = slugify(r.skill.name || r.base);
        let slug = wanted;
        let n = 2;
        while (usedSlugs.has(slug))
            slug = `${wanted}-${n++}`;
        usedSlugs.add(slug);
        return { ...r.skill, slug };
    });
    return { owner, repo, ref, sha, skills, allFiles: blobs };
}
async function buildBundle(owner: string, repo: string, ref: string, skill: DiscoveredGitHubSkill, ctx: SyncContext): Promise<Map<string, Uint8Array> | null> {
    const bundle = new Map<string, Uint8Array>();
    // Early-bail on the tree-reported size so we never fetch a blob that cannot
    // fit the bundle cap. There is no per-file cap (the protocol has none): a
    // single large reference belongs in the bundle as long as the total fits.
    let declaredTotal = 0;
    for (const file of skill.files) {
        declaredTotal += file.size;
        if (declaredTotal > MAX_BUNDLE_BYTES)
            return null;
        const bytes = await fetchRaw(owner, repo, ref, file.path, ctx);
        bundle.set(reroot(file.path, skill.dir), bytes);
    }
    if (!bundle.has('SKILL.md'))
        return null;
    // Enforce exactly what direct-publish enforces (total + instruction caps +
    // path safety) on the real bytes, so a mirror can never diverge from the
    // canonical validator. An over-cap or unsafe bundle is skipped, not truncated.
    try {
        validateBundle(bundle);
    }
    catch (err) {
        if (err instanceof BundleError)
            return null;
        throw err;
    }
    return bundle;
}
/**
 * A coupled repo (classifyImport → 'unified') with no root SKILL.md needs a
 * synthesized entrypoint that names the bundled skills. Mirrors the web
 * importer's synthesizeUnifiedIndex.
 */
function synthesizeUnifiedIndex(discovery: Discovery): string {
    const list = discovery.skills
        .map((s) => `- \`${s.dir}/SKILL.md\`${s.description ? ` — ${s.description}` : ''}`)
        .join('\n');
    const front = `---\nname: ${discovery.repo}\ndescription: ${discovery.skills.length} related skills from ${discovery.owner}/${discovery.repo}, bundled because they share files.\n---`;
    return `${front}\n\n# ${humanizeRepo(discovery.repo)}\n\nThis skill bundles ${discovery.skills.length} related skills that reference shared files, so they install and run together:\n\n${list}\n`;
}
/**
 * Build ONE bundle for a coupled repo: every non-excluded blob, rooted at the
 * repo so the skills' `../` references resolve, with a synthesized root index
 * when the repo has none. Same shape as the web importRepoAsUnifiedSkill, and
 * enforces the same protocol caps via validateBundle.
 */
async function buildUnifiedBundle(discovery: Discovery, ctx: SyncContext): Promise<Map<string, Uint8Array> | null> {
    const bundle = new Map<string, Uint8Array>();
    let declaredTotal = 0;
    for (const file of discovery.allFiles) {
        declaredTotal += file.size;
        if (declaredTotal > MAX_BUNDLE_BYTES)
            return null;
        const bytes = await fetchRaw(discovery.owner, discovery.repo, discovery.ref, file.path, ctx);
        bundle.set(file.path, bytes);
    }
    if (!bundle.has('SKILL.md')) {
        bundle.set('SKILL.md', new Uint8Array(Buffer.from(synthesizeUnifiedIndex(discovery), 'utf8')));
    }
    try {
        validateBundle(bundle);
    }
    catch (err) {
        if (err instanceof BundleError)
            return null;
        throw err;
    }
    return bundle;
}
/** Upsert one skill version + provenance + scan, atomically. */
export async function writeSkill(_db: DatabaseSync, _ctx: SyncContext, _discovery: {
    owner: string;
    repo: string;
    ref: string;
}, _skill: DiscoveredGitHubSkill, _skillId: string, _bundle: Map<string, Uint8Array>, _versionHash: string): Promise<void> {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: writeSkillPrisma");
}
/**
 * Prisma async counterpart of {@link writeSkill}. Puts file bytes via BlobStore
 * (R2 / memory), then commits skill metadata without MySQL inline bytes.
 */
export async function writeSkillPrisma(prisma: PrismaClient, ctx: SyncContext, discovery: {
    owner: string;
    repo: string;
    ref: string;
}, skill: DiscoveredGitHubSkill, skillId: string, bundle: Map<string, Uint8Array>, versionHash: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const sourcePath = skill.dir ? `${skill.dir}/SKILL.md` : 'SKILL.md';
    const sourceUrl = `https://github.com/${discovery.owner}/${discovery.repo}/tree/${discovery.ref}/${skill.dir}`;
    const metadata = JSON.stringify({
        version: '1.0.0',
        mirror: true,
        source: {
            repo: ctx.repoFull,
            ref: discovery.ref,
            path: sourcePath,
            url: sourceUrl,
            license: ctx.license,
        },
    });
    const files: Array<{
        path: string;
        hash: string;
        bytes: Uint8Array;
    }> = [];
    for (const [path, bytes] of bundle) {
        const copy = Uint8Array.from(bytes);
        files.push({ path, hash: blobHash(copy), bytes: copy });
    }
    const baseRow = await prisma.skills.findUnique({
        where: { id: skillId },
        select: { latest_hash: true },
    });
    const nextSkillMdBytes = bundle.get('SKILL.md');
    const nextSkillMd = nextSkillMdBytes ? Buffer.from(nextSkillMdBytes).toString('utf8') : null;
    // Context-weight metering (U4): compute from the (possibly synthesized)
    // SKILL.md before the version write. Recompute is already gated upstream by
    // skill_mirrors.computed_hash (an unchanged upstream returns before this
    // runs). token_bundle stays null in v1.
    const skillTokens = computeSkillTokens(nextSkillMd ?? '');
    const bumpKind = await classifyVersionBumpPrisma(prisma, {
        skillId,
        baseHash: baseRow?.latest_hash ?? null,
        nextFiles: new Map(files.map((f) => [f.path, f.hash])),
        nextSkillMd,
        readBlob: (hash) => ctx.blobStore.get(hash),
    });
    // Put-before-txn matches publish: BlobStore owns bytes + meta rows; the
    // transaction only links skill_version_files to those hashes.
    await putFileBlobs(ctx.blobStore, files);

    // Scan BEFORE the transaction, not inside it.
    //
    // The invariant is unchanged and in fact stronger: nothing may be published
    // unscanned. A scan that throws here means the transaction never opens, so
    // there is no partial state to roll back and the skill is retried next run.
    //
    // It moved because `scanBothFresh` walks the whole bundle on the CPU, and
    // running that inside an interactive transaction blew Prisma's 5s ceiling on
    // larger repos: `Transaction already closed ... 6344ms passed`. The upsert
    // that tripped it was the last write, so the skill was dropped from the run
    // entirely and silently went unscanned — the exact outcome the in-transaction
    // placement was meant to prevent. It also held row locks on skills and
    // skill_versions for the length of a scan.
    //
    // The cache write inside resolveScanCachedPrisma is now outside the
    // transaction too. That is fine: the cache is keyed by content hash, so an
    // entry surviving a failed publish is correct rather than stale.
    const resolved = await resolveScanCachedPrisma(prisma, bundle);
    const scanResult = resolved.result;
    // U7 — sync can't 422 (it's automated), so it HOLDS. A synced version that
    // scans as a secret or quarantined never becomes the installable pointer.
    const secretHit = secretsBlockingScan(bundle);
    const blocked = Boolean(secretHit) || scanResult.status === 'quarantined';

    await runPrismaTransaction(prisma, async (tx) => {
        await tx.skills.upsert({
            where: { id: skillId },
            create: {
                id: skillId,
                author_id: ctx.authorHandle,
                slug: skill.slug,
                description: skill.description,
                latest_hash: versionHash,
                visibility: 'public',
                install_count: 0,
                created_at: now,
                source_repo: ctx.repoFull,
                source_url: sourceUrl,
            },
            update: {
                description: skill.description,
                latest_hash: versionHash,
                visibility: 'public',
                source_repo: ctx.repoFull,
                source_url: sourceUrl,
            },
        });
        const { label } = await deriveVersionLabelPrisma(tx, skillId, bumpKind);
        await tx.skill_versions.createMany({
            data: [
                {
                    hash: versionHash,
                    skill_id: skillId,
                    metadata_json: metadata,
                    published_at: now,
                    published_by: ctx.authorHandle,
                    major: label.major,
                    minor: label.minor,
                    patch: label.patch,
                    token_count: skillTokens.count,
                    token_ambient: skillTokens.ambient,
                    token_bundle: null,
                    token_method: skillTokens.method,
                },
            ],
            skipDuplicates: true,
        });
        // Mirrored versions have no author to sign them — attest with the
        // platform key so device sync can verify (unsigned versions are rejected
        // client-side with `unsigned_version`).
        await attestVersionRowIfUnsignedPrisma(tx, {
            skillId,
            hash: versionHash,
            ref: `@${ctx.authorHandle}/${skill.slug}`,
        });
        await tx.skill_version_files.createMany({
            data: files.map((file) => ({
                skill_id: skillId,
                version_hash: versionHash,
                path: file.path,
                blob_hash: file.hash,
            })),
            skipDuplicates: true,
        });
        await tx.skill_mirrors.upsert({
            where: { skill_id: skillId },
            create: {
                skill_id: skillId,
                source_repo: ctx.repoFull,
                source_ref: discovery.ref,
                source_path: sourcePath,
                source_url: sourceUrl,
                license: ctx.license,
                computed_hash: versionHash,
                synced_at: now,
            },
            update: {
                source_repo: ctx.repoFull,
                source_ref: discovery.ref,
                source_path: sourcePath,
                source_url: sourceUrl,
                license: ctx.license,
                computed_hash: versionHash,
                synced_at: now,
            },
        });
        // The scan is resolved above; this writes it. Same cache-aware resolve
        // publish uses, so a synced version lands with its capability manifest as
        // well as its threat findings. Passing a null manifest here (as this path
        // once did) left every mirrored skill reading "not yet scanned" on its
        // skill and kit pages forever, since the trust panel keys that state off a
        // missing capability report.
        await persistVersionScanPrisma(tx, skillId, versionHash, scanResult.status, resolved.findingsJson, resolved.capabilitiesJson);
        // A held version's latest_hash falls back to the last clean version, and
        // blocked_hash remembers what we held so the skill page can show a banner.
        if (blocked) {
            if (secretHit && scanResult.status !== 'quarantined') {
                await tx.skill_version_scans.update({
                    where: {
                        skill_id_skill_version_id: {
                            skill_id: skillId,
                            skill_version_id: versionHash,
                        },
                    },
                    data: { status: 'quarantined' },
                });
            }
            await tx.skills.update({
                where: { id: skillId },
                data: { latest_hash: await lastCleanHashPrisma(tx, skillId) },
            });
            await tx.skill_mirrors.update({
                where: { skill_id: skillId },
                data: { blocked_hash: versionHash },
            });
        }
        else {
            await tx.skill_mirrors.update({
                where: { skill_id: skillId },
                data: { blocked_hash: null },
            });
        }
    });
}
/**
 * Display name for a repo (the generated kit name, and the unified bundle's
 * title). Delegates to the shared humanizer so a mirrored repo's kit and its
 * skills title-case identically — this used to be a bare
 * `\b\w -> uppercase`, which produced the kit "Ui Skills" for a repo whose
 * skills rendered "UI Skills Root".
 */
function humanizeRepo(repo: string): string {
    return humanizeSlug(repo);
}
/** Prisma async counterpart of {@link uniqueKitSlug}. */
export async function uniqueKitSlugPrisma(prisma: PrismaDb, owner: string, name: string): Promise<string> {
    const base = kitSlugify(name);
    let slug = base;
    let n = 2;
    for (;;) {
        const kitHit = await prisma.kits.findFirst({
            where: { owner_id: owner, slug },
            select: { id: true },
        });
        if (!kitHit) {
            const aliasHit = await prisma.kit_slug_aliases.findUnique({
                where: { owner_id_slug: { owner_id: owner, slug } },
                select: { kit_id: true },
            });
            if (!aliasHit)
                return slug;
        }
        slug = `${base}-${n++}`;
    }
}
/**
 * A repo with >1 skill is a kit (docs/plans/connect-your-repo.md): ensure a
 * repo-linked kit owned by the author, reconcile its membership to exactly the
 * repo's synced skills, and publish a version (major bump on composition change,
 * minor on content — see publishKitVersion). A single-skill repo gets no kit.
 * Returns the kit id, or null when it stays a loose skill.
 */
export function ensureLinkedKit(_db: DatabaseSync, _ctx: SyncContext, _discovery: {
    repo: string;
    ref: string;
    sha: string | null;
}, _skillIds: string[]): string | null {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: ensureLinkedKitPrisma");
}
/** Prisma async counterpart of {@link ensureLinkedKit}. */
export async function ensureLinkedKitPrisma(prisma: PrismaClient, ctx: SyncContext, discovery: {
    repo: string;
    ref: string;
    sha: string | null;
}, skillIds: string[]): Promise<string | null> {
    // <=1 skill is never a kit; bundle === false opts a multi-skill repo out too.
    if (skillIds.length <= 1 || ctx.bundle === false)
        return null;
    const existingId = await findKitBySourceRepoPrisma(prisma, ctx.authorHandle, ctx.repoFull, 'linked');
    const name = ctx.kitName?.trim() || humanizeRepo(discovery.repo);
    let kitId: string;
    if (existingId) {
        kitId = existingId;
        // Re-sync owns the skill set and the source pointer, but NOT the name — the
        // owner can rename a linked kit in Skillet and the pull must preserve it.
        await prisma.kits.update({
            where: { id: kitId },
            data: {
                source_ref: discovery.ref,
                last_synced_sha: discovery.sha,
            },
        });
    }
    else {
        kitId = newId();
        // Slug is the public permalink (/{owner}/kit/{slug}). Unlike the create
        // route, sync can't 409 on a name collision, so dedupe with a -2 suffix.
        const slug = await uniqueKitSlugPrisma(prisma, ctx.authorHandle, name);
        await prisma.kits.create({
            data: {
                id: kitId,
                owner_id: ctx.authorHandle,
                name,
                slug,
                description: null,
                visibility: 'public',
                source_type: 'linked',
                source_repo: ctx.repoFull,
                source_ref: discovery.ref,
                source_path: null,
                last_synced_sha: discovery.sha,
            },
        });
    }
    // Reconcile membership to exactly skillIds (unpinned → tracks latest).
    const haveRows = await prisma.kit_skills.findMany({
        where: { kit_id: kitId },
        select: { skill_id: true },
    });
    const have = new Set(haveRows.map((r) => r.skill_id));
    const want = new Set(skillIds);
    const toRemove = [...have].filter((id) => !want.has(id));
    if (toRemove.length > 0) {
        await prisma.kit_skills.deleteMany({
            where: { kit_id: kitId, skill_id: { in: toRemove } },
        });
    }
    const toAdd = [...want].filter((id) => !have.has(id));
    if (toAdd.length > 0) {
        await prisma.kit_skills.createMany({
            data: toAdd.map((skill_id) => ({
                kit_id: kitId,
                skill_id,
                pinned_hash: null,
            })),
            skipDuplicates: true,
        });
    }
    // No-op if the snapshot is unchanged; else major/minor bump.
    await publishKitVersionPrisma(prisma, kitId, `Synced from ${ctx.repoFull}`, ctx.authorHandle);
    return kitId;
}
/** Delete a synced skill and its versions/files/scans/lock. */
export function deleteSkill(_db: DatabaseSync, _skillId: string): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: deleteSkillPrisma");
}
/**
 * Visibility + mirror provenance for a skill id. Used by sync apply to refuse
 * flipping a private non-mirror (or other-repo) skill public.
 */
export type SkillMirrorCollision = {
    visibility: string;
    source_repo: string | null;
};
/** Prisma read of skill visibility joined with skill_mirrors.source_repo. */
export async function getSkillMirrorCollisionPrisma(prisma: PrismaDb, skillId: string): Promise<SkillMirrorCollision | null> {
    const skill = await prisma.skills.findUnique({
        where: { id: skillId },
        select: { visibility: true },
    });
    if (!skill)
        return null;
    const mirror = await prisma.skill_mirrors.findUnique({
        where: { skill_id: skillId },
        select: { source_repo: true },
    });
    return {
        visibility: skill.visibility,
        source_repo: mirror?.source_repo ?? null,
    };
}
/** Prisma read of skill_mirrors.computed_hash (content lock for idempotent sync). */
export async function getSkillMirrorComputedHashPrisma(prisma: PrismaDb, skillId: string): Promise<string | null> {
    const row = await prisma.skill_mirrors.findUnique({
        where: { skill_id: skillId },
        select: { computed_hash: true },
    });
    return row?.computed_hash ?? null;
}
export type RepoMirroredSkill = {
    id: string;
    slug: string;
};
/**
 * Skills currently mirrored from a repo under an author. Same row set the sync
 * engine uses for kit membership and result.skills after a pull.
 */
export async function listRepoMirroredSkillsPrisma(prisma: PrismaDb, authorHandle: string, repoFull: string): Promise<RepoMirroredSkill[]> {
    const mirrors = await prisma.skill_mirrors.findMany({
        where: { source_repo: repoFull },
        select: { skill_id: true },
    });
    if (mirrors.length === 0)
        return [];
    return prisma.skills.findMany({
        where: {
            author_id: authorHandle,
            id: { in: mirrors.map((m) => m.skill_id) },
        },
        select: { id: true, slug: true },
    });
}
/** True when the skill carries user reports or admin moderation actions.
 *  Both tables FK `skills` with NoAction, and the moderation trail must
 *  outlive a mirrored skill, so tombstoning skips these. */
export async function skillHasModerationHistoryPrisma(prisma: PrismaDb, skillId: string): Promise<boolean> {
    const report = await prisma.skill_reports.findFirst({
        where: { skill_id: skillId },
        select: { id: true },
    });
    if (report)
        return true;
    const action = await prisma.skill_moderation_actions.findFirst({
        where: { skill_id: skillId },
        select: { id: true },
    });
    return action != null;
}
/** Prisma async counterpart of {@link deleteSkill} (U4 sync manifests). */
export async function deleteSkillPrisma(prisma: PrismaDb, skillId: string): Promise<void> {
    // Same delete order as the sqlite path so FK rows without CASCADE clear first.
    await prisma.skill_version_files.deleteMany({ where: { skill_id: skillId } });
    await prisma.skill_version_scans.deleteMany({ where: { skill_id: skillId } });
    await prisma.skill_versions.deleteMany({ where: { skill_id: skillId } });
    await prisma.skill_mirrors.deleteMany({ where: { skill_id: skillId } });
    await prisma.kit_skills.deleteMany({ where: { skill_id: skillId } });
    await prisma.publish_log.deleteMany({ where: { skill_id: skillId } });
    await prisma.skill_proposals.deleteMany({ where: { skill_id: skillId } });
    await prisma.skill_aliases.deleteMany({ where: { to_skill_id: skillId } });
    await prisma.skills.deleteMany({ where: { id: skillId } });
}
/** Prisma counterpart of {@link applyBundle}. */
async function applyBundlePrisma(prisma: PrismaClient, ctx: SyncContext, discovery: Discovery, skill: DiscoveredGitHubSkill, skillId: string, bundle: Map<string, Uint8Array> | null, result: SyncResult): Promise<void> {
    if (!bundle) {
        result.skipped++;
        return;
    }
    // Slug-collision guard: never flip an existing PRIVATE skill to public unless
    // it is already mirrored from THIS repo. A connected repo whose skill id
    // collides with the user's private (non-mirrored, or other-repo) skill must
    // not publish it.
    const collision = await getSkillMirrorCollisionPrisma(prisma, skillId);
    if (collision && collision.visibility === 'private' && collision.source_repo !== ctx.repoFull) {
        result.skipped++;
        return;
    }
    const versionHash = canonicalContentHash(bundle);
    const existingHash = await getSkillMirrorComputedHashPrisma(prisma, skillId);
    if (existingHash === versionHash) {
        result.unchanged++;
        return;
    }
    if (ctx.dryRun) {
        if (existingHash)
            result.updated++;
        else
            result.added++;
        return;
    }
    await writeSkillPrisma(prisma, ctx, discovery, skill, skillId, bundle, versionHash);
    if (existingHash)
        result.updated++;
    else
        result.added++;
}
/**
 * Sync every skill in a repo under ctx.authorHandle. Idempotent (hash-locked),
 * fail-soft per skill, and tombstones skills that vanished upstream. The caller
 * must have ensured the `authors` row exists.
 */
export async function syncRepoSkills(_db: DatabaseSync, _owner: string, _repo: string, _ctx: SyncContext): Promise<SyncResult> {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: syncRepoSkillsPrisma");
}
/**
 * Prisma async counterpart of {@link syncRepoSkills}. Same discover / apply /
 * tombstone / linked-kit flow against MySQL.
 */
export async function syncRepoSkillsPrisma(prisma: PrismaClient, owner: string, repo: string, ctx: SyncContext): Promise<SyncResult> {
    const discovery = await discover(owner, repo, ctx);
    let skills = discovery.skills;
    // Locked subset: sync only the chosen dirs (new upstream skills don't appear).
    if (ctx.selectedDirs) {
        const want = new Set(ctx.selectedDirs);
        skills = skills.filter((s) => want.has(s.dir));
    }
    if (ctx.excludeDirs?.length) {
        const drop = ctx.excludeDirs;
        skills = skills.filter((s) => !drop.some((d) => s.dir === d || s.dir.startsWith(`${d}/`)));
    }
    // Always bound the per-sync skill count, even when the caller passes no
    // explicit maxSkills, so a repo with thousands of skill dirs can't force
    // unbounded work.
    const skillCap = ctx.maxSkills ?? DEFAULT_MAX_SKILLS_PER_SYNC;
    if (skills.length > skillCap)
        skills = skills.slice(0, skillCap);
    const result: SyncResult = {
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        ref: discovery.ref,
        sha: discovery.sha,
        total: skills.length,
        skills: [],
        kitId: null,
        kitName: null,
    };
    const seen = new Set<string>();
    // Coupled repos (skills referencing `../`) import as ONE skill so the shared
    // paths resolve — matching the web importer (classifyImport). A locked subset
    // or a single skill stays the per-skill path. See repo-import-classification.md.
    const mode = ctx.selectedDirs || skills.length <= 1 || ctx.syncMode === 'per-skill'
        ? 'kit'
        : classifyImport(skills.map((s) => ({ dir: s.dir, coupled: s.coupled }))).mode;
    if (mode === 'unified') {
        const slug = slugify(discovery.repo);
        const skillId = toSkillId(`${ctx.authorHandle}/${slug}`);
        seen.add(skillId);
        result.total = 1;
        const unifiedSkill: DiscoveredGitHubSkill = {
            dir: '',
            slug,
            name: humanizeRepo(discovery.repo),
            description: `${skills.length} related skills from ${ctx.repoFull}, bundled because they share files.`,
            coupled: true,
            files: discovery.allFiles,
        };
        try {
            const bundle = await buildUnifiedBundle(discovery, ctx);
            await applyBundlePrisma(prisma, ctx, discovery, unifiedSkill, skillId, bundle, result);
        }
        catch (err) {
            // A skipped unified bundle means the WHOLE repo published nothing — say why.
            console.warn(`  ! skipped unified ${ctx.repoFull}: ${(err as Error).message}`);
            result.skipped++;
        }
    }
    else {
        for (const skill of skills) {
            // Forced per-skill mode can't ship a coupled skill — its `../` references
            // point outside the bundle and would dangle. Skip it, visibly.
            if (ctx.syncMode === 'per-skill' && skill.coupled) {
                console.warn(`  ! skipped ${ctx.authorHandle}/${skill.slug}: coupled (references ../) — not shippable per-skill`);
                result.skipped++;
                continue;
            }
            const skillId = toSkillId(`${ctx.authorHandle}/${skill.slug}`);
            seen.add(skillId);
            try {
                const bundle = await buildBundle(discovery.owner, discovery.repo, discovery.ref, skill, ctx);
                await applyBundlePrisma(prisma, ctx, discovery, skill, skillId, bundle, result);
            }
            catch (err) {
                console.warn(`  ! skipped ${skillId}: ${(err as Error).message}`);
                result.skipped++;
            }
        }
    }
    // Tombstone this repo's previously-synced skills that vanished upstream.
    // Per-skill isolation: one failed delete must not wedge the source, and a
    // skill carrying reports or moderation actions is kept (the moderation
    // trail outlives the mirror; those tables FK skills with NoAction anyway).
    if (!ctx.dryRun) {
        const rows = await listRepoMirroredSkillsPrisma(prisma, ctx.authorHandle, ctx.repoFull);
        for (const { id } of rows) {
            if (seen.has(id))
                continue;
            try {
                if (await skillHasModerationHistoryPrisma(prisma, id)) {
                    console.warn(`  ! kept ${id}: vanished upstream but carries reports/moderation history`);
                    result.tombstonesSkipped = (result.tombstonesSkipped ?? 0) + 1;
                    continue;
                }
                await runPrismaTransaction(prisma, (tx) => deleteSkillPrisma(tx, id));
            }
            catch (err) {
                console.warn(`  ! tombstone failed for ${id}: ${(err as Error).message}`);
                result.tombstonesFailed = (result.tombstonesFailed ?? 0) + 1;
            }
        }
        // >1 skill in this repo = a kit; reconcile + version it. (Mirrors get this too.)
        const repoSkills = await listRepoMirroredSkillsPrisma(prisma, ctx.authorHandle, ctx.repoFull);
        result.skills = repoSkills.map((r) => r.slug);
        result.kitId = await ensureLinkedKitPrisma(prisma, ctx, discovery, repoSkills.map((r) => r.id));
        if (result.kitId)
            result.kitName = ctx.kitName?.trim() || humanizeRepo(discovery.repo);
    }
    return result;
}
