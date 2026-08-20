// Async post-publish scan runner. Owns the `skill_version_scans` table.
//
// The publish path inserts a `pending` row and schedules a run. The runner
// reads the bundle back from content-addressed storage, runs `runScan`, and
// upserts the result. Bundle reconstruction is deliberate: it ensures the
// scan operates on the canonical bytes the server will serve, not on whatever
// the publisher sent us in-memory.
import type { DatabaseSync } from '../db/sqlite-handle.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { decodeBundle, isSkilletBackupPath, type BundleFiles, type DecodedBundle } from '@skillet/protocol';
import type { BlobStore } from '../blob-store/types.js';
import { loadBundleForVersion, loadBundleFromManifest } from '../blob-store/load-bundle.js';
import { summarize, ASYNC_DETECTORS, finalizeThreatScan } from './scanner.js';
import { scanBundle } from './scan-engine.js';
import { aggregateCapabilities } from './capabilities/collector.js';
import { cacheLookup, cacheLookupPrisma, cacheStore, cacheStorePrisma, contentKeyFromBundle, contentKeyFromManifest, recordCacheOutcome, recordCacheOutcomePrisma, type BundleManifestEntry } from './cache.js';
import { ALL_CAPABILITY_DETECTORS, capabilityCacheLookup, capabilityCacheLookupPrisma, capabilityCacheStore, capabilityCacheStorePrisma, computeCapabilities } from './capabilities/scan.js';
import type { CapabilityEntry, CapabilityReport } from './capabilities/types.js';
import type { Finding, FindingsSummary, PublicCapabilityEntry, PublicFinding, ScanInfo, ScanReport, ScanResult, ScanStatus } from './types.js';
const EMPTY_SUMMARY: FindingsSummary = {
    total: 0,
    counts: {},
    topConfidence: null,
    highlights: [],
};
/**
 * Serialize a scan result for the `findings_json` column WITHOUT any secret's
 * bytes. A `secret`-category finding's `snippet` is the credential itself, so it
 * must never be written to the DB / content cache — file:line is enough to
 * locate it, and the bundle is already content-addressed. (Serve-time redaction
 * also drops it, but stripping at rest keeps the persisted report from ever
 * mirroring a credential, and is defence-in-depth against a future raw serve.)
 */
function serializeFindingsForStore(result: ScanResult): string {
    const findings = result.findings.map((f) => f.category === 'secret' ? { ...f, snippet: '' } : f);
    return JSON.stringify({ findings, summary: result.summary });
}
/** Rebuild a ScanResult from a persisted/cached findings JSON string. */
function rehydrate(findingsJson: string, status: ScanStatus): ScanResult {
    // The cache only ever stores runScan output, which never emits 'pending'.
    const result: ScanResult = {
        status: status as ScanResult['status'],
        findings: [],
        summary: EMPTY_SUMMARY,
    };
    try {
        const parsed = JSON.parse(findingsJson) as {
            findings?: Finding[];
            summary?: FindingsSummary;
        };
        if (parsed.findings)
            result.findings = parsed.findings;
        if (parsed.summary)
            result.summary = parsed.summary;
    }
    catch {
        // fall through to the empty result above
    }
    return result;
}
/**
 * Content-hash cache front door. On a hit, returns the cached result
 * without loading blob bytes or running a detector; on a miss, materializes the
 * bundle via `loadBundle`, scans it, and writes the result through to the cache.
 * Either way it tallies the outcome for the hit-rate metric. Returns the result
 * plus the JSON string to persist into the per-version / per-proposal scan row.
 */
