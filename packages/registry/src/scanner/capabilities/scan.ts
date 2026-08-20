// Capability assembly + content-hash cache.
//
// `computeCapabilities` is the single entry point the scan runner calls: it
// wires the U2 (code) and U3 (prose) detectors into the U1 collector and joins
// the bundle's threat findings for the risky highlight. It is BEST-EFFORT
//: a capability-scan throw is logged and degraded to an empty report —
// it never propagates, so a capability bug can never block a publish.
//
// Capabilities are pure over a bundle's (path, bytes), exactly like the threat
// scan, so identical content yields an identical report. The cache here mirrors
// `scanner/cache.ts`: it keys the computed report on the SAME bundle content
// key the threat cache uses, paired with `CAPABILITY_VERSION` (the capability
// analog of `DETECTOR_CORPUS_VERSION`). A capability-detector change bumps that
// version, making every prior entry unreachable → forced recompute, without
// disturbing the threat cache or its corpus version.
import type { DatabaseSync } from '../../db/sqlite-handle.js';
import type { DecodedBundle } from '@skillet/protocol';
import type { PrismaDb } from '../../db/prisma-client.js';
import { runCapabilityScan } from './collector.js';
import { CODE_CAPABILITY_DETECTORS } from '../detectors/capability/code-detectors.js';
import { PROSE_CAPABILITY_DETECTORS } from '../detectors/capability/prose-detectors.js';
import { CONFIG_CAPABILITY_DETECTORS } from '../detectors/capability/config-detectors.js';
import type { CapabilityReport } from './types.js';
/** The full capability detector roster (code + prose + config). One list so the
 *  standalone capability scan and the combined single-walk scan register the same set. */
export const ALL_CAPABILITY_DETECTORS = [
    ...CODE_CAPABILITY_DETECTORS,
    ...PROSE_CAPABILITY_DETECTORS,
    ...CONFIG_CAPABILITY_DETECTORS,
];
/**
 * Capability corpus version — the cache is keyed on
 * (content_key, CAPABILITY_VERSION).
 *
 * BUMP THIS whenever ANY capability input changes: a code or prose detector
 * added/edited/removed, or the collector's aggregation/risky-join logic changed.
 * Bumping makes every previously-cached capability report unreachable, forcing a
 * fresh capability scan of every bundle. This is independent of
 * `DETECTOR_CORPUS_VERSION` so capability changes don't churn the threat cache
 * and vice-versa. Treat a capability-detector change and a bump as one commit.
 *
 * REFRESH SEMANTICS: a bump invalidates the `capability_result_cache` (every old
 * row is unreachable at the new version). It does NOT sweep existing
 * `skill_version_scans.capabilities_json` rows — those keep their previously
 * computed value and refresh LAZILY, only when a version is next rescanned (the
 * cache miss then recomputes under the new version). There is no automatic
 * backfill; stale-but-valid manifests are acceptable until the next scan.
 */
// v2: ReDoS-bounded PY_WRITES, inverted partial detection (inert-allowlist +
// .mts/.cts coverage) from the Tier-2 delta review.
// v3: detector precision pass — bare absolute paths no longer read as shell
// (URL route templates), markdown table rows fenced as code aren't commands,
// `npm install` no longer counts as writes-files, `.fetch(` methods (prose AND
// code) aren't network, `=>` isn't a redirect, reads-secrets requires a read
// action (not a bare "API keys" mention), and dependency installs surface as
// the "Installs packages" capability (relabelled from "Run install scripts").
// v4: shell reads-secrets requires a real read of `.env` (source/cat/`.`/`<`/
// dotenv), so `--exclude='.env'` (tar/rsync exclude) no longer false-flags.
// v5: template suffixes (.tmpl/.template/.tpl) are transparent for file
// classification — `SKILL.md.tmpl` is scanned as markdown instead of reading
// as an unscanned blind spot; bare `foo.tmpl` stays a blind spot.
// v6: "trade secrets" (the legal term, NDA/contract prose) no longer matches
// the reads-secrets noun, so "trade secrets may require longer protection"
// stops false-flagging Reads-env-variables.
// v7: new `injects-output-content` capability — prose instructions that insert
// skill-authored content (footers, banners, credits) into the agent's output
// (the claude-seo "Community Footer" incident shape, 2026-07).
// v8: new `connects-mcp-server` capability — a bundled MCP config (mcp.json /
// claude_desktop_config.json / .mcp.json) that wires up a third-party MCP server.
// v9: extensionless shebang scripts (`scripts/deploy`, `bin/install`) resolve to
// their interpreter language, so the code capability detectors inspect them and
// they count as covered instead of reading as unscanned blind-spot files.
export const CAPABILITY_VERSION = 10;

