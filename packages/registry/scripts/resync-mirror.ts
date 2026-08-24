/**
 * Re-sync named mirrors from their GitHub source, now, without running the rest
 * of the nightly.
 *
 * The gap this fills: after a discovery or classification rule changes, the
 * catalog keeps serving whatever the last sync produced until that source is
 * walked again. Nightly does eventually walk everything, but its phases are
 * all-or-nothing and phase 3 is DISCOVERY — running the whole job to re-walk one
 * repo also sweeps GitHub and enqueues new review candidates, which is a
 * side effect nobody asked for when the goal was "apply the new rule to @nvidia".
 *
 * `sync-mirror-skills.ts` resolves handles from mirror-sources.json only, so it
 * cannot reach a mirror that arrived through the review queue — and those are
 * exactly the ones that go stale unnoticed. This resolves a handle from EITHER
 * origin: the seed file first, then live `mirror_review_queue` rows, matching
 * how nightly phases 1 and 2 divide the same catalog.
 *
 * Removal is the point as often as addition. A skill that no longer appears in
 * discovery is absent from the sync's `seen` set and tombstones — which is how a
 * newly excluded path (a fixture directory, say) actually leaves the catalog.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/resync-mirror.ts nvidia dotnet
 *   npx tsx --env-file-if-exists=.env scripts/resync-mirror.ts nvidia --apply
 *   npx tsx --env-file-if-exists=.env scripts/resync-mirror.ts --stale
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { createPrismaBlobStore } from '../src/blob-store/create-blob-store.js';
import { loadSources } from '../src/mirror-ops/sync-sources.js';
import { upsertMirrorAuthorPrisma } from '../src/lib/mirror-authors.js';
import { loadDenylist } from '../src/mirror-ops/denylist.js';
import { syncRepoSkillsPrisma } from '../src/sync/sync-repo.js';
import { normalizeRepoKey } from '../src/lib/mirror-screen.js';

/** Paths a skill must never be discovered under; mirrors EXCLUDED_DISCOVERY_SEGMENTS. */
const EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  'test',
  'tests',
  '__tests__',
  'fixture',
  'fixtures',
  '__fixtures__',
  'e2e',
]);

interface Target {
  handle: string;
  repo: string;
  license: string | null;
  origin: 'seed' | 'queue';
  /** Seed metadata, present only for seed targets — enough to CREATE the author
   *  row. A queue mirror's author already exists (approval created it) and its
   *  profile fields are not in any file, so there is nothing to upsert from. */
  profile?: { displayName: string; bio: string | null; logo: string; sourceUrl: string };
  maxSkills?: number;
  syncMode?: 'auto' | 'per-skill';
  excludeDirs?: string[];
}

/** Resolve a handle from the seed file first, then live queue rows. */
async function resolveTargets(
  prisma: ReturnType<typeof createPrismaClient>,
  handles: string[],
): Promise<Target[]> {
  const seeds = loadSources();
  const denylist = await loadDenylist();
  const out: Target[] = [];
  const wanted = new Set(handles);

  for (const s of seeds) {
    if (!wanted.has(s.handle)) continue;
    const key = normalizeRepoKey(s.repo);
    if (key && denylist.has(key)) {
      console.log(`  ! @${s.handle}: denylisted, refusing`);
      wanted.delete(s.handle);
      continue;
    }
    out.push({
      handle: s.handle,
      repo: s.repo,
      license: s.license,
      origin: 'seed',
      profile: { displayName: s.displayName, bio: s.bio ?? null, logo: s.logo, sourceUrl: s.sourceUrl },
      ...(s.maxSkills != null ? { maxSkills: s.maxSkills } : {}),
      ...(s.syncMode ? { syncMode: s.syncMode } : {}),
      ...(s.excludeDirs?.length ? { excludeDirs: s.excludeDirs } : {}),
    });
    wanted.delete(s.handle);
  }

  if (wanted.size > 0) {
    const rows = await prisma.mirror_review_queue.findMany({
      where: { status: 'live', derived_handle: { in: [...wanted] } },
      select: { source_repo: true, derived_handle: true, license: true },
      orderBy: { created_at: 'asc' },
    });
    for (const row of rows) {
      if (!row.derived_handle || !wanted.has(row.derived_handle)) continue;
      const key = normalizeRepoKey(row.source_repo);
      if (key && denylist.has(key)) {
        console.log(`  ! @${row.derived_handle}: denylisted, refusing`);
        wanted.delete(row.derived_handle);
        continue;
      }
      out.push({
        handle: row.derived_handle,
        repo: row.source_repo,
        license: row.license,
        origin: 'queue',
      });
      wanted.delete(row.derived_handle);
    }
  }

  for (const h of wanted) console.log(`  ! @${h}: not a seeded source and not a live queue mirror`);
  return out;
}