interface ResolvedScan {
    result: ScanResult;
    findingsJson: string;
    /**
     * Capability report JSON, computed alongside the threat scan.
     * `null` = NOT computed (a capability-side failure, or a bundle we couldn't
     * load to recompute) → the caller persists NULL ("not analyzed"), never an
     * empty report. Null-vs-empty is the load-bearing contract.
     */
    capabilitiesJson: string | null;
}
/**
 * Compute the capability report for a freshly-scanned bundle and write it
 * through the capability content-hash cache.
 *
 * Best-effort and FULLY isolated from the threat scan: the entire
 * body — compute, serialize, AND the cache write (a DB op) — is wrapped, so ANY
 * capability-side failure (a detector bug, a serialization error, a cache-write
 * error) degrades to `null` ("not computed") instead of propagating out and
 * blocking the publish/persist. Returns:
 *   - the report JSON on success (also written through the cache),
 *   - `null` when the report could not be computed → caller persists NULL and
 *     does NOT cache, so a later rescan can retry.
 */
/** Serialize + cache a (best-effort) capability report. `null` report → NULL
 *  (persist "not computed", skip cache); a serialize/store failure also yields
 *  NULL and must NEVER block the threat scan. Shared by the capabilities-only
 *  path (below) and the combined single-walk scan ({@link scanBothFresh}). */
function persistCapabilityReport(db: DatabaseSync, contentKey: string, report: CapabilityReport | null): string | null {
    if (report == null)
        return null;
    try {
        const json = JSON.stringify(report);
        capabilityCacheStore(db, contentKey, json);
        return json;
    }
    catch (err) {
        console.error('[capabilities] cache store failed; recording not-computed', err);
        return null;
    }
}
/** Prisma counterpart of {@link persistCapabilityReport}. */
async function persistCapabilityReportPrisma(prisma: PrismaDb, contentKey: string, report: CapabilityReport | null): Promise<string | null> {
    if (report == null)
        return null;
    try {
        const json = JSON.stringify(report);
        await capabilityCacheStorePrisma(prisma, contentKey, json);
        return json;
    }
    catch (err) {
        console.error('[capabilities] cache store failed; recording not-computed', err);
        return null;
    }
}
/** Capabilities-only compute + cache (the backfill / threat-cache-hit path):
 *  walks the bundle for capability detectors alone — threats are NOT re-run. */
function computeAndCacheCapabilities(db: DatabaseSync, contentKey: string, bundle: DecodedBundle, threatFindings: Finding[]): string | null {
    return persistCapabilityReport(db, contentKey, computeCapabilities(bundle, threatFindings));
}
/** Prisma counterpart of {@link computeAndCacheCapabilities}. */
async function computeAndCacheCapabilitiesPrisma(prisma: PrismaDb, contentKey: string, bundle: DecodedBundle, threatFindings: Finding[]): Promise<string | null> {
    return persistCapabilityReportPrisma(prisma, contentKey, computeCapabilities(bundle, threatFindings));
}
/** ONE walk, both families — the fresh-scan path. Replaces runScan + a separate
 *  capability walk: the engine produces threat findings AND capability hits in a
 *  single traversal, then each is finalized. Capability aggregation is
 *  best-effort (NULL on throw), so it never blocks the threat result. The
 *  risky-join uses the finalized (weighted) findings, exactly as before. */
function scanBothFresh(bundle: DecodedBundle): {
    result: ScanResult;
    report: CapabilityReport | null;
} {
    const { findings, capabilityHits, capabilityFiles } = scanBundle(bundle, {
        threatDetectors: ASYNC_DETECTORS,
        capabilityDetectors: ALL_CAPABILITY_DETECTORS,
    });
    const result = finalizeThreatScan(bundle, findings);
    let report: CapabilityReport | null;
    try {
        report = aggregateCapabilities(capabilityHits, capabilityFiles, result.findings);
    }
    catch (err) {
        console.error('[capabilities] scan failed; recording not-computed (NULL)', err);
        report = null;
    }
    return { result, report };
}
/**
 * Resolve the capability report on a THREAT-cache hit. The common case is a
 * capability-cache hit too (identical content, same CAPABILITY_VERSION) → no
 * recompute and no blob load, exactly mirroring the threat cache. Only a
 * capability-cache miss (older cache row, or a CAPABILITY_VERSION bump) falls
 * back to loading the bundle to compute and backfill the report. A bundle we
 * cannot load yields `null` ("not computed"), never an empty report.
 */
