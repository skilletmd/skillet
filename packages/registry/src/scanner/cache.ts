// Content-hash scan-result cache.
//
// Scanning is pure over a bundle's (path, bytes). Two bundles that carry
// byte-identical files at identical paths therefore produce identical scan
// results — there is no reason to run the detector fleet twice. At registry
// scale (forks, copies, re-publishes of unchanged content, the propose→publish
// round-trip, and Phase-2 continuous re-scans) the same content is presented
// to the scanner over and over. This cache keys results on the bundle content
// and serves a cache hit without loading blob bytes or executing a single
// detector.
//
// Correctness/security note: the key is derived from (path, blob_hash) pairs,
// NOT from blob_hash alone. A blob_hash uniquely determines its bytes, and the
// path feeds both `isTextFile` and the `file` field of every Finding, so two
// bundles share a key iff they are byte-identical at identical paths — exactly
// runScan's input domain. A cache hit can never downgrade a scan: the cached
// status/findings are the ones runScan would have produced for this very
// content. The key is opaque (a hash of internal blob hashes) and carries no
// secret material.
import type { DatabaseSync } from '../db/sqlite-handle.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { DecodedBundle } from '@skillet/protocol';
import type { ScanStatus } from './types.js';
/**
 * Detector corpus version. The cache is keyed on
 * (content_key, DETECTOR_CORPUS_VERSION).
 *
 * BUMP THIS whenever ANY scan input changes: a detector pattern added/edited/
 * removed, a category or confidence mapping changed, or the status rollup logic
 * changed. Bumping makes every previously-cached entry unreachable (the key no
 * longer matches), which forces a fresh scan of every bundle against the new
 * corpus — exactly the AC-required "a corpus bump must force re-scan". A stale
 * value here is a silent miss: new detectors would never see already-cached
 * content. Treat a detector change and a bump as one atomic commit.
 *
 * v12: template suffixes (.tmpl/.template/.tpl) classify by their inner
 * extension, so `SKILL.md.tmpl` runs the prose detectors instead of skipping.
 * v13: `output-injection` threat category (promo-footer injection).
 * v14: injection `fake-system-tag` now requires an injection cue after a bare
 * `system:` (was flagging benign config keys like `system: OpenMM System`).
 * v15: `homoglyph-identifier` downgrades to medium in markdown/doc files, so
 * Greek/Cyrillic math notation (exp(-Xβ)) flags instead of quarantining docs.
 * v16: extensionless shebang scripts (`scripts/deploy`, `bin/install`) now
 * dispatch as their interpreter language, so the code-shape threat detectors
 * scan them instead of skipping on the missing `.sh`/`.py` extension.
 */
export const DETECTOR_CORPUS_VERSION = 16;

/**
 * Fingerprint of the THREAT detector set (every `category:detector` in the
 * committed inventory). The drift guard (tests/corpus-version-guard.test.ts)
 * recomputes it and fails if it no longer matches — turning "added/removed a
 * detector but forgot to bump DETECTOR_CORPUS_VERSION" from a silent stale-cache
 * miss into a red test. BUMP THE VERSION ABOVE whenever you change this value.
 * (Catches detector-set changes; a pure regex edit inside an existing detector
 * still relies on the doc rule above — bump on any logic change.)
 */