/** Handles whose live skills sit under a path discovery now excludes. */
async function staleHandles(prisma: ReturnType<typeof createPrismaClient>): Promise<string[]> {
  const rows = await prisma.skills.findMany({
    where: { visibility: 'public' },
    select: { author_id: true, source_url: true },
  });
  const hits = new Map<string, number>();
  for (const r of rows) {
    const parts = String(r.source_url ?? '')
      .replace(/^https?:\/\/github\.com\//, '')
      .split('/');
    if (parts.some((p) => EXCLUDED_SEGMENTS.has(p.toLowerCase())))
      hits.set(r.author_id, (hits.get(r.author_id) ?? 0) + 1);
  }
  for (const [h, n] of [...hits].sort((a, b) => b[1] - a[1]))
    console.log(`  @${h}: ${n} skill(s) under an excluded path`);
  return [...hits.keys()];
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const stale = process.argv.includes('--stale');
  let handles = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  const prisma = createPrismaClient();
  try {
    if (stale) {
      console.log('Handles serving skills under a now-excluded path:\n');
      const found = await staleHandles(prisma);
      if (found.length === 0) {
        console.log('  none');
        return;
      }
      handles = [...new Set([...handles, ...found])];
      console.log('');
    }
    if (handles.length === 0) {
      console.error('usage: resync-mirror.ts <handle> [<handle>...] [--apply]');
      console.error('       resync-mirror.ts --stale [--apply]');
      process.exitCode = 1;
      return;
    }

    const targets = await resolveTargets(prisma, handles);
    if (targets.length === 0) return;

    const token = process.env.SKILLET_MIRROR_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
    if (!token) console.log('  (no GitHub token in env — unauthenticated rate limits apply)\n');
    const blobStore = createPrismaBlobStore(prisma);

    for (const t of targets) {
      const [owner, repo] = t.repo.split('/');
      if (!owner || !repo) {
        console.log(`  ! @${t.handle}: invalid repo ${t.repo}`);
        continue;
      }
      console.log(`\n@${t.handle}  <-  ${t.repo} (${t.origin}, ${t.license ?? 'no license recorded'})`);
      const before = await prisma.skills.count({ where: { author_id: t.handle } });
      try {
        // A seeded source added to the file but never synced has no author row,
        // and every skill upsert then fails the author_id foreign key one at a
        // time — 'skipped: Foreign key constraint violated' per skill, and a
        // 0 -> 0 summary that looks like "nothing to do". Create it first, the
        // same way the seed sync does.
        if (apply && t.profile) {
          await upsertMirrorAuthorPrisma(prisma, t.handle, owner, t.repo, null, {
            displayName: t.profile.displayName,
            bio: t.profile.bio,
            avatarUrl: t.profile.logo,
            profileUrl: t.profile.sourceUrl,
            sourceUrl: t.profile.sourceUrl,
          });
        }
        const r = await syncRepoSkillsPrisma(prisma, owner, repo, {
          authorHandle: t.handle,
          repoFull: t.repo,
          license: t.license,
          blobStore,
          ...(token ? { token } : {}),
          ...(t.maxSkills != null ? { maxSkills: t.maxSkills } : {}),
          ...(t.syncMode ? { syncMode: t.syncMode } : {}),
          ...(t.excludeDirs?.length ? { excludeDirs: t.excludeDirs } : {}),
          dryRun: !apply,
        });
        console.log(`  +${r.added} ~${r.updated} =${r.unchanged} skip:${r.skipped} (${r.total} discovered)`);
        // The count delta is the number that actually matters when the point of
        // the re-sync is REMOVAL: `added/updated` stay at zero while skills leave.
        const after = apply ? await prisma.skills.count({ where: { author_id: t.handle } }) : before;
        console.log(`  skills: ${before} -> ${apply ? after : `${r.total} (dry run, nothing written)`}`);
      } catch (err) {
        console.error(`  ! @${t.handle} failed: ${(err as Error).message}`);
      }
    }
    if (!apply) console.log('\nDry run. Re-run with --apply.');
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