function resolveCapabilitiesOnHit(db: DatabaseSync, contentKey: string, loadBundle: () => DecodedBundle | null, threatFindings: Finding[]): string | null {
    const cached = capabilityCacheLookup(db, contentKey);
    if (cached != null)
        return cached;
    const bundle = loadBundle();
    if (!bundle)
        return null;
    return computeAndCacheCapabilities(db, contentKey, bundle, threatFindings);
}
/** Prisma counterpart of {@link resolveCapabilitiesOnHit}. */
async function resolveCapabilitiesOnHitPrisma(prisma: PrismaDb, contentKey: string, loadBundle: () => DecodedBundle | null, threatFindings: Finding[]): Promise<string | null> {
    const cached = await capabilityCacheLookupPrisma(prisma, contentKey);
    if (cached != null)
        return cached;
    const bundle = loadBundle();
    if (!bundle)
        return null;
    return computeAndCacheCapabilitiesPrisma(prisma, contentKey, bundle, threatFindings);
}
function scanWithCache(db: DatabaseSync, contentKey: string, loadBundle: () => DecodedBundle | null): ResolvedScan | null {
    const cached = cacheLookup(db, contentKey);
    if (cached) {
        recordCacheOutcome(db, true);
        const result = rehydrate(cached.findings_json, cached.status);
        return {
            result,
            findingsJson: cached.findings_json,
            capabilitiesJson: resolveCapabilitiesOnHit(db, contentKey, loadBundle, result.findings),
        };
    }
    const bundle = loadBundle();
    if (!bundle)
        return null;
    // Single walk for both families (threats + capabilities).
    const { result, report } = scanBothFresh(bundle);
    const findingsJson = serializeFindingsForStore(result);
    cacheStore(db, contentKey, result.status, findingsJson);
    const capabilitiesJson = persistCapabilityReport(db, contentKey, report);
    recordCacheOutcome(db, false);
    return { result, findingsJson, capabilitiesJson };
}
/** Prisma counterpart of {@link scanWithCache}. */
async function scanWithCachePrisma(prisma: PrismaDb, contentKey: string, loadBundle: () => DecodedBundle | null): Promise<ResolvedScan | null> {
    const cached = await cacheLookupPrisma(prisma, contentKey);
    if (cached) {
        await recordCacheOutcomePrisma(prisma, true);
        const result = rehydrate(cached.findings_json, cached.status);
        return {
            result,
            findingsJson: cached.findings_json,
            capabilitiesJson: await resolveCapabilitiesOnHitPrisma(prisma, contentKey, loadBundle, result.findings),
        };
    }
    const bundle = loadBundle();
    if (!bundle)
        return null;
    // Single walk for both families (threats + capabilities).
    const { result, report } = scanBothFresh(bundle);
    const findingsJson = serializeFindingsForStore(result);
    await cacheStorePrisma(prisma, contentKey, result.status, findingsJson);
    const capabilitiesJson = await persistCapabilityReportPrisma(prisma, contentKey, report);
    await recordCacheOutcomePrisma(prisma, false);
    return { result, findingsJson, capabilitiesJson };
}
async function scanWithCacheAsync(db: DatabaseSync, blobStore: BlobStore, contentKey: string, loadBundle: () => Promise<DecodedBundle | null>): Promise<ResolvedScan | null> {
    const cached = cacheLookup(db, contentKey);
    if (cached) {
        recordCacheOutcome(db, true);
        const result = rehydrate(cached.findings_json, cached.status);
        // Capability-cache hit avoids any load; a miss loads once to backfill.
        let capabilitiesJson = capabilityCacheLookup(db, contentKey);
        if (capabilitiesJson == null) {
            const bundle = await loadBundle();
            // A bundle we cannot load → null ("not computed"), never an empty report.
            capabilitiesJson = bundle
                ? computeAndCacheCapabilities(db, contentKey, bundle, result.findings)
                : null;
        }
        return { result, findingsJson: cached.findings_json, capabilitiesJson };
    }
    const bundle = await loadBundle();
    if (!bundle)
        return null;
    // Single walk for both families (threats + capabilities).
    const { result, report } = scanBothFresh(bundle);
    const findingsJson = serializeFindingsForStore(result);
    cacheStore(db, contentKey, result.status, findingsJson);
    const capabilitiesJson = persistCapabilityReport(db, contentKey, report);
    recordCacheOutcome(db, false);
    return { result, findingsJson, capabilitiesJson };
}
function persistVersionScan(_db: DatabaseSync, _skillId: string, _versionHash: string, _status: ScanStatus, _findingsJson: string, _capabilitiesJson: string | null): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: persistVersionScanPrisma");
}
/**
 * Capabilities-ONLY persist for the backfill job. Refreshes the capability
 * manifest of an EXISTING scan row without re-running — or touching — the threat
 * scan (status/findings stay exactly as they were, so no spurious rebalance).
 *
 * Mirrors persistVersionScan's null-vs-empty contract precisely:
 *   - `null`  → NOT computed (un-loadable bundle / transient failure). Leave the
 *     row untouched: a NULL stays "not analyzed" and a previously-good report is
 *     never clobbered by a false empty. The backfill counts this as
 *     skipped, never a write.
 *   - non-null → write the report AND stamp CAPABILITY_VERSION, in lockstep.
 */