export const THREAT_CORPUS_FINGERPRINT = '24af7b55f5f0ca66';
export interface BundleManifestEntry {
    path: string;
    blob_hash: string;
}
export interface CachedScan {
    status: ScanStatus;
    findings_json: string;
}
export interface ScanCacheStats {
    corpus_version: number;
    hits: number;
    misses: number;
    /** hits / (hits + misses); 0 when nothing has been scanned yet. */
    hit_rate: number;
    /** Distinct cached bundles at the current corpus version. */
    entries: number;
}
const CONTENT_KEY_PREFIX = 'scan:';
/** Lexicographic byte order — mirrors the protocol's canonical path ordering. */
function comparePathBytes(a: string, b: string): number {
    return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
function keyFrom(entries: BundleManifestEntry[]): string {
    const sorted = [...entries].sort((a, b) => comparePathBytes(a.path, b.path));
    const hash = createHash('sha256');
    const sep = Buffer.from([0x00]);
    for (const e of sorted) {
        hash.update(Buffer.from(e.path, 'utf8'));
        hash.update(sep);
        hash.update(Buffer.from(e.blob_hash, 'utf8'));
        hash.update(sep);
    }
    return CONTENT_KEY_PREFIX + hash.digest('hex');
}
/**
 * Content key from a version/proposal manifest (path → blob_hash). Cheap: it
 * never touches blob bytes, so a cache hit avoids bundle reconstruction too.
 */
export function contentKeyFromManifest(entries: BundleManifestEntry[]): string {
    return keyFrom(entries);
}
/**
 * Content key from an in-memory decoded bundle. Hashes each file's bytes into
 * the same `sha256:`-prefixed blob hash the blob store uses, so a key computed
 * here is identical to one computed from that bundle's persisted manifest.
 */
export function contentKeyFromBundle(bundle: DecodedBundle): string {
    const entries: BundleManifestEntry[] = [];
    for (const [path, bytes] of bundle) {
        const blob_hash = 'sha256:' + createHash('sha256').update(Buffer.from(bytes)).digest('hex');
        entries.push({ path, blob_hash });
    }
    return keyFrom(entries);
}
export function cacheLookup(_db: DatabaseSync, _contentKey: string, _corpusVersion: number = DETECTOR_CORPUS_VERSION): CachedScan | null {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: cacheLookupPrisma");
}
export function cacheStore(_db: DatabaseSync, _contentKey: string, _status: ScanStatus, _findingsJson: string, _corpusVersion: number = DETECTOR_CORPUS_VERSION): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: cacheStorePrisma");
}
/** Tally one cache outcome for the hit-rate metric. */
export function recordCacheOutcome(_db: DatabaseSync, _hit: boolean, _corpusVersion: number = DETECTOR_CORPUS_VERSION): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: recordCacheOutcomePrisma");
}
export function getScanCacheStats(_db: DatabaseSync, _corpusVersion: number = DETECTOR_CORPUS_VERSION): ScanCacheStats {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: getScanCacheStatsPrisma");
}
/** Prisma counterpart of {@link cacheLookup}. */
export async function cacheLookupPrisma(prisma: PrismaDb, contentKey: string, corpusVersion: number = DETECTOR_CORPUS_VERSION): Promise<CachedScan | null> {
    const row = await prisma.scan_result_cache.findUnique({
        where: {
            content_key_corpus_version: {
                content_key: contentKey,
                corpus_version: corpusVersion,
            },
        },
        select: { status: true, findings_json: true },
    });
    if (!row)
        return null;
    return {
        status: row.status as ScanStatus,
        findings_json: row.findings_json,
    };
}
/** Prisma counterpart of {@link cacheStore}. */
export async function cacheStorePrisma(prisma: PrismaDb, contentKey: string, status: ScanStatus, findingsJson: string, corpusVersion: number = DETECTOR_CORPUS_VERSION): Promise<void> {
    const scannedAt = Math.floor(Date.now() / 1000);
    await prisma.scan_result_cache.upsert({
        where: {
            content_key_corpus_version: {
                content_key: contentKey,
                corpus_version: corpusVersion,
            },
        },
        create: {
            content_key: contentKey,
            corpus_version: corpusVersion,
            status,
            findings_json: findingsJson,
            scanned_at: scannedAt,
        },
        update: {
            status,
            findings_json: findingsJson,
            scanned_at: scannedAt,
        },
    });
}
/** Prisma counterpart of {@link recordCacheOutcome}. */
export async function recordCacheOutcomePrisma(prisma: PrismaDb, hit: boolean, corpusVersion: number = DETECTOR_CORPUS_VERSION): Promise<void> {
    const h = hit ? 1 : 0;
    const m = hit ? 0 : 1;
    await prisma.scan_cache_metrics.upsert({
        where: { corpus_version: corpusVersion },
        create: {
            corpus_version: corpusVersion,
            hits: h,
            misses: m,
        },
        update: {
            hits: { increment: h },
            misses: { increment: m },
        },
    });
}
/** Prisma counterpart of {@link getScanCacheStats}. */
export async function getScanCacheStatsPrisma(prisma: PrismaDb, corpusVersion: number = DETECTOR_CORPUS_VERSION): Promise<ScanCacheStats> {
    const metric = await prisma.scan_cache_metrics.findUnique({
        where: { corpus_version: corpusVersion },
        select: { hits: true, misses: true },
    });
    const hits = metric?.hits ?? 0;
    const misses = metric?.misses ?? 0;
    const total = hits + misses;
    const entries = await prisma.scan_result_cache.count({
        where: { corpus_version: corpusVersion },
    });
    return {
        corpus_version: corpusVersion,
        hits,
        misses,
        hit_rate: total === 0 ? 0 : hits / total,
        entries,
    };
}
