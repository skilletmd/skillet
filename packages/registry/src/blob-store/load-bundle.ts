import type { DatabaseSync } from '../db/sqlite-handle.js';
import { canonicalContentHash, isSkilletBackupPath, type DecodedBundle } from '@skillet/protocol';
import type { BlobStore } from './types.js';
import { verifyBlobBytes } from './verify-bytes.js';
import type { PrismaDb } from '../db/prisma-client.js';
function normalizeVersionHash(hash: string): string {
    return hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
}
function versionHashVariants(versionHash: string): string[] {
    const bare = versionHash.startsWith('sha256:')
        ? versionHash.slice('sha256:'.length)
        : versionHash;
    const prefixed = `sha256:${bare}`;
    return bare === versionHash ? [versionHash, prefixed] : [versionHash, bare];
}
export interface VersionFileRow {
    path: string;
    blob_hash: string;
    size: number;
}
/** Manifest rows with byte sizes from the blobs table (no R2 fetch). */
export function listVersionFileRows(_db: DatabaseSync, _versionHash: string): VersionFileRow[] {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: listVersionFileRowsPrisma");
}
/** Load one file from a version by path. Null when missing or corrupt. */
export async function loadFileForVersion(_db: DatabaseSync, _blobStore: BlobStore, _versionHash: string, _filePath: string): Promise<{
    path: string;
    bytes: Uint8Array;
} | null> {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: loadFileForVersionPrisma");
}
/** Load blob bytes for a manifest. Null when any hash is missing. */
export async function loadBundleFromManifest(blobStore: BlobStore, manifest: Array<{
    path: string;
    blob_hash: string;
}>): Promise<DecodedBundle | null> {
    const bundle: DecodedBundle = new Map();
    for (const row of manifest) {
        const bytes = await blobStore.get(row.blob_hash);
        if (!bytes)
            return null;
        if (!verifyBlobBytes(row.blob_hash, bytes))
            return null;
        bundle.set(row.path, bytes);
    }
    return bundle;
}
/** Reconstruct a decoded bundle from `skill_version_files` + blob store. */
export async function loadBundleForVersion(_db: DatabaseSync, _blobStore: BlobStore, _versionHash: string): Promise<DecodedBundle | null> {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: loadBundleForVersionPrisma");
}
/** Prisma counterpart of {@link listVersionFileRows}. */
export async function listVersionFileRowsPrisma(prisma: PrismaDb, versionHash: string): Promise<VersionFileRow[]> {
    const hashes = versionHashVariants(versionHash);
    const rows = await prisma.skill_version_files.findMany({
        where: { version_hash: { in: hashes } },
        orderBy: { path: 'asc' },
        select: {
            path: true,
            blob_hash: true,
            blobs: { select: { size: true } },
        },
    });
    return rows.map((row) => ({
        path: row.path,
        blob_hash: row.blob_hash,
        size: row.blobs.size,
    }));
}
/** Prisma counterpart of {@link loadFileForVersion}. */
export async function loadFileForVersionPrisma(prisma: PrismaDb, blobStore: BlobStore, versionHash: string, filePath: string, skillId?: string): Promise<{
    path: string;
    bytes: Uint8Array;
} | null> {
    if (isSkilletBackupPath(filePath))
        return null;
    const hashes = versionHashVariants(versionHash);
    // Scope by skill_id when the caller knows it (#472): the ACL is checked on
    // skill_id, but filtering by version_hash alone would become a cross-skill
    // read the moment dedup writes differing blobs under one hash. Matches the
    // sibling /files/* route, which already scopes by skill_id.
    const row = await prisma.skill_version_files.findFirst({
        where: { version_hash: { in: hashes }, path: filePath, ...(skillId ? { skill_id: skillId } : {}) },
        select: { path: true, blob_hash: true },
    });
    if (!row)
        return null;
    const bytes = await blobStore.get(row.blob_hash);
    if (!bytes)
        return null;
    if (!verifyBlobBytes(row.blob_hash, bytes))
        return null;
    return { path: row.path, bytes };
}
/** Prisma counterpart of {@link loadBundleForVersion}. */
export async function loadBundleForVersionPrisma(prisma: PrismaDb, blobStore: BlobStore, versionHash: string): Promise<DecodedBundle | null> {
    const hashes = versionHashVariants(versionHash);
    const rows = await prisma.skill_version_files.findMany({
        where: { version_hash: { in: hashes } },
        orderBy: { path: 'asc' },
        select: { path: true, blob_hash: true },
    });
    const bundle = await loadBundleFromManifest(blobStore, rows);
    if (!bundle)
        return null;
    const expected = normalizeVersionHash(versionHash);
    if (canonicalContentHash(bundle) !== expected)
        return null;
    return bundle;
}