export function persistVersionCapabilities(_db: DatabaseSync, _skillId: string, _versionHash: string, _capabilitiesJson: string | null): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: persistVersionCapabilitiesPrisma");
}
/** Read the per-version manifest (path → blob_hash). Empty when no row exists. */
function versionManifest(_db: DatabaseSync, _skillId: string, _versionHash: string): BundleManifestEntry[] {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: versionManifestPrisma");
}
/** Insert the initial `pending` row at publish time. Idempotent. */
export function insertPendingScan(_db: DatabaseSync, _skillId: string, _versionHash: string): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: insertPendingScanPrisma");
}
/**
 * Run the scan synchronously over an already-decoded bundle and persist.
 * Routes through the content-hash cache: a bundle whose content was already
 * scanned (under the current detector corpus) reuses that result.
 */
export function runScanAndPersist(db: DatabaseSync, skillId: string, versionHash: string, bundle: DecodedBundle): ScanResult {
    const key = contentKeyFromBundle(bundle);
    const resolved = scanWithCache(db, key, () => bundle)!;
    persistVersionScan(db, skillId, versionHash, resolved.result.status, resolved.findingsJson, resolved.capabilitiesJson);
    return resolved.result;
}
/**
 * Cache-aware scan of a decoded bundle WITHOUT persisting a version scan row.
 * Used at the publish gate (before any version row exists) and by the dry-run
 * scan endpoint — it warms the content cache so the post-commit persist (and a
 * prior dry-run of identical content) resolves as a cache hit.
 */
export function scanBundleCached(db: DatabaseSync, bundle: DecodedBundle): ScanResult {
    const key = contentKeyFromBundle(bundle);
    return scanWithCache(db, key, () => bundle)!.result;
}
/**
 * Prisma counterpart of {@link scanBundleCached}. Used when the live registry
 * has a MySQL Prisma client so publish/dry-run warm `scan_result_cache` /
 * `capability_result_cache` there instead of an empty sqlite scaffold.
 */
export async function scanBundleCachedPrisma(prisma: PrismaDb, bundle: DecodedBundle): Promise<ScanResult> {
    return (await resolveScanCachedPrisma(prisma, bundle))!.result;
}
/**
 * Full cache-aware resolve for a decoded bundle on Prisma (threat + capabilities
 * JSON). Used by publish persist so MySQL gets the same stamp as sqlite
 * `runScanAndPersist`.
 */
export async function resolveScanCachedPrisma(prisma: PrismaDb, bundle: DecodedBundle): Promise<ResolvedScan> {
    const key = contentKeyFromBundle(bundle);
    return (await scanWithCachePrisma(prisma, key, () => bundle))!;
}
/**
 * Run the scan for a version stored in the DB. On a content-cache hit this
 * never loads blob bytes — the manifest alone yields the key, and the cached
 * findings are written straight to the version's scan row.
 */