/**
 * Fingerprint of the capability id set in the committed inventory. The drift
 * guard (tests/corpus-version-guard.test.ts) recomputes it and fails if it no
 * longer matches — so adding/removing a capability without bumping
 * CAPABILITY_VERSION is a red test, not a silent stale-cache miss. BUMP THE
 * VERSION ABOVE whenever you change this value.
 */
export const CAPABILITY_CORPUS_FINGERPRINT = 'f6df648db2d57936';
/**
 * Compute the capability inventory for a decoded bundle, joining the bundle's
 * already-computed threat findings so co-located capabilities render `risky`.
 *
 * Best-effort by contract: any throw is caught, logged, and degraded to
 * `null` — NOT to an empty report. The null-vs-empty contract is load-bearing:
 *   - `null`               → NOT computed (a transient bug). The caller must
 *     persist NULL ("not analyzed") and must NOT cache it, so a recompute can
 *     succeed later. A `{capabilities:[]}` here would be CACHED + PERSISTED and
 *     turn a transient throw into a permanent false "inert" (the top fix, FIX1).
 *   - `{capabilities:[]}`  → computed and genuinely found nothing.
 * It never throws, so it never blocks publish.
 */
export function computeCapabilities(bundle: DecodedBundle, threatFindings: ReadonlyArray<{
    file: string;
    lineStart: number;
    lineEnd: number;
}> = []): CapabilityReport | null {
    try {
        return runCapabilityScan(bundle, ALL_CAPABILITY_DETECTORS, threatFindings.map((f) => ({
            file: f.file,
            lineStart: f.lineStart,
            lineEnd: f.lineEnd,
        })));
    }
    catch (err) {
        // Never block publish on a capability bug. Return null → "not computed" so
        // the caller persists NULL and skips the cache; the next scan can retry.
        console.error('[capabilities] scan failed; recording not-computed (NULL)', err);
        return null;
    }
}
/**
 * Read a cached capability report JSON for a content key at the current
 * capability version. Null on a miss (never scanned, or version bumped).
 */
export function capabilityCacheLookup(_db: DatabaseSync, _contentKey: string, _version: number = CAPABILITY_VERSION): string | null {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: capabilityCacheLookupPrisma");
}
/** Write a computed capability report JSON through the content-hash cache. */
export function capabilityCacheStore(_db: DatabaseSync, _contentKey: string, _capabilitiesJson: string, _version: number = CAPABILITY_VERSION): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: capabilityCacheStorePrisma");
}
/** Prisma counterpart of {@link capabilityCacheLookup}. */
export async function capabilityCacheLookupPrisma(prisma: PrismaDb, contentKey: string, version: number = CAPABILITY_VERSION): Promise<string | null> {
    const row = await prisma.capability_result_cache.findUnique({
        where: {
            content_key_capability_version: {
                content_key: contentKey,
                capability_version: version,
            },
        },
        select: { capabilities_json: true },
    });
    return row?.capabilities_json ?? null;
}
/** Prisma counterpart of {@link capabilityCacheStore}. */
export async function capabilityCacheStorePrisma(prisma: PrismaDb, contentKey: string, capabilitiesJson: string, version: number = CAPABILITY_VERSION): Promise<void> {
    const computedAt = Math.floor(Date.now() / 1000);
    await prisma.capability_result_cache.upsert({
        where: {
            content_key_capability_version: {
                content_key: contentKey,
                capability_version: version,
            },
        },
        create: {
            content_key: contentKey,
            capability_version: version,
            capabilities_json: capabilitiesJson,
            computed_at: computedAt,
        },
        update: {
            capabilities_json: capabilitiesJson,
            computed_at: computedAt,
        },
    });
}
