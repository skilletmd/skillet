// Production corpus snapshot export/load.
//
// Exports public published skill versions from the registry SQLite DB as a
// read-only JSON manifest + base64 file bytes. The scan corpus harness
// loads this snapshot to measure false positives on real published bundles.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { DecodedBundle } from '@skillet/protocol'
import { createBlobStore } from '../blob-store/create-blob-store.js'
import { loadBundleFromManifest } from '../blob-store/load-bundle.js'
import type { BlobStore } from '../blob-store/types.js'
import type { BenignCorpusEntry } from './corpus-report.js'

type BindValue = null | number | bigint | string | Uint8Array

function sqliteRows<T>(db: DatabaseSync, sql: string, ...params: BindValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

async function loadBundleForVersionSqlite(
  db: DatabaseSync,
  blobStore: BlobStore,
  versionHash: string,
): Promise<DecodedBundle | null> {
  const bare = versionHash.startsWith('sha256:')
    ? versionHash.slice('sha256:'.length)
    : versionHash
  const prefixed = `sha256:${bare}`
  const hashes = bare === versionHash ? [versionHash, prefixed] : [versionHash, bare]
  const placeholders = hashes.map(() => '?').join(',')
  const rows = sqliteRows<{ path: string; blob_hash: string }>(
    db,
    `SELECT path, blob_hash FROM skill_version_files
       WHERE version_hash IN (${placeholders})
       ORDER BY path`,
    ...hashes,
  )
  if (rows.length === 0) return null
  return loadBundleFromManifest(blobStore, rows)
}

export interface ProdSnapshotFile {
  path: string;
  /** base64-encoded file bytes */
  b64: string;
}

export interface ProdSnapshotEntry {
  /** Canonical ref, e.g. `@skillet/review-a-diff` */
  ref: string;
  author_id: string;
  slug: string;
  version_hash: string;
  published_at: number;
  files: ProdSnapshotFile[];
}

export interface ProdSnapshot {
  generated_at: string;
  registry_db: string;
  /** Public published versions only; private skills excluded. */
  entries: ProdSnapshotEntry[];
}

interface PublicVersionRow {
  author_id: string;
  slug: string;
  version_hash: string;
  published_at: number;
}

/** List every public published version with reconstructable bundle bytes. */
export async function exportProdSnapshot(
  db: DatabaseSync,
  registryDbPath: string,
  blobStore?: BlobStore,
): Promise<ProdSnapshot> {
  const store = blobStore ?? createBlobStore(db);
  const rows = sqliteRows<PublicVersionRow>(
    db,
    `SELECT s.author_id, s.slug, sv.hash AS version_hash, sv.published_at
         FROM skills s
         JOIN skill_versions sv ON sv.skill_id = s.id
        WHERE s.visibility = 'public'
        ORDER BY s.author_id, s.slug, sv.published_at`,
  );

  const entries: ProdSnapshotEntry[] = [];
  for (const row of rows) {
    const bundle = await loadBundleForVersionSqlite(db, store, row.version_hash);
    if (!bundle || bundle.size === 0) continue;

    const files: ProdSnapshotFile[] = [];
    for (const [path, bytes] of bundle) {
      files.push({ path, b64: Buffer.from(bytes).toString('base64') });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    entries.push({
      ref: `@${row.author_id}/${row.slug}`,
      author_id: row.author_id,
      slug: row.slug,
      version_hash: row.version_hash,
      published_at: row.published_at,
      files,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    registry_db: registryDbPath,
    entries,
  };
}

export function prodSnapshotToBenignEntries(snapshot: ProdSnapshot): BenignCorpusEntry[] {
  return snapshot.entries.map((entry) => {
    const bundle: DecodedBundle = new Map();
    for (const file of entry.files) {
      bundle.set(file.path, Buffer.from(file.b64, 'base64'));
    }
    return {
      id: `${entry.ref}@${entry.version_hash.slice(0, 12)}`,
      bundle,
    };
  });
}

export async function writeProdSnapshot(path: string, snapshot: ProdSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

export async function readProdSnapshot(path: string): Promise<ProdSnapshot> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as ProdSnapshot;
}

export async function loadProdSnapshotBenign(path: string): Promise<BenignCorpusEntry[]> {
  const snapshot = await readProdSnapshot(path);
  return prodSnapshotToBenignEntries(snapshot);
}

/** Export from a registry DB file path and write JSON snapshot. */
export async function exportProdSnapshotFile(
  _dbPath: string,
  _outPath: string,
): Promise<ProdSnapshot> {
  const { throwSqliteCliRetired } = await import('../db/cli-store-retired.js')
  return throwSqliteCliRetired('scanner prod-snapshot export')
}