export async function runScanForVersion(db: DatabaseSync, blobStore: BlobStore, skillId: string, versionHash: string): Promise<ScanResult | null> {
    const manifest = versionManifest(db, skillId, versionHash);
    if (manifest.length === 0)
        return null;
    const key = contentKeyFromManifest(manifest);
    const resolved = await scanWithCacheAsync(db, blobStore, key, () => loadBundleForVersion(db, blobStore, versionHash));
    if (!resolved)
        return null;
    persistVersionScan(db, skillId, versionHash, resolved.result.status, resolved.findingsJson, resolved.capabilitiesJson);
    return resolved.result;
}
/**
 * Decode a `capabilities_json` column into a {@link CapabilityReport}.
 *
 * Returns `null` distinctly from `{ capabilities: [] }`:
 *   - `null`  → the column is absent/NULL (an older row, or a still-`pending`
 *     insert) — capabilities were NEVER computed for this version. The UI shows
 *     "not analyzed".
 *   - `{ capabilities: [] }` → capabilities WERE computed and found nothing. The
 *     UI shows "No capabilities detected".
 * A malformed/unparseable value is treated as "not computed" (`null`).
 */
export function parseCapabilities(json: string | null | undefined): CapabilityReport | null {
    if (json == null)
        return null;
    try {
        const parsed = JSON.parse(json) as {
            capabilities?: unknown;
            analysis?: unknown;
            blindSpots?: unknown;
        };
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.capabilities)) {
            // Light per-entry validation: keep only well-formed entries (a
            // string `capability` + an array `evidence`); silently drop the rest so a
            // single corrupt entry can't poison the read or crash a consumer. Cheap,
            // no schema lib. An entirely malformed payload still falls through to null.
            const capabilities = (parsed.capabilities as unknown[]).filter(isWellFormedCapabilityEntry) as CapabilityEntry[];
            // `analysis` rides the stored report. Default to 'partial' when the
            // field is absent: a legacy/transitional row written before the
            // qualifier existed never RECORDED that it fully inspected the bundle, so
            // we must not CLAIM full inspection we can't prove — conservative is the
            // safe direction. Only an explicit 'full' reads back as full.
            const analysis = parsed.analysis === 'full' ? 'full' : 'partial';
            // Blind-spot paths ride the stored report. A legacy row written before the
            // field existed reads back as `[]` (no list to show) — the `analysis` flag
            // still conveys partial-ness; only the file list is unavailable until rescan.
            const rawBlindSpots = Array.isArray(parsed.blindSpots)
                ? parsed.blindSpots.filter((p): p is string => typeof p === 'string')
                : [];
            const blindSpots = rawBlindSpots.filter((p) => !isSkilletBackupPath(p));
            let resolvedAnalysis: 'full' | 'partial' = analysis;
            if (resolvedAnalysis === 'partial' &&
                rawBlindSpots.length > 0 &&
                blindSpots.length === 0) {
                // Polluted publishes stored ephemeral `.skillet-backup` paths as blind
                // spots; they are not real unscanned skill content.
                resolvedAnalysis = 'full';
            }
            return { capabilities, analysis: resolvedAnalysis, blindSpots };
        }
    }
    catch {
        // malformed → treat as not computed
    }
    return null;
}
/** A stored capability entry is usable iff it has a string `capability` and an
 *  array `evidence`. Everything else (null, missing fields, wrong types) is
 *  dropped rather than trusted. */
function isWellFormedCapabilityEntry(e: unknown): boolean {
    return (!!e &&
        typeof e === 'object' &&
        typeof (e as {
            capability?: unknown;
        }).capability === 'string' &&
        Array.isArray((e as {
            evidence?: unknown;
        }).evidence));
}
/**
 * Read the persisted capability report for a version. `null` when the version
 * has no scan row OR the capability column was never computed (see
 * {@link parseCapabilities}); `{ capabilities: [] }` when computed-but-empty.
 */
