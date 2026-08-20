/**
 * Repair skill file blobs whose bytes went missing from the dev blob store — the
 * `memory`-mode wipe on a registry restart (bytes lived only in the in-process
 * Map; metadata rows in Prisma survived). Re-import can't fix these because the
 * publish path dedups by content hash and skips putFileBlobs for an existing
 * version. This refetches each missing file from its source repo, VERIFIES the
 * sha256 matches the stored blob_hash (so it can never write wrong bytes), and
 * puts it back — durably, now that MemoryBlobStore persists bytes inline.
 *
 * Scoped to one source repo (the compound-engineering import):
 *   cd packages/registry
 *   npx tsx scripts/repair-missing-blobs.ts everyinc/compound-engineering-plugin main
 *
 * Slug→dir convention for that repo is `skills/<slug>/<path>`. Files whose hash
 * doesn't match (dir≠slug, or content drifted) are logged and skipped, never
 * guessed.
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { createBlobStore } from '../src/blob-store/index.js';
import { unavailableSqliteHandle } from '../src/db/sqlite-handle.js';
import { blobHash } from '../src/db/index.js';

const bare = (h: string) => h.replace(/^sha256:/, '');

async function main(): Promise<void> {
  const repo = process.argv[2] ?? 'everyinc/compound-engineering-plugin';
  const ref = process.argv[3] ?? 'main';
  const prisma = createPrismaClient();
  const blobStore = createBlobStore(unavailableSqliteHandle(), prisma);
  try {
    const rows = await prisma.skill_version_files.findMany({
      select: { skill_id: true, path: true, blob_hash: true },
    });
    let missing = 0, fixed = 0, skipped = 0;
    for (const r of rows) {
      const have = await blobStore.get(r.blob_hash).catch(() => null);
      if (have) continue;
      missing++;
      const slug = r.skill_id.split(':').pop()!;
      const url = `https://raw.githubusercontent.com/${repo}/${ref}/skills/${slug}/${r.path}`;
      const res = await fetch(url).catch(() => null);
      if (!res || !res.ok) {
        skipped++;
        console.log(`  SKIP ${slug}/${r.path} — source ${res ? res.status : 'unreachable'}`);
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bare(blobHash(bytes)) !== bare(r.blob_hash)) {
        skipped++;
        console.log(`  SKIP ${slug}/${r.path} — hash mismatch (source drifted)`);
        continue;
      }
      await blobStore.put(r.blob_hash, bytes);
      fixed++;
      console.log(`  fixed ${slug}/${r.path} (${bytes.byteLength}b)`);
    }
    console.log(`\n${missing} missing → ${fixed} repaired, ${skipped} skipped.`);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
