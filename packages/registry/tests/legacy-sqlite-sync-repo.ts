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
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  canonicalContentHash,
  validateBundle,
  BundleError,
  MAX_BUNDLE_BYTES,
  isExcludedDiscoveryPath,
  isCoupledSkillMarkdown,
  classifyImport,
  dedupeMirrorsBy,
  slugify as canonicalSlugify,
} from '@skillet/protocol';
import { blobHash, newId } from '../src/db/index.js';
import type { PrismaDb } from '../src/db/prisma-client.js';
import { runPrismaTransaction } from '../src/db/prisma-client.js';
import { slugify as kitSlugify } from '../src/slug.js';
import { query, queryOne } from './legacy-sqlite-query.js';
import {
  classifyVersionBump,
  classifyVersionBumpPrisma,
  deriveVersionLabel,
  deriveVersionLabelPrisma,
} from '../src/version-label.js';
import { secretsBlockingScan, runScan } from '../src/scanner/scanner.js';
import { runScanAndPersist, lastCleanHash } from './legacy-sqlite-scan-runner.js';
import { publishKitVersion } from '../src/routes/kits.js';
import { publishKitVersionPrisma } from '../src/lib/kit-mutations.js';
import { findKitBySourceRepoPrisma } from '../src/lib/kit-payload.js';
import { attestVersionRowIfUnsignedPrisma } from '../src/lib/platform-signing.js';
import { attestVersionRowIfUnsigned } from './legacy-sqlite-platform-signing.js';
import { lastCleanHashPrisma } from '../src/lib/sync-manifest.js';
import { persistVersionScanPrisma } from '../src/lib/skill-publish.js';
import { toSkillId } from '@skillet/protocol/skill-id';

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
  /** GitHub token for higher rate limits / private repos (optional for public). */
  token?: string;
  /** Sync only these skill dirs (relative to repo root). Undefined = all skills. */
  selectedDirs?: string[];
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
}

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'skillet-sync',
    'x-github-api-version': '2022-11-28',
  };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function ghJson<T>(url: string, ctx: Pick<SyncContext, 'token' | 'fetchImpl'>): Promise<T> {
  const f = ctx.fetchImpl ?? globalThis.fetch;
  const res = await f(url, { headers: ghHeaders(ctx.token) });
  if (!res.ok) {
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('GitHub rate limit reached');
    }
    throw new Error(`GitHub ${url} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function fetchRaw(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  ctx: Pick<SyncContext, 'token' | 'fetchImpl'>,
): Promise<Uint8Array> {
  const f = ctx.fetchImpl ?? globalThis.fetch;
  const encPath = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const headers: Record<string, string> = { 'user-agent': 'skillet-sync' };
  if (ctx.token) headers.authorization = `Bearer ${ctx.token}`;
  const res = await f(`${GH_RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/${encPath}`, {
    headers,
  });
  if (!res.ok) throw new Error(`download ${path} failed (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Read `name`/`description` from a SKILL.md YAML frontmatter block. Handles
 *  plain scalars and block scalars (`>`/`>-`/`>+` fold to spaces, `|` variants
 *  keep newlines) — vendors like MongoDB and Stripe write `description: >-`,
 *  and a line-based parse would store the literal indicator as the value. */
export function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const lines = m[1]!.split(/\r?\n/);
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i]!.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    const rest = kv[2]!.trim();
    const scalar = rest.match(/^([>|])[+-]?$/);
    if (scalar) {
      // Block scalar: collect the following more-indented lines.
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || lines[i + 1]!.trim() === '')) {
        block.push(lines[++i]!.trim());
      }
      while (block.length > 0 && block[block.length - 1] === '') block.pop();
      out[key] = block.join(scalar[1] === '>' ? ' ' : '\n').trim();
    } else {
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
  if (!skillDir) return repoPath;
  const prefix = skillDir.endsWith('/') ? skillDir : skillDir + '/';
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
}

/** Find every SKILL.md, group sibling files under each, parse name/description. */
export async function discover(owner: string, repo: string, ctx: SyncContext): Promise<Discovery> {
  const meta = await ghJson<{ default_branch?: string }>(`${GH_API}/repos/${owner}/${repo}`, ctx);
  const ref = meta.default_branch ?? 'main';
  const branch = await ghJson<{ commit?: { sha?: string } }>(
    `${GH_API}/repos/${owner}/${repo}/branches/${encodeURIComponent(ref)}`,
    ctx,
  ).catch(() => ({ commit: undefined }));
  const sha = branch.commit?.sha ?? null;

  const tree = await ghJson<{ tree?: Array<{ path?: string; type?: string; size?: number }> }>(
    `${GH_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    ctx,
  );
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
  const usedSlugs = new Set<string>();
  const raw: Array<{ skill: DiscoveredGitHubSkill; body: string }> = [];

  for (const dir of skillDirs) {
    const prefix = dir ? dir + '/' : '';
    const files = blobs.filter(
      (b) => (dir === '' ? true : b.path.startsWith(prefix)) && !claimed.has(b.path),
    );
    if (!files.some((file) => file.path === `${prefix}SKILL.md`)) continue;
    for (const file of files) claimed.add(file.path);

    const skillMd = await fetchRaw(owner, repo, ref, `${prefix}SKILL.md`, ctx).catch(() => null);
    const text = skillMd ? Buffer.from(skillMd).toString('utf8') : '';
    const fm = text ? parseFrontmatter(text) : {};
    const base = dir ? dir.split('/').pop()! : repo;
    let slug = slugify(fm.name || base);
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${slugify(fm.name || base)}-${n++}`;
    usedSlugs.add(slug);

    raw.push({
      skill: {
        dir,
        slug,
        name: fm.name || base,
        description: fm.description || '',
        coupled: isCoupledSkillMarkdown(text),
        files,
      },
      body: text.trim(),
    });
  }

  // Drop mirror copies (e.g. plugins/<tool>/skills/x duplicating skills/x), the
  // same content-dedupe the web importer applies.
  const skills = dedupeMirrorsBy(
    raw,
    (r) => r.skill.dir,
    (r) => r.body || null,
  ).map((r) => r.skill);

  return { owner, repo, ref, sha, skills, allFiles: blobs };
}

async function buildBundle(
  owner: string,
  repo: string,
  ref: string,
  skill: DiscoveredGitHubSkill,
  ctx: SyncContext,
): Promise<Map<string, Uint8Array> | null> {
  const bundle = new Map<string, Uint8Array>();
  // Early-bail on the tree-reported size so we never fetch a blob that cannot
  // fit the bundle cap. There is no per-file cap (the protocol has none): a
  // single large reference belongs in the bundle as long as the total fits.
  let declaredTotal = 0;
  for (const file of skill.files) {
    declaredTotal += file.size;
    if (declaredTotal > MAX_BUNDLE_BYTES) return null;
    const bytes = await fetchRaw(owner, repo, ref, file.path, ctx);
    bundle.set(reroot(file.path, skill.dir), bytes);
  }
  if (!bundle.has('SKILL.md')) return null;
  // Enforce exactly what direct-publish enforces (total + instruction caps +
  // path safety) on the real bytes, so a mirror can never diverge from the
  // canonical validator. An over-cap or unsafe bundle is skipped, not truncated.
  try {
    validateBundle(bundle);
  } catch (err) {
    if (err instanceof BundleError) return null;
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
async function buildUnifiedBundle(
  discovery: Discovery,
  ctx: SyncContext,
): Promise<Map<string, Uint8Array> | null> {
  const bundle = new Map<string, Uint8Array>();
  let declaredTotal = 0;
  for (const file of discovery.allFiles) {
    declaredTotal += file.size;
    if (declaredTotal > MAX_BUNDLE_BYTES) return null;
    const bytes = await fetchRaw(discovery.owner, discovery.repo, discovery.ref, file.path, ctx);
    bundle.set(file.path, bytes);
  }
  if (!bundle.has('SKILL.md')) {
    bundle.set('SKILL.md', new Uint8Array(Buffer.from(synthesizeUnifiedIndex(discovery), 'utf8')));
  }
  try {
    validateBundle(bundle);
  } catch (err) {
    if (err instanceof BundleError) return null;
    throw err;
  }
  return bundle;
}

/** Upsert one skill version + provenance + scan, atomically. */
export async function writeSkill(
  db: DatabaseSync,
  ctx: SyncContext,
  discovery: { owner: string; repo: string; ref: string },
  skill: DiscoveredGitHubSkill,
  skillId: string,
  bundle: Map<string, Uint8Array>,
  versionHash: string,
): Promise<void> {
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

  const files: Array<{ path: string; hash: string }> = [];
  for (const [path, bytes] of bundle) files.push({ path, hash: blobHash(Buffer.from(bytes)) });

  // Semver bump against the skill's current latest_hash. Sync blobs live in the
  // `blobs` table (written below on every run), so the base SKILL.md read is a
  // local row lookup. The label itself is derived inside the transaction; the
  // ON CONFLICT DO NOTHING insert discards it for an unchanged version, so a
  // re-sync never consumes a label.
  const baseRow = queryOne<{ latest_hash: string | null }>(
    db,
    'SELECT latest_hash FROM skills WHERE id = ?',
    skillId,
  );
  const nextSkillMdBytes = bundle.get('SKILL.md');
  const bumpKind = await classifyVersionBump(db, {
    skillId,
    baseHash: baseRow?.latest_hash ?? null,
    nextFiles: new Map(files.map((f) => [f.path, f.hash])),
    nextSkillMd: nextSkillMdBytes ? Buffer.from(nextSkillMdBytes).toString('utf8') : null,
    readBlob: (hash) =>
      queryOne<{ bytes: Uint8Array | null }>(db, 'SELECT bytes FROM blobs WHERE hash = ?', hash)
        ?.bytes ?? null,
  });

  db.exec('BEGIN');
  try {
    for (const [, bytes] of bundle) {
      const buf = Buffer.from(bytes);
      db.prepare('INSERT INTO blobs (hash, bytes, size) VALUES (?, ?, ?) ON CONFLICT(hash) DO NOTHING').run(
        blobHash(buf),
        buf,
        buf.byteLength,
      );
    }

    db.prepare(
      `INSERT INTO skills (id, author_id, slug, description, latest_hash, visibility, install_count, created_at, source_repo, source_url)
       VALUES (?, ?, ?, ?, ?, 'public', 0, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         description = excluded.description,
         latest_hash = excluded.latest_hash,
         visibility = 'public',
         source_repo = excluded.source_repo,
         source_url = excluded.source_url`,
    ).run(
      skillId,
      ctx.authorHandle,
      skill.slug,
      skill.description,
      versionHash,
      now,
      ctx.repoFull,
      sourceUrl,
    );

    const { label } = deriveVersionLabel(db, skillId, bumpKind);
    db.prepare(
      `INSERT INTO skill_versions (hash, skill_id, metadata_json, published_at, published_by, major, minor, patch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(skill_id, hash) DO NOTHING`,
    ).run(versionHash, skillId, metadata, now, ctx.authorHandle, label.major, label.minor, label.patch);

    // Mirrored versions have no author to sign them — attest with the
    // platform key so device sync can verify (unsigned versions are rejected
    // client-side with `unsigned_version`).
    attestVersionRowIfUnsigned(db, {
      skillId,
      hash: versionHash,
      ref: `@${ctx.authorHandle}/${skill.slug}`,
    });

    for (const file of files) {
      db.prepare(
        'INSERT INTO skill_version_files (skill_id, version_hash, path, blob_hash) VALUES (?, ?, ?, ?) ON CONFLICT(skill_id, version_hash, path) DO NOTHING',
      ).run(skillId, versionHash, file.path, file.hash);
    }

    db.prepare(
      `INSERT INTO skill_mirrors (skill_id, source_repo, source_ref, source_path, source_url, license, computed_hash, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(skill_id) DO UPDATE SET
         source_repo = excluded.source_repo,
         source_ref = excluded.source_ref,
         source_path = excluded.source_path,
         source_url = excluded.source_url,
         license = excluded.license,
         computed_hash = excluded.computed_hash,
         synced_at = excluded.synced_at`,
    ).run(skillId, ctx.repoFull, discovery.ref, sourcePath, sourceUrl, ctx.license, versionHash, now);

    // Harm-scan in the same transaction: a scan failure rolls the skill back so
    // it's retried next run rather than left published-but-unscanned.
    const scanResult = runScanAndPersist(db, skillId, versionHash, bundle);

    // U7 — sync can't 422 (it's automated), so it HOLDS. A synced version
    // that scans as a secret or quarantined never becomes the installable
    // pointer: latest_hash falls back to the last clean version and blocked_hash
    // remembers what we held so the skill page can show a banner. A secret isn't
    // part of the async corpus, so we mark its row quarantined too — that makes
    // every serve filter (lastCleanHash, the install gate) exclude it uniformly.
    const secretHit = secretsBlockingScan(bundle);
    const blocked = Boolean(secretHit) || scanResult.status === 'quarantined';
    if (blocked) {
      if (secretHit && scanResult.status !== 'quarantined') {
        db.prepare(
          `UPDATE skill_version_scans SET status = 'quarantined' WHERE skill_id = ? AND skill_version_id = ?`,
        ).run(skillId, versionHash);
      }
      db.prepare('UPDATE skills SET latest_hash = ? WHERE id = ?').run(
        lastCleanHash(db, skillId),
        skillId,
      );
      db.prepare('UPDATE skill_mirrors SET blocked_hash = ? WHERE skill_id = ?').run(
        versionHash,
        skillId,
      );
    } else {
      // Clean/flagged advances normally (latest_hash was set above); clear any
      // prior block now that a good version is live again.
      db.prepare('UPDATE skill_mirrors SET blocked_hash = NULL WHERE skill_id = ?').run(skillId);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Prisma async counterpart of {@link writeSkill}. Writes blob metadata+bytes
 * inline (same as the sqlite path) so bump classification can re-read the base
 * SKILL.md without a BlobStore; R2 wiring can wrap this later.
 */
export async function writeSkillPrisma(
  prisma: PrismaClient,
  ctx: SyncContext,
  discovery: { owner: string; repo: string; ref: string },
  skill: DiscoveredGitHubSkill,
  skillId: string,
  bundle: Map<string, Uint8Array>,
  versionHash: string,
): Promise<void> {
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

  const files: Array<{ path: string; hash: string; bytes: Uint8Array }> = [];
  for (const [path, bytes] of bundle) {
    const copy = Uint8Array.from(bytes);
    files.push({ path, hash: blobHash(copy), bytes: copy });
  }

  const baseRow = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { latest_hash: true },
  });
  const nextSkillMdBytes = bundle.get('SKILL.md');
  const bumpKind = await classifyVersionBumpPrisma(prisma, {
    skillId,
    baseHash: baseRow?.latest_hash ?? null,
    nextFiles: new Map(files.map((f) => [f.path, f.hash])),
    nextSkillMd: nextSkillMdBytes ? Buffer.from(nextSkillMdBytes).toString('utf8') : null,
    readBlob: async (hash) => {
      const row = await prisma.blobs.findUnique({
        where: { hash },
        select: { bytes: true },
      });
      return row?.bytes ?? null;
    },
  });

  await runPrismaTransaction(prisma, async (tx) => {
    await tx.blobs.createMany({
      data: files.map((f) => ({
        hash: f.hash,
        bytes: Buffer.from(f.bytes),
        size: f.bytes.byteLength,
        storage_loc: 'inline',
      })) as Prisma.blobsCreateManyInput[],
      skipDuplicates: true,
    });

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

    // Harm-scan in the same transaction: a scan failure rolls the skill back so
    // it's retried next run rather than left published-but-unscanned.
    const scanResult = runScan(bundle);
    await persistVersionScanPrisma(
      tx,
      skillId,
      versionHash,
      scanResult.status,
      JSON.stringify({ findings: scanResult.findings, summary: scanResult.summary }),
      null,
    );

    // U7 — sync can't 422 (it's automated), so it HOLDS. A synced version
    // that scans as a secret or quarantined never becomes the installable
    // pointer: latest_hash falls back to the last clean version and blocked_hash
    // remembers what we held so the skill page can show a banner.
    const secretHit = secretsBlockingScan(bundle);
    const blocked = Boolean(secretHit) || scanResult.status === 'quarantined';
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
    } else {
      await tx.skill_mirrors.update({
        where: { skill_id: skillId },
        data: { blocked_hash: null },
      });
    }
  });
}

function humanizeRepo(repo: string): string {
  return repo
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Per-owner unique kit slug: the canonical slugified name, suffixed -2, -3…
 *  past an existing kit with the same slug (aliases too, so a rename's old
 *  permalink is never reassigned to a synced kit). */
function uniqueKitSlug(db: DatabaseSync, owner: string, name: string): string {
  const base = kitSlugify(name);
  const taken = db.prepare(
    `SELECT 1 FROM kits WHERE owner_id = ? AND slug = ?
     UNION ALL
     SELECT 1 FROM kit_slug_aliases WHERE owner_id = ? AND slug = ?`,
  );
  let slug = base;
  let n = 2;
  while (taken.get(owner, slug, owner, slug)) slug = `${base}-${n++}`;
  return slug;
}

/** Prisma async counterpart of {@link uniqueKitSlug}. */
export async function uniqueKitSlugPrisma(
  prisma: PrismaDb,
  owner: string,
  name: string,
): Promise<string> {
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
      if (!aliasHit) return slug;
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
export function ensureLinkedKit(
  db: DatabaseSync,
  ctx: SyncContext,
  discovery: { repo: string; ref: string; sha: string | null },
  skillIds: string[],
): string | null {
  // <=1 skill is never a kit; bundle === false opts a multi-skill repo out too.
  if (skillIds.length <= 1 || ctx.bundle === false) return null;

  const existing = queryOne<{ id: string }>(
    db,
    "SELECT id FROM kits WHERE owner_id = ? AND source_repo = ? AND source_type = 'linked'",
    ctx.authorHandle,
    ctx.repoFull,
  );

  const name = ctx.kitName?.trim() || humanizeRepo(discovery.repo);
  let kitId: string;
  if (existing) {
    kitId = existing.id;
    // Re-sync owns the skill set and the source pointer, but NOT the name — the
    // owner can rename a linked kit in Skillet and the pull must preserve it.
    db.prepare('UPDATE kits SET source_ref = ?, last_synced_sha = ? WHERE id = ?').run(
      discovery.ref,
      discovery.sha,
      kitId,
    );
  } else {
    kitId = newId();
    // Slug is the public permalink (/{owner}/kit/{slug}). Unlike the create
    // route, sync can't 409 on a name collision, so dedupe with a -2 suffix.
    const slug = uniqueKitSlug(db, ctx.authorHandle, name);
    db.prepare(
      `INSERT INTO kits (id, owner_id, name, slug, description, visibility, source_type, source_repo, source_ref, source_path, last_synced_sha)
       VALUES (?, ?, ?, ?, NULL, 'public', 'linked', ?, ?, NULL, ?)`,
    ).run(kitId, ctx.authorHandle, name, slug, ctx.repoFull, discovery.ref, discovery.sha);
  }

  // Reconcile membership to exactly skillIds (unpinned → tracks latest).
  const have = new Set(
    query<{ skill_id: string }>(
      db,
      'SELECT skill_id FROM kit_skills WHERE kit_id = ?',
      kitId,
    ).map((r) => r.skill_id),
  );
  const want = new Set(skillIds);
  for (const id of have) {
    if (!want.has(id)) db.prepare('DELETE FROM kit_skills WHERE kit_id = ? AND skill_id = ?').run(kitId, id);
  }
  for (const id of want) {
    if (!have.has(id)) {
      db.prepare(
        'INSERT INTO kit_skills (kit_id, skill_id, pinned_hash) VALUES (?, ?, NULL) ON CONFLICT(kit_id, skill_id) DO NOTHING',
      ).run(kitId, id);
    }
  }

  // No-op if the snapshot is unchanged; else major/minor bump.
  publishKitVersion(db, kitId, `Synced from ${ctx.repoFull}`, ctx.authorHandle);
  return kitId;
}

/** Prisma async counterpart of {@link ensureLinkedKit}. */
export async function ensureLinkedKitPrisma(
  prisma: PrismaClient,
  ctx: SyncContext,
  discovery: { repo: string; ref: string; sha: string | null },
  skillIds: string[],
): Promise<string | null> {
  // <=1 skill is never a kit; bundle === false opts a multi-skill repo out too.
  if (skillIds.length <= 1 || ctx.bundle === false) return null;

  const existingId = await findKitBySourceRepoPrisma(
    prisma,
    ctx.authorHandle,
    ctx.repoFull,
    'linked',
  );

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
  } else {
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
  await publishKitVersionPrisma(
    prisma,
    kitId,
    `Synced from ${ctx.repoFull}`,
    ctx.authorHandle,
  );
  return kitId;
}

/** Delete a synced skill and its versions/files/scans/lock. */
export function deleteSkill(db: DatabaseSync, skillId: string): void {
  db.exec('BEGIN');
  try {
    // Children carry skill_id now, so delete directly — a hash-only match would
    // wrongly remove another skill's rows when two skills share a content hash.
    db.prepare('DELETE FROM skill_version_files WHERE skill_id = ?').run(skillId);
    db.prepare('DELETE FROM skill_version_scans WHERE skill_id = ?').run(skillId);
    db.prepare('DELETE FROM skill_versions WHERE skill_id = ?').run(skillId);
    db.prepare('DELETE FROM skill_mirrors WHERE skill_id = ?').run(skillId);
    // Clear the remaining tables that reference skills(id) without ON DELETE
    // CASCADE; otherwise the DELETE FROM skills below throws an FK violation and
    // halts tombstone reconciliation (e.g. a synced skill that's part of a kit).
    db.prepare('DELETE FROM kit_skills WHERE skill_id = ?').run(skillId);
    db.prepare('DELETE FROM publish_log WHERE skill_id = ?').run(skillId);
    db.prepare('DELETE FROM skill_proposals WHERE skill_id = ?').run(skillId);
    db.prepare('DELETE FROM skill_aliases WHERE to_skill_id = ?').run(skillId);
    db.prepare('DELETE FROM skills WHERE id = ?').run(skillId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
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
export async function getSkillMirrorCollisionPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<SkillMirrorCollision | null> {
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { visibility: true },
  });
  if (!skill) return null;
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
export async function getSkillMirrorComputedHashPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<string | null> {
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
export async function listRepoMirroredSkillsPrisma(
  prisma: PrismaDb,
  authorHandle: string,
  repoFull: string,
): Promise<RepoMirroredSkill[]> {
  const mirrors = await prisma.skill_mirrors.findMany({
    where: { source_repo: repoFull },
    select: { skill_id: true },
  });
  if (mirrors.length === 0) return [];
  return prisma.skills.findMany({
    where: {
      author_id: authorHandle,
      id: { in: mirrors.map((m) => m.skill_id) },
    },
    select: { id: true, slug: true },
  });
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

/**
 * Apply one built bundle to the DB, updating the result tally: skip on a null
 * bundle (over-cap / invalid) or a blocking secret, no-op when the content hash
 * is unchanged, else write. Shared by the per-skill and unified sync paths so
 * both honor the same idempotency, scan gate, and dry-run rules.
 */
async function applyBundle(
  db: DatabaseSync,
  ctx: SyncContext,
  discovery: Discovery,
  skill: DiscoveredGitHubSkill,
  skillId: string,
  bundle: Map<string, Uint8Array> | null,
  result: SyncResult,
): Promise<void> {
  if (!bundle) {
    result.skipped++;
    return;
  }
  // Slug-collision guard: never flip an existing PRIVATE skill to public unless
  // it is already mirrored from THIS repo. A connected repo whose skill id
  // collides with the user's private (non-mirrored, or other-repo) skill must
  // not publish it.
  const collision = queryOne<{ visibility: string; source_repo: string | null }>(
    db,
    `SELECT s.visibility, m.source_repo
       FROM skills s LEFT JOIN skill_mirrors m ON m.skill_id = s.id
       WHERE s.id = ?`,
    skillId,
  );
  if (collision && collision.visibility === 'private' && collision.source_repo !== ctx.repoFull) {
    result.skipped++;
    return;
  }
  const versionHash = canonicalContentHash(bundle);
  const existing = queryOne<{ computed_hash: string }>(
    db,
    'SELECT computed_hash FROM skill_mirrors WHERE skill_id = ?',
    skillId,
  );
  if (existing?.computed_hash === versionHash) {
    result.unchanged++;
    return;
  }
  if (ctx.dryRun) {
    if (existing) result.updated++;
    else result.added++;
    return;
  }
  await writeSkill(db, ctx, discovery, skill, skillId, bundle, versionHash);
  if (existing) result.updated++;
  else result.added++;
}

/** Prisma counterpart of {@link applyBundle}. */
async function applyBundlePrisma(
  prisma: PrismaClient,
  ctx: SyncContext,
  discovery: Discovery,
  skill: DiscoveredGitHubSkill,
  skillId: string,
  bundle: Map<string, Uint8Array> | null,
  result: SyncResult,
): Promise<void> {
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
    if (existingHash) result.updated++;
    else result.added++;
    return;
  }
  await writeSkillPrisma(prisma, ctx, discovery, skill, skillId, bundle, versionHash);
  if (existingHash) result.updated++;
  else result.added++;
}

/**
 * Sync every skill in a repo under ctx.authorHandle. Idempotent (hash-locked),
 * fail-soft per skill, and tombstones skills that vanished upstream. The caller
 * must have ensured the `authors` row exists.
 */
export async function syncRepoSkills(
  db: DatabaseSync,
  owner: string,
  repo: string,
  ctx: SyncContext,
): Promise<SyncResult> {
  const discovery = await discover(owner, repo, ctx);
  let skills = discovery.skills;
  // Locked subset: sync only the chosen dirs (new upstream skills don't appear).
  if (ctx.selectedDirs) {
    const want = new Set(ctx.selectedDirs);
    skills = skills.filter((s) => want.has(s.dir));
  }
  // Always bound the per-sync skill count, even when the caller passes no
  // explicit maxSkills, so a repo with thousands of skill dirs can't force
  // unbounded work.
  const skillCap = ctx.maxSkills ?? DEFAULT_MAX_SKILLS_PER_SYNC;
  if (skills.length > skillCap) skills = skills.slice(0, skillCap);

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
  const mode =
    ctx.selectedDirs || skills.length <= 1 || ctx.syncMode === 'per-skill'
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
      await applyBundle(db, ctx, discovery, unifiedSkill, skillId, bundle, result);
    } catch (err) {
      // A skipped unified bundle means the WHOLE repo published nothing — say why.
      console.warn(`  ! skipped unified ${ctx.repoFull}: ${(err as Error).message}`);
      result.skipped++;
    }
  } else {
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
        await applyBundle(db, ctx, discovery, skill, skillId, bundle, result);
      } catch (err) {
        console.warn(`  ! skipped ${skillId}: ${(err as Error).message}`);
        result.skipped++;
      }
    }
  }

  // Tombstone this repo's previously-synced skills that vanished upstream.
  if (!ctx.dryRun) {
    const rows = query<{ id: string }>(
      db,
      `SELECT s.id FROM skills s JOIN skill_mirrors m ON m.skill_id = s.id
         WHERE s.author_id = ? AND m.source_repo = ?`,
      ctx.authorHandle,
      ctx.repoFull,
    );
    for (const { id } of rows) {
      if (!seen.has(id)) deleteSkill(db, id);
    }

    // >1 skill in this repo = a kit; reconcile + version it. (Mirrors get this too.)
    const repoSkills = query<{ id: string; slug: string }>(
      db,
      `SELECT s.id, s.slug FROM skills s JOIN skill_mirrors m ON m.skill_id = s.id
         WHERE s.author_id = ? AND m.source_repo = ?`,
      ctx.authorHandle,
      ctx.repoFull,
    );
    result.skills = repoSkills.map((r) => r.slug);
    result.kitId = ensureLinkedKit(db, ctx, discovery, repoSkills.map((r) => r.id));
    if (result.kitId) result.kitName = ctx.kitName?.trim() || humanizeRepo(discovery.repo);
  }

  return result;
}

/**
 * Prisma async counterpart of {@link syncRepoSkills}. Same discover / apply /
 * tombstone / linked-kit flow against MySQL.
 */
export async function syncRepoSkillsPrisma(
  prisma: PrismaClient,
  owner: string,
  repo: string,
  ctx: SyncContext,
): Promise<SyncResult> {
  const discovery = await discover(owner, repo, ctx);
  let skills = discovery.skills;
  // Locked subset: sync only the chosen dirs (new upstream skills don't appear).
  if (ctx.selectedDirs) {
    const want = new Set(ctx.selectedDirs);
    skills = skills.filter((s) => want.has(s.dir));
  }
  // Always bound the per-sync skill count, even when the caller passes no
  // explicit maxSkills, so a repo with thousands of skill dirs can't force
  // unbounded work.
  const skillCap = ctx.maxSkills ?? DEFAULT_MAX_SKILLS_PER_SYNC;
  if (skills.length > skillCap) skills = skills.slice(0, skillCap);

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
  const mode =
    ctx.selectedDirs || skills.length <= 1 || ctx.syncMode === 'per-skill'
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
    } catch (err) {
      // A skipped unified bundle means the WHOLE repo published nothing — say why.
      console.warn(`  ! skipped unified ${ctx.repoFull}: ${(err as Error).message}`);
      result.skipped++;
    }
  } else {
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
      } catch (err) {
        console.warn(`  ! skipped ${skillId}: ${(err as Error).message}`);
        result.skipped++;
      }
    }
  }

  // Tombstone this repo's previously-synced skills that vanished upstream.
  if (!ctx.dryRun) {
    const rows = await listRepoMirroredSkillsPrisma(prisma, ctx.authorHandle, ctx.repoFull);
    for (const { id } of rows) {
      if (!seen.has(id)) await deleteSkillPrisma(prisma, id);
    }

    // >1 skill in this repo = a kit; reconcile + version it. (Mirrors get this too.)
    const repoSkills = await listRepoMirroredSkillsPrisma(prisma, ctx.authorHandle, ctx.repoFull);
    result.skills = repoSkills.map((r) => r.slug);
    result.kitId = await ensureLinkedKitPrisma(
      prisma,
      ctx,
      discovery,
      repoSkills.map((r) => r.id),
    );
    if (result.kitId) result.kitName = ctx.kitName?.trim() || humanizeRepo(discovery.repo);
  }

  return result;
}