export function getScanCapabilities(_db: DatabaseSync, _versionHash: string): CapabilityReport | null {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: getScanCapabilitiesPrisma");
}
/** Read the persisted scan state for a version. Null when no row exists. */
export function getScanInfo(_db: DatabaseSync, _versionHash: string): ScanInfo | null {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: getScanInfoPrisma");
}
/** Prisma counterpart of {@link getScanInfo}. */
export async function getScanInfoPrisma(prisma: PrismaDb, versionHash: string): Promise<ScanInfo | null> {
    const bare = versionHash.startsWith('sha256:')
        ? versionHash.slice('sha256:'.length)
        : versionHash;
    const row = await prisma.skill_version_scans.findFirst({
        where: {
            OR: [
                { skill_version_id: versionHash },
                { skill_version_id: bare },
                { skill_version_id: `sha256:${bare}` },
            ],
        },
        select: { status: true, findings_json: true },
    });
    if (!row)
        return null;
    const parsed = parseFindings(row.findings_json);
    return {
        status: row.status as ScanStatus,
        findings_summary: parsed.summary,
    };
}
/**
 * The newest INSTALLABLE version hash for a skill: non-yanked and not
 * quarantined. `clean` / `flagged` / `pending` / un-scanned all count as
 * installable — only a confirmed-dangerous (`quarantined`) version is excluded.
 * Null when the skill has no installable version. This is the single source of
 * truth for "current clean version" used by the install serve path and the
 * scan-completion rebalance (the trust-flow invariant: the installable pointer
 * never references a quarantined version).
 */
export function lastCleanHash(_db: DatabaseSync, _skillId: string): string | null {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: lastCleanHashPrisma");
}
/** True when a specific version is quarantined (used by serve-path fallback). */
export function isQuarantined(_db: DatabaseSync, _versionHash: string): boolean {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: isQuarantinedPrisma");
}
interface ParsedFindings {
    findings: Finding[];
    summary: FindingsSummary;
}
/**
 * Decode a `findings_json` column into a findings list + summary.
 *
 * The column has two historical shapes and we must read both:
 *   1. `{ findings: Finding[], summary: FindingsSummary }` — written by
 *      `runScanAndPersist` / `runScanForProposal` (the async path).
 *   2. `Finding[]` — written by the proposal-approve fast path in
 *      routes/proposals.ts, which stores only the bare array.
 * When the summary is absent (shape 2) we recompute it from the findings so
 * the badge counts and the public report stay correct regardless of which
 * path produced the row.
 */
function parseFindings(json: string): ParsedFindings {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return { findings: [], summary: EMPTY_SUMMARY };
    }
    if (Array.isArray(parsed)) {
        const findings = parsed as Finding[];
        return { findings, summary: summarize(findings) };
    }
    if (parsed && typeof parsed === 'object') {
        const obj = parsed as {
            findings?: Finding[];
            summary?: FindingsSummary;
        };
        const findings = Array.isArray(obj.findings) ? obj.findings : [];
        const summary = obj.summary ?? summarize(findings);
        return { findings, summary };
    }
    return { findings: [], summary: EMPTY_SUMMARY };
}
/**
 * Threat findings parsed from a stored `findings_json` column. The capability
 * backfill feeds these into the risky-join so a recomputed manifest highlights
 * co-located capabilities — WITHOUT re-running the threat scan.
 */
export function threatFindingsFromJson(json: string): Finding[] {
    return parseFindings(json).findings;
}
/**
 * Project a stored {@link CapabilityReport} to its public, location-only shape.
 *
 * Preserves the null-vs-empty distinction (null = not computed; `[]` = computed
 * and empty) and rebuilds each evidence object field-by-field so ONLY
 * file/line/source ever leave the server — capabilities carry no snippet, and
 * this keeps it that way even if the internal evidence type grows a field.
 */
function toPublicCapabilities(report: CapabilityReport | null): PublicCapabilityEntry[] | null {
    if (report == null)
        return null;
    return report.capabilities.map((entry) => ({
        capability: entry.capability,
        risky: entry.risky,
        evidence: entry.evidence.map((e) => ({
            file: e.file,
            lineStart: e.lineStart,
            lineEnd: e.lineEnd,
            source: e.source,
        })),
    }));
}
/** Strip a `Finding` down to its public projection (drops `snippet`). */
function toPublicFinding(f: Finding, includeSnippet: boolean): PublicFinding {
    const base: PublicFinding = {
        category: f.category,
        confidence: f.confidence,
        file: f.file,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        why: f.why,
    };
    // A `secret` finding's excerpt IS the secret — never serve it, even to an
    // allowed caller. Everything else can carry the short peek when permitted.
    if (includeSnippet && f.category !== 'secret')
        base.snippet = f.snippet;
    return base;
}
/**
 * Public read model for a version's security tab. Returns the full
 * snippet-stripped findings list alongside the status + summary. Null when no
 * scan row exists (legacy/un-scanned version). A `pending` or `clean` row
 * returns an empty `findings` array, never null — callers distinguish
 * "not scanned" (null) from "scanned, nothing to show" (empty).
 */
function buildScanReportFromRow(row: {
    status: string;
    findings_json: string;
    capabilities_json: string | null;
}, notes: Record<string, string>, opts?: {
    snippets?: boolean;
}): ScanReport {
    const parsed = parseFindings(row.findings_json);
    const snippets = opts?.snippets ?? false;
    // Capabilities ride the same fetch and are returned regardless of scan
    // status — a CLEAN skill still reports what it can do. Null-vs-empty is
    // preserved end-to-end: null = not computed, [] = computed-and-none.
    const capabilityReport = parseCapabilities(row.capabilities_json);
    const capabilities = toPublicCapabilities(capabilityReport);
    return {
        status: row.status as ScanStatus,
        findings_summary: parsed.summary,
        findings: parsed.findings.map((f) => {
            const pub = toPublicFinding(f, snippets);
            const note = notes[harmNoteKey(f)];
            if (note)
                pub.note = note;
            return pub;
        }),
        capabilities,
        // Trust qualifier on the manifest: 'partial' means an executable file
        // went un-inspected, so an empty `capabilities` is NOT a guarantee of
        // inertness. `null` when capabilities were never computed.
        capabilities_analysis: capabilityReport ? capabilityReport.analysis : null,
        // The un-inspected file paths behind a 'partial' analysis, so the UI can list
        // them ("Unscanned files"). [] when full / never-computed / a legacy row.
        capabilities_blind_spots: capabilityReport ? capabilityReport.blindSpots : [],
    };
}
export function getScanReport(_db: DatabaseSync, _versionHash: string, _opts?: {
    snippets?: boolean;
}): ScanReport | null {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: getScanReportPrisma");
}
/** Prisma counterpart of {@link getScanReport}. */
export async function getScanReportPrisma(prisma: PrismaDb, versionHash: string, opts?: {
    snippets?: boolean;
}): Promise<ScanReport | null> {
    const bare = versionHash.startsWith('sha256:')
        ? versionHash.slice('sha256:'.length)
        : versionHash;
    const hashVariants = [versionHash, bare, `sha256:${bare}`];
    const row = await prisma.skill_version_scans.findFirst({
        where: { skill_version_id: { in: hashVariants } },
        select: { status: true, findings_json: true, capabilities_json: true },
    });
    if (!row)
        return null;
    const notes = await readHarmNotesPrisma(prisma, hashVariants);
    return buildScanReportFromRow(row, notes, opts);
}
/** Stable key joining a finding to its author note: category:file:lineStart. */
export function harmNoteKey(f: {
    category: string;
    file: string;
    lineStart: number;
}): string {
    return `${f.category}:${f.file}:${f.lineStart}`;
}
/** Parse `harm_notes` from a version `metadata_json` payload. */
function harmNotesFromMetadata(metadataJson: string | null | undefined): Record<string, string> {
    if (!metadataJson)
        return {};
    try {
        const meta = JSON.parse(metadataJson) as {
            harm_notes?: unknown;
        };
        if (meta.harm_notes && typeof meta.harm_notes === 'object') {
            return meta.harm_notes as Record<string, string>;
        }
    }
    catch {
        /* malformed metadata → no notes */
    }
    return {};
}
async function readHarmNotesPrisma(prisma: PrismaDb, hashVariants: string[]): Promise<Record<string, string>> {
    const row = await prisma.skill_versions.findFirst({
        where: { hash: { in: hashVariants } },
        select: { metadata_json: true },
    });
    return harmNotesFromMetadata(row?.metadata_json);
}
/** Helper used by publish path: re-derive bundle from publish payload. */
export function bundleFromWire(files: BundleFiles): DecodedBundle {
    return decodeBundle(files);
}
/** Insert the initial `pending` row at propose time. Idempotent. */
export function insertPendingProposalScan(_db: DatabaseSync, _proposalId: string): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: insertPendingProposalScanPrisma");
}
/**
 * Run the scan for a proposal. Shares the same content-hash cache as version
 * scans, so an approved proposal and the version it mints — identical content —
 * scan exactly once across the two tables.
 */
export async function runScanForProposal(_db: DatabaseSync, _blobStore: BlobStore, _proposalId: string): Promise<ScanResult | null> {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: runScanForProposalPrisma");
}
/** Prisma counterpart of {@link runScanForProposal}. Never touches sqlite. */
export async function runScanForProposalPrisma(prisma: PrismaDb, blobStore: BlobStore, proposalId: string): Promise<ScanResult | null> {
    const rows = await prisma.proposal_files.findMany({
        where: { proposal_id: proposalId },
        select: { path: true, blob_hash: true },
    });
    if (rows.length === 0)
        return null;
    const manifest: BundleManifestEntry[] = rows.map((r) => ({
        path: r.path,
        blob_hash: r.blob_hash,
    }));
    const key = contentKeyFromManifest(manifest);
    const resolved = await scanWithCacheAsyncPrisma(prisma, blobStore, key, () => loadBundleFromManifest(blobStore, manifest));
    if (!resolved)
        return null;
    const now = Math.floor(Date.now() / 1000);
    await prisma.proposal_scans.upsert({
        where: { proposal_id: proposalId },
        create: {
            proposal_id: proposalId,
            status: resolved.result.status,
            findings_json: resolved.findingsJson,
            scanned_at: now,
        },
        update: {
            status: resolved.result.status,
            findings_json: resolved.findingsJson,
            scanned_at: now,
        },
    });
    return resolved.result;
}
/** Prisma counterpart of {@link scanWithCacheAsync}. */
async function scanWithCacheAsyncPrisma(prisma: PrismaDb, blobStore: BlobStore, contentKey: string, loadBundle: () => Promise<DecodedBundle | null>): Promise<ResolvedScan | null> {
    const cached = await cacheLookupPrisma(prisma, contentKey);
    if (cached) {
        await recordCacheOutcomePrisma(prisma, true);
        const result = rehydrate(cached.findings_json, cached.status);
        let capabilitiesJson = await capabilityCacheLookupPrisma(prisma, contentKey);
        if (capabilitiesJson == null) {
            const bundle = await loadBundle();
            capabilitiesJson = bundle
                ? await computeAndCacheCapabilitiesPrisma(prisma, contentKey, bundle, result.findings)
                : null;
        }
        return { result, findingsJson: cached.findings_json, capabilitiesJson };
    }
    const bundle = await loadBundle();
    if (!bundle)
        return null;
    const { result, report } = scanBothFresh(bundle);
    const findingsJson = serializeFindingsForStore(result);
    await cacheStorePrisma(prisma, contentKey, result.status, findingsJson);
    const capabilitiesJson = await persistCapabilityReportPrisma(prisma, contentKey, report);
    await recordCacheOutcomePrisma(prisma, false);
    return { result, findingsJson, capabilitiesJson };
}
/** Read the persisted scan state for a proposal. Null when no row exists. */
export function getProposalScanInfo(_db: DatabaseSync, _proposalId: string): ScanInfo | null {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: getProposalScanInfoPrisma");
}
