/**
 * Registry-pull phase of `skillet sync` (AC 2 + 4).
 *
 * For every registry-sourced kit entry, hit its manifest with the last-seen
 * ETag. On 304 nothing changes. On a new `latest_hash`, fetch the version,
 * re-verify the signature against the pinned author key (TOFU), and replace
 * the bundle in the local skill store. The kit entry is mutated in place so
 * the subsequent materialize phase sees the new hash and the graded-diff
 * approval gate fires for what we just downloaded.
 *
 * Headless rule: unattended runs SKIP pulling. The user explicitly
 * froze entries with `--pin`; everything else stays at whatever hash was
 * already approved. Interactive runs pull every non-pinned registry entry.
 *
 * ETag persistence: `~/.skillet/etag-cache.json`, keyed by the entry's slug
 * (which IS the canonical `@author/slug` ref). One file, atomic write,
 * cheap to throw away if it ever corrupts — the worst case is one extra
 * full manifest fetch per skill.
 */

import matter from 'gray-matter';
import { canonicalContentHash, CONTENT_HASH_PREFIX, skillContentHash, type SyncManifestItem } from '@skillet/protocol';
import {
  RegistryClient,
  RegistryError,
  type RegistryClientOptions,
  type RegistryManifest,
  type VersionDetail,
} from './client.js';
import {
  signatureBytes,
  verifyEnvelope,
  SignatureError,
  envelopeBindingFromSlug,
  isBundleSignatureV2,
  type Signature,
} from '../signing/envelope.js';
import {
  bearerKindFromToken,
  defaultEtagCachePath,
  readEtagCache,
  unionManifestEtagKey,
  writeEtagCache,
} from './etag-cache.js';
import { isEd25519Signature, isSessionAttestedSignature } from '../signing/session-attest.js';
import {
  verifyDelegatedVersionSignature,
  DelegationError,
} from '../signing/delegation.js';
import { assertKeyIdBindsPub, authorKeyForVerification, commitAuthorKeyPin, defaultPinDir } from '../signing/pin.js';
import { parseAuthorKeyMismatch } from '../signing/pin-recovery.js';
import type { SignedDelegation } from '@skillet/protocol';
import { writeBundleToSkillStore, upsertSkill, skillContentDir } from '../kit/store.js';
import { skillStoreMatchesExpectedHash, readSkillStoreContentHash } from '../kit/store-integrity.js';
import { detectStoreDrift, stashBaselineVersion } from '../commands/edits-store.js';
import { parseSkillRef } from './identifier.js';
import {
  alignEntryToManifest,
  findAllLocalsForManifestItem,
  sanitizeVersionLabel,
} from '../kit/manifest-match.js';
import type { KitState, SkillEntry } from '../kit/types.js';
import { rename } from 'node:fs/promises';

export type PullStatus =
  | 'updated'      // new hash fetched, bundle rewritten on disk, entry mutated
  | 'unchanged'    // server returned 304 OR latest_hash already in kit
  | 'skipped-pinned'      // entry.pinned === true
  | 'skipped-yanked'      // registry latest is yanked; keep existing bytes
  | 'skipped-unattended'  // headless rule: not interactive
  | 'gone'         // registry 404 — skill deleted upstream; reconcile will prune it
  | 'failed';      // network / verification error — entry left untouched

export interface PullOutcome {
  slug: string;
  status: PullStatus;
  reason?: string;
  newHash?: string;
  /**
   * The canonical (`sha256:`-prefixed) hash of a version the registry now marks
   * YANKED — surfaced so a customized skill holding this version as a
   * `held_update` can be flagged and stop nudging (F6). Set on the `unchanged`
   * outcome when the held/current version itself is yanked, and on the
   * `skipped-yanked` outcome for a newer yanked latest. Absent otherwise.
   */
  yankedHash?: string;
  /** Present when verification refused a registry key rotation without re-pin. */
  authorKeyMismatch?: {
    handle: string;
    pinnedKeyId: string;
    servedKeyId: string;
  };
}

export interface PullOptions {
  /** When false, pull is skipped for non-pinned entries (the headless rule). */
  interactive: boolean;
  /** Pin dir for TOFU verification; defaults to $XDG_CONFIG_HOME/skillet/pinned. */
  pinDir?: string;
  /** Override the ETag cache path; defaults to $SKILLET_DIR/etag-cache.json. */
  etagCachePath?: string;
  /** Bearer token to pass through to every registry call. */
  token?: string;
  /**
   * Device key ids the relevant authors have revoked, pulled on sync.
   * A device-signed version whose key is in this set is refused (AC#3). Absent
   * until a revocation-fetch path is wired (see resolveRevokedDeviceKeyIds).
   *
   * NOTE: this is a single set; prefer `getRevokedKeys` for correct PER-REGISTRY
   * revocation when entries span multiple registries. Kept as a
   * fallback for single-registry callers.
   */
  revokedDeviceKeyIds?: Set<string>;
  /**
   * Resolve the revoked-device-key set for a SPECIFIC serving registry. When
   * provided, each entry is checked against the revocation set of the registry
   * that served it — not a single default-registry set (delegated-device
   * revocation must be per registry).
   */
  getRevokedKeys?: (registryUrl: string) => Promise<Set<string>>;
  /** Inject an alternate fetch (tests). */
  fetchImpl?: typeof fetch;
}

/** Re-export for callers that key union manifest caches. */
export { unionManifestEtagKey } from './etag-cache.js';

/**
 * Guard a pull's store-write against a LIVE local edit (KTD4). The store
 * (`~/.skillet/skills/<ref>`) is where the desktop viewer's "Folder" button
 * sends a human to edit a skill. A pull rewrites the store with author bytes,
 * which would silently destroy that edit BEFORE sync's reconcile loop ever sees
 * it — the exact clobber that made a store edit disappear on the next update.
 *
 * When the store has drifted from what we last MATERIALIZED (a readable edit)
 * and does not already equal the incoming bytes, stash it for recovery and tell
 * the caller to SKIP the write. `entry.hash` still advances to the new version,
 * so sync's store-edit branch then HOLDS the incoming version instead of
 * applying it. Returns true when the store-write must be skipped.
 */
async function preserveLiveStoreEdit(
  ref: string,
  existing: SkillEntry | undefined,
  incomingHash: string,
): Promise<boolean> {
  const baseline = existing?.materialized_hash;
  // Never materialized → there is no prior "our bytes" to distinguish an edit
  // from a first install; let the write proceed.
  if (!baseline) return false;
  const drift = await detectStoreDrift(ref, baseline);
  // Parked store (U2): we may not read it, so we cannot prove no edit sits
  // there. Skip the write (entry.hash still advances; a later sync that can
  // read the store reconciles) — never clobber bytes we are not allowed to see.
  if (drift.parked) return true;
  // An already-customized skill's store IS the user's live edit even when it
  // matches the materialized baseline: capture advances materialized_hash to
  // the edited bytes, so a second author update would see "no drift" and
  // clobber the captured edit (R8, post-capture case). The held-update flow
  // records the new version; only `edits take` may apply it to the store.
  // Preserve unless the store already holds the incoming version (convergence).
  if (
    existing?.customized_from &&
    !drift.uncapturable &&
    drift.hash !== null &&
    drift.hash !== incomingHash
  ) {
    try {
      await stashBaselineVersion(drift.hash, drift.tree!);
    } catch {
      /* best-effort snapshot; the edit is preserved by skipping the write */
    }
    return true;
  }
  // A non-customized entry whose recorded hash has already advanced past the
  // materialized baseline has a PENDING author version staged in the store: a
  // prior sync wrote bytes the user has not approved, or rejected. That store
  // difference is the stage, NOT a user edit — same reasoning as sync.ts's RF1
  // "stable" gate (a disk difference is an edit only when materialized_hash ===
  // hash). Let the incoming write proceed so the store never stays pinned to a
  // rejected version that a later approve would materialize stamped as the new
  // one (consent integrity: approve must apply bytes matching the approved hash).
  if (!existing.customized_from && existing.hash !== baseline) return false;
  if (!drift.drifted || drift.uncapturable || drift.hash === null) return false;
  // Store already equals the incoming version → nothing to preserve.
  if (drift.hash === incomingHash) return false;
  // A readable store that differs from both the last-materialized baseline and
  // the incoming version is a user edit — snapshot it (content-addressed,
  // best-effort) and skip the clobber.
  try {
    await stashBaselineVersion(drift.hash, drift.tree!);
  } catch {
    // Best-effort recovery snapshot; the edit is preserved by skipping the write
    // regardless.
  }
  return true;
}

function failedPullOutcome(slug: string, err: unknown): PullOutcome {
  const reason =
    err instanceof SignatureError || err instanceof DelegationError
      ? `${err.code}: ${err.message}`
      : err instanceof RegistryError
        ? `${err.code}: ${err.message}`
        : `pull_failed: ${(err as Error).message}`;
  const outcome: PullOutcome = { slug, status: 'failed', reason };
  const mismatch = parseAuthorKeyMismatch(reason);
  if (mismatch) outcome.authorKeyMismatch = mismatch;
  return outcome;
}

/** Options for the union-manifest pull phase. */
export interface UnionPullOptions {
  registryUrl: string;
  token: string;
  pinDir?: string;
  /**
   * This machine's registry device id. A session token authenticates the user
   * but not the machine, so we pass it explicitly to get per-device kit routing
   * (which kits sync here). Omitted → the full account union.
   */
  deviceId?: string;
  /** Revoked device key ids to refuse on sync (AC#3). See PullOptions. */
  revokedDeviceKeyIds?: Set<string>;
  /** Override the ETag cache path; defaults to $SKILLET_DIR/etag-cache.json. */
  etagCachePath?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the server-side union manifest for the authenticated caller
 * and bring in any skill refs that are new or updated relative to local state.
 * Mutates `state.skills` in place so the downstream materialize loop sees the
 * additions without another pass.
 *
 * Called BEFORE `pullRegistryUpdates` so new refs land in state first; the
 * per-skill pull loop then treats them as already-up-to-date (same hash).
 *
 * Never throws — per-item failures are returned as `PullOutcome` with
 * status='failed', so one bad skill cannot abort the whole sync.
 */
async function promoteAliasToCanonical(
  state: KitState,
  item: SyncManifestItem,
): Promise<SkillEntry> {
  const matches = findAllLocalsForManifestItem(state, item);
  const primary = matches[0];
  if (!primary) {
    throw new Error(`missing local match for ${item.ref}`);
  }
  const aligned = alignEntryToManifest(primary.entry, item);

  for (const { slug } of matches) {
    if (slug !== item.ref) {
      delete state.skills[slug];
    }
  }

  if (primary.slug !== item.ref) {
    try {
      await rename(skillContentDir(primary.slug), skillContentDir(item.ref));
    } catch {
      // Content may remain under the alias dir until the next import.
    }
  }

  state.skills[item.ref] = aligned;
  await upsertSkill(aligned);
  return aligned;
}

export interface UnionPullResult {
  outcomes: PullOutcome[];
  /**
   * The set of refs the manifest authoritatively contains — the keep-set for
   * pruning. `null` when there is NO authoritative manifest this run (304 not-
   * modified, 401, or a network error): callers MUST NOT prune on `null`, or a
   * transient failure would delete the user's skills.
   */
  manifestRefs: Set<string> | null;
  /**
   * The server's `SyncManifest.account_scope` — `user` is the only value our
   * registry emits. `undefined` when not fetched (304/error) or served by an
   * older server that omits the field. The caller uses this to decide whether
   * an EMPTY manifest may zero a machine out: only a `user`-scoped empty is an
   * authoritative "sync nothing here".
   */
  accountScope?: 'user';
  /** True when the registry rejected the bearer (401) for a linked device token. */
  authRejected?: boolean;
  /** True when GET /sync/manifest returned 304 Not Modified. */
  unionNotModified?: boolean;
}

export async function pullFromUnionManifest(
  state: KitState,
  opts: UnionPullOptions,
): Promise<UnionPullResult> {
  const client = new RegistryClient({
    baseUrl: opts.registryUrl,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  });

  let items: SyncManifestItem[];
  let accountScope: 'user' | undefined;
  let unionEtag: string | null = null;
  const etagPath = opts.etagCachePath ?? defaultEtagCachePath();
  const cache = await readEtagCache(etagPath);
  if (!cache.union) cache.union = {};
  const unionKey = unionManifestEtagKey(
    opts.registryUrl,
    opts.deviceId,
    bearerKindFromToken(opts.token),
  );
  const cachedUnionEtag = cache.union[unionKey] ?? null;
  try {
    const res = await client.getSyncManifest({
      device: opts.deviceId,
      etag: cachedUnionEtag,
    });
    // 304 → identical to last sync (keep-set unchanged); no value → nothing.
    // Either way, not an authoritative change to reconcile against.
    if (res.notModified) {
      return { outcomes: [], manifestRefs: null, unionNotModified: true };
    }
    if (!res.value) return { outcomes: [], manifestRefs: null };
    unionEtag = res.etag ?? null;
    items = res.value.items;
    accountScope = res.value.account_scope;
  } catch (err) {
    if (
      err instanceof RegistryError &&
      (err.code === 'unauthorized' ||
        err.status === 401 ||
        // A device token whose row is unpaired/null-user: the registry fails it
        // closed with 403 device_not_paired. Same recovery as a 401 — route it
        // to the auth-required lane, not a generic throw (which desktop would
        // misclassify as offline).
        err.code === 'device_not_paired')
    ) {
      const linkedDevice = opts.token.startsWith('skillet_d_');
      return {
        outcomes: [],
        manifestRefs: null,
        ...(linkedDevice ? { authRejected: true } : {}),
      };
    }
    throw err;
  }

  const outcomes: PullOutcome[] = [];
  const pinDir = opts.pinDir ?? defaultPinDir();

  for (const item of items) {
    const ref = item.ref;
    // SECURITY (H1): validate the registry-supplied ref BEFORE it reaches any
    // path operation. The alias-promotion shortcut below calls
    // promoteAliasToCanonical → rename(skillContentDir(item.ref)); a hostile
    // manifest ref like "../../../tmp/evil" colliding on a known content_hash
    // would otherwise move the matched local skill dir out of the store.
    // parseSkillRef rejects anything outside the @author/slug grammar.
    try {
      parseSkillRef(ref);
    } catch {
      outcomes.push({ slug: ref, status: 'failed', reason: 'invalid_ref' });
      continue;
    }
    const matches = findAllLocalsForManifestItem(state, item);
    const existing = matches[0]?.entry;
    const hasAlias = matches.some((m) => m.slug !== ref);

    if (existing?.pinned) {
      outcomes.push({ slug: ref, status: 'skipped-pinned' });
      continue;
    }
    // An accepted key rotation flags the entry: the hash matches (rotations
    // don't change content) but the stored envelope/identity verified against
    // the OLD key, so fall through to a full re-fetch + re-verify.
    if (existing && existing.hash === item.content_hash && existing.needsKeyReverify !== true) {
      const storeAligned = await skillStoreMatchesExpectedHash(ref, existing.hash);
      if (storeAligned) {
        if (hasAlias || !existing.sourceKit) {
          await promoteAliasToCanonical(state, item);
        } else {
          const label = sanitizeVersionLabel(item.version_label);
          if (label && label !== existing.versionLabel) {
            existing.versionLabel = label;
            await upsertSkill(existing);
          }
        }
        outcomes.push({ slug: ref, status: 'unchanged' });
        continue;
      }
      // State matches manifest but local store bytes drifted — fall through to fetch.
    } else if (existing) {
      const storeHash = await readSkillStoreContentHash(ref);
      if (storeHash && storeHash === existing.hash) {
        if (
          existing.needsKeyReverify !== true &&
          (await legacyPollutedManifestMatches(client, ref, item.content_hash, storeHash))
        ) {
          outcomes.push({ slug: ref, status: 'unchanged' });
          continue;
        }
      }
      if (storeHash && storeHash === item.content_hash && existing.hash !== item.content_hash) {
        existing.hash = storeHash;
        existing.updatedAt = new Date().toISOString();
        await upsertSkill(existing);
        outcomes.push({ slug: ref, status: 'unchanged' });
        continue;
      }
    }

    try {
      const parsed = parseSkillRef(ref);
      const manifestRes = await client.getSkillManifest(ref);
      const manifest = manifestRes.value;
      if (!manifest) {
        outcomes.push({ slug: ref, status: 'failed', reason: 'manifest_empty' });
        continue;
      }

      const placeholder: SkillEntry = existing ?? ({
        slug: ref,
        owner: parsed.author,
        name: parsed.slug,
        description: '',
        version: 0,
        hash: '',
        source: 'registry',
        registryUrl: opts.registryUrl,
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as SkillEntry);

      const update = await fetchAndVerify(client, ref, placeholder, manifest, pinDir, opts.revokedDeviceKeyIds);
      if (!(await preserveLiveStoreEdit(ref, existing, update.recomputed))) {
        await writeBundleToSkillStore(ref, update.version.bundle);
      }

      const skillMd = update.version.bundle.get('SKILL.md');
      let name = parsed.slug;
      let description = '';
      if (skillMd) {
        try {
          const fm = matter(Buffer.from(skillMd).toString('utf8'));
          const d = fm.data as Record<string, unknown>;
          if (typeof d.name === 'string' && d.name) name = d.name;
          if (typeof d.description === 'string') description = d.description;
        } catch { /* ignore frontmatter parse errors */ }
      }

      const now = new Date().toISOString();
      const entry: SkillEntry = {
        ...placeholder,
        owner: parsed.author,
        name,
        description,
        version: update.versionInt,
        // Display-only semver label for the fetched version. The sync item's
        // label is only trusted when it names the version we actually fetched
        // (the manifest may have moved past it). `undefined` (older server)
        // overwrites any stale label carried over from the placeholder and
        // drops out of the persisted JSON.
        versionLabel:
          update.versionLabel ??
          (item.version === update.versionInt ? sanitizeVersionLabel(item.version_label) : undefined),
        hash: update.recomputed,
        source: 'registry',
        // Union-manifest refs come from the authenticated caller's own
        // kit / team kits — classify as own-kit so the own-kit global default
        // (auto-apply) applies. Preserve an existing class if one was already
        // set (e.g. a skill first added externally, later shared into a kit
        // keeps its stricter class unless explicitly re-trusted).
        sourceClass:
          existing?.sourceClass ?? (item.external_author ? 'external' : 'own-kit'),
        // Kit ref this skill was synced under, for the per-kit trust override.
        sourceKit: item.source_kit ?? existing?.sourceKit ?? null,
        // Stable kit id (identity-safe; sourceKit is display only).
        sourceKitId: item.kit_id ?? existing?.sourceKitId ?? null,
        // Web-set per-kit trust preference delivered via the manifest.
        subscriberTrust: item.subscriber_trust ?? existing?.subscriberTrust ?? null,
        // Classified category delivered via the manifest — drives cover art.
        category: item.category ?? existing?.category ?? null,
        // Context-weight metering delivered via the manifest — display only.
        tokenCount: item.token_count ?? existing?.tokenCount,
        tokenAmbient: item.token_ambient ?? existing?.tokenAmbient,
        tokenMethod: item.token_method ?? existing?.tokenMethod,
        registryUrl: opts.registryUrl,
        authorKeyId: update.authorKeyId,
        authorPubBase64: update.authorPubBase64,
        signature: update.envelope,
        ...(update.delegation ? { delegation: update.delegation } : {}),
        importedAt: existing?.importedAt ?? now,
        updatedAt: now,
      };
      // Re-verified against the current pin — the rotation flag (carried over
      // from the placeholder spread) is satisfied.
      delete entry.needsKeyReverify;
      await upsertSkill(entry);
      state.skills[ref] = entry;
      for (const { slug } of matches) {
        if (slug !== ref) delete state.skills[slug];
      }

      outcomes.push({ slug: ref, status: 'updated', newHash: update.recomputed });
    } catch (err) {
      outcomes.push(failedPullOutcome(ref, err));
    }
  }

  // Persist the union etag only after a pull with no hard failures. Caching it
  // eagerly (pre-verification) turned an all-failed pull into a permanent
  // silent no-op: every later sync 304'd and reported "unchanged" while the
  // local store never received the manifest's items.
  if (unionEtag && !outcomes.some((o) => o.status === 'failed')) {
    cache.union[unionKey] = unionEtag;
    await writeEtagCache(etagPath, cache);
  }

  return { outcomes, manifestRefs: new Set(items.map((i) => i.ref)), accountScope };
}

function entryNeedsAuthorMetadataRepair(entry: SkillEntry): boolean {
  return (
    entry.source === 'registry' &&
    entry.signature != null &&
    isSessionAttestedSignature(entry.signature) &&
    (!entry.authorKeyId || !entry.authorPubBase64)
  );
}

async function hydrateAuthorMetadataFromManifest(
  entry: SkillEntry,
  manifest: RegistryManifest,
): Promise<boolean> {
  if (!entryNeedsAuthorMetadataRepair(entry)) return false;
  const authorKeyId = manifest.author_key_id ?? entry.authorKeyId ?? null;
  const authorPubBase64 = manifest.author_public_key ?? entry.authorPubBase64 ?? null;
  if (!authorKeyId || !authorPubBase64) return false;
  entry.authorKeyId = authorKeyId;
  entry.authorPubBase64 = authorPubBase64;
  await upsertSkill(entry);
  return true;
}

/**
 * Walks every registry-sourced entry in `state` and (in interactive mode)
 * pulls newer versions into the local skill store. Mutates `state.skills`
 * in place so the caller's subsequent materialize loop sees the updates.
 *
 * Never throws — a per-entry failure (network, signature, integrity) is
 * captured as a `PullOutcome` with status='failed'. The entry on disk and
 * in memory is left in its prior state so the materialize phase still has
 * a valid bundle to work with.
 */
export async function pullRegistryUpdates(
  state: KitState,
  opts: PullOptions,
): Promise<PullOutcome[]> {
  const outcomes: PullOutcome[] = [];
  const etagPath = opts.etagCachePath ?? defaultEtagCachePath();
  const cache = await readEtagCache(etagPath);
  const pinDir = opts.pinDir ?? defaultPinDir();

  // Cache one client per registryUrl — fetch() and the Bearer token are the
  // same across slugs that share a registry, and the constructor's fetchImpl
  // binding is the expensive bit.
  const clients = new Map<string, RegistryClient>();
  const clientFor = (url: string): RegistryClient => {
    const cached = clients.get(url);
    if (cached) return cached;
    const created = new RegistryClient(buildClientOpts(url, opts));
    clients.set(url, created);
    return created;
  };

  let cacheDirty = false;

  for (const [slug, entry] of Object.entries(state.skills)) {
    if (entry.source !== 'registry') continue;
    if (entry.pinned === true) {
      outcomes.push({ slug, status: 'skipped-pinned' });
      continue;
    }
    if (!opts.interactive) {
      // PROTOCOL §6 — unattended sync does NOT pull. Existing materialize
      // logic still runs against the already-approved bytes on disk.
      outcomes.push({ slug, status: 'skipped-unattended' });
      continue;
    }
    if (!entry.registryUrl) {
      outcomes.push({
        slug,
        status: 'failed',
        reason: 'registry_missing: kit entry has no registryUrl — re-add to repair',
      });
      continue;
    }

    try {
      const client = clientFor(entry.registryUrl);
      const cachedEtag = cache.entries[slug] ?? null;
      const manifestRes = await client.getSkillManifest(slug, { etag: cachedEtag });

      if (manifestRes.etag && manifestRes.etag !== cachedEtag) {
        cache.entries[slug] = manifestRes.etag;
        cacheDirty = true;
      }

      let manifest = manifestRes.value;

      if (manifestRes.notModified) {
        if (entryNeedsAuthorMetadataRepair(entry)) {
          try {
            const fresh = await client.getSkillManifest(slug);
            if (fresh.value) {
              manifest = fresh.value;
              await hydrateAuthorMetadataFromManifest(entry, fresh.value);
            }
          } catch {
            // best-effort repair for stale session-upload metadata
          }
        }
        if (entry.needsKeyReverify !== true && (await skillStoreMatchesExpectedHash(slug, entry.hash))) {
          outcomes.push({ slug, status: 'unchanged' });
          continue;
        }
        // State unchanged on server but local store bytes drifted — fetch manifest
        // and repair below.
        if (!manifest) {
          const fresh = await client.getSkillManifest(slug);
          if (fresh.etag && fresh.etag !== cachedEtag) {
            cache.entries[slug] = fresh.etag;
            cacheDirty = true;
          }
          manifest = fresh.value ?? null;
        }
        if (!manifest) {
          outcomes.push({
            slug,
            status: 'failed',
            reason: 'manifest_empty: registry returned 304 then no body on repair fetch',
          });
          continue;
        }
      } else if (!manifest) {
        outcomes.push({
          slug,
          status: 'failed',
          reason: 'manifest_empty: registry returned a 200 without a body',
        });
        continue;
      }

      const expectedHashPrefixed = manifest.latest_hash
        ? `${CONTENT_HASH_PREFIX}${stripPrefix(manifest.latest_hash)}`
        : null;
      if (!expectedHashPrefixed) {
        outcomes.push({ slug, status: 'unchanged' });
        continue;
      }
      // Flagged after an accepted key rotation: same content hash, but the
      // stored envelope verified against the old key — take the fetch path.
      if (expectedHashPrefixed === entry.hash && entry.needsKeyReverify !== true) {
        const storeAligned = await skillStoreMatchesExpectedHash(slug, entry.hash);
        if (storeAligned) {
          const latestVersionMeta = manifest.versions.find((v) => v.hash === manifest.latest_hash);
          const label = sanitizeVersionLabel(latestVersionMeta?.version_label);
          if (label && label !== entry.versionLabel) {
            entry.versionLabel = label;
            await upsertSkill(entry);
          }
          await hydrateAuthorMetadataFromManifest(entry, manifest);
          outcomes.push({
            slug,
            status: 'unchanged',
            ...(latestVersionMeta?.yanked ? { yankedHash: expectedHashPrefixed } : {}),
          });
          continue;
        }
        // entry.hash matches manifest but store drifted — fall through to repair fetch.
      }

      if (expectedHashPrefixed !== entry.hash) {
        const storeHash = await readSkillStoreContentHash(slug);
        if (
          storeHash &&
          storeHash === entry.hash &&
          (await legacyPollutedManifestMatches(client, slug, expectedHashPrefixed, storeHash))
        ) {
          const latestVersionMeta = manifest.versions.find((v) => v.hash === manifest.latest_hash);
          await hydrateAuthorMetadataFromManifest(entry, manifest);
          outcomes.push({
            slug,
            status: 'unchanged',
            ...(latestVersionMeta?.yanked ? { yankedHash: expectedHashPrefixed } : {}),
          });
          continue;
        }
      }

      const latestIdx = manifest.versions.findIndex(
        (v) => v.hash === manifest.latest_hash,
      );
      if (latestIdx < 0) {
        outcomes.push({
          slug,
          status: 'failed',
          reason: `manifest latest_hash ${manifest.latest_hash} not in versions list`,
        });
        continue;
      }

      const latestVersion = manifest.versions[latestIdx];
      if (latestVersion?.yanked) {
        outcomes.push({
          slug,
          status: 'skipped-yanked',
          reason: `latest ${manifest.latest_hash} is yanked — keeping pinned bytes`,
          yankedHash: expectedHashPrefixed,
        });
        continue;
      }

      // Per-registry revocation: check this entry against the revocation set of
      // the registry that served it, not a single default-registry set.
      const revoked = opts.getRevokedKeys
        ? await opts.getRevokedKeys(entry.registryUrl)
        : opts.revokedDeviceKeyIds;
      const update = await fetchAndVerify(client, slug, entry, manifest, pinDir, revoked);
      if (entry.version != null && entry.version > 0 && update.versionInt < entry.version) {
        outcomes.push({
          slug,
          status: 'failed',
          reason: `rollback_detected: manifest version ${update.versionInt} is older than local ${entry.version}`,
        });
        continue;
      }
      // Write bundle to the local skill store, then mutate the kit entry so
      // the existing materialize loop sees the new hash + signature on this
      // same sync run. A live local store edit is preserved (KTD4): skip the
      // clobber, still advance the hash so sync holds the update.
      if (!(await preserveLiveStoreEdit(slug, entry, update.recomputed))) {
        await writeBundleToSkillStore(slug, update.version.bundle);
      }
      entry.hash = update.recomputed;
      entry.version = update.versionInt;
      // Keep the display label in step with the integer: set when the server
      // provided one, clear a stale one when it did not (older server).
      if (update.versionLabel) entry.versionLabel = update.versionLabel;
      else delete entry.versionLabel;
      entry.signature = update.envelope;
      entry.authorKeyId = update.authorKeyId;
      entry.authorPubBase64 = update.authorPubBase64;
      // Keep `delegation` consistent with `signature`: set it for a device-signed
      // version, clear any stale one when the signer reverts to the primary key.
      if (update.delegation) entry.delegation = update.delegation;
      else delete entry.delegation;
      // Successful re-verify against the current pin satisfies any pending
      // rotation flag.
      delete entry.needsKeyReverify;
      entry.updatedAt = new Date().toISOString();
      // Persist the mutation so a crash mid-sync doesn't leave the on-disk
      // bundle (v2) and the kit state (v1) out of sync — the materialize
      // loop's `if (currentHash !== entry.hash) upsertSkill` would skip the
      // write since we just made them match in memory.
      await upsertSkill(entry);

      outcomes.push({ slug, status: 'updated', newHash: update.recomputed });
    } catch (err) {
      // A 404 means the skill was deleted from the registry (e.g. unpublished,
      // or a DB reset). Don't fail the whole sync over a gone skill — mark it
      // 'gone' and leave it in state so the reconcile-prune phase (which removes
      // state entries absent from the union manifest) moves its materialized
      // copies to trash. Degrade gracefully instead of wedging the tray.
      if (err instanceof RegistryError && err.status === 404) {
        outcomes.push({ slug, status: 'gone' });
      } else {
        // Never let one bad entry abort the whole sync.
        outcomes.push(failedPullOutcome(slug, err));
      }
    }
  }

  if (cacheDirty) {
    try {
      await writeEtagCache(etagPath, cache);
    } catch {
      // Cache persistence failures are non-fatal — next run just re-fetches.
    }
  }

  return outcomes;
}

interface FetchAndVerifyResult {
  version: VersionDetail;
  recomputed: string;
  envelope: NonNullable<VersionDetail['signature']>;
  versionInt: number;
  /** Display-only semver label served for this version; null on older servers. */
  versionLabel: string | null;
  authorKeyId: string;
  authorPubBase64: string;
  /** Present iff the version was signed by a delegated device key. */
  delegation: SignedDelegation | null;
}

async function fetchAndVerify(
  client: RegistryClient,
  slug: string,
  entry: SkillEntry,
  manifest: RegistryManifest,
  pinDir: string,
  revokedDeviceKeyIds?: Set<string>,
): Promise<FetchAndVerifyResult> {
  if (!manifest.latest_hash) {
    throw new RegistryError('no_versions', `${slug} has no published versions`);
  }
  const latestIdx = manifest.versions.findIndex(
    (v) => v.hash === manifest.latest_hash,
  );
  if (latestIdx < 0) {
    throw new RegistryError(
      'malformed_response',
      `Manifest for ${slug} latest_hash not in versions list`,
    );
  }
  const versionInt = manifest.versions.length - latestIdx;
  const manifestVersion = manifest.versions[latestIdx];

  const version = await client.getVersion(slug, manifest.latest_hash);
  const envelope = version.signature ?? manifestVersion.signature ?? null;
  if (!envelope) {
    throw new RegistryError(
      'unsigned_version',
      `Version ${manifest.latest_hash} for ${slug} has no signature`,
    );
  }
  const authorKeyId =
    version.author_key_id ?? manifest.author_key_id ?? entry.authorKeyId ?? null;
  const authorPubBase64 =
    version.author_public_key ?? manifest.author_public_key ?? entry.authorPubBase64 ?? null;
  if (!authorKeyId || !authorPubBase64) {
    throw new RegistryError(
      'author_not_claimed',
      `${slug}: cannot verify ${manifest.latest_hash} — registry returned no author identity`,
    );
  }

  const recomputed = skillContentHash(version.bundle);
  const legacyPollutedHash = canonicalContentHash(version.bundle);
  const stampedHash =
    legacyPollutedHash === version.content_hash ? legacyPollutedHash : recomputed;
  if (recomputed !== version.content_hash && legacyPollutedHash !== version.content_hash) {
    throw new SignatureError(
      'signature_invalid',
      `${slug} bundle hashed to ${recomputed}, server stamped ${version.content_hash}`,
    );
  }
  if (
    recomputed !== `${CONTENT_HASH_PREFIX}${stripPrefix(manifest.latest_hash)}` &&
    legacyPollutedHash !== `${CONTENT_HASH_PREFIX}${stripPrefix(manifest.latest_hash)}`
  ) {
    throw new SignatureError(
      'signature_invalid',
      `${slug} bundle hash ${recomputed} does not match manifest latest_hash ${manifest.latest_hash}`,
    );
  }

  const author = handleFromSlug(slug);
  // Bind the served (key_id, pub) BEFORE pinning: key_id MUST equal hex(pub).
  // A hostile registry could otherwise pin a victim's key_id against an
  // attacker-held pub and serve attacker-signed content past the TOFU check.
  assertKeyIdBindsPub(authorKeyId, authorPubBase64);
  // TOFU-resolve the author's PRIMARY key. This pins (first-sight) or loads the
  // primary key the whole trust chain roots in — for both the direct and the
  // delegated paths. `pinned` is the locally-pinned material, NOT the
  // registry-served key (design §9.4): a device cert is verified against this.
  const { keyObject, pinnedPrimary, needsPinAfterVerify } = await authorKeyForVerification(
    author,
    { key_id: authorKeyId, pub: authorPubBase64 },
    pinDir,
  );

  let delegation: SignedDelegation | null = null;
  if (isSessionAttestedSignature(envelope)) {
    // Registry attested this version at publish time via verified session.
    // Content-hash checks above are the integrity gate on pull.
  } else if (envelope.key_id === authorKeyId) {
    if (!isEd25519Signature(envelope)) {
      throw new SignatureError(
        'signature_invalid',
        `unsupported alg ${JSON.stringify((envelope as Signature).alg)} for direct author signature`,
      );
    }
    verifyEnvelope(stampedHash, envelope, keyObject, {
      expectedKeyId: authorKeyId,
      binding: isBundleSignatureV2(envelope)
        ? envelopeBindingFromSlug(slug, versionInt, authorKeyId)
        : undefined,
    });
  } else {
    if (!isEd25519Signature(envelope)) {
      throw new SignatureError(
        'signature_invalid',
        `unsupported alg ${JSON.stringify((envelope as Signature).alg)} for delegated signature`,
      );
    }
    // ── Delegated path: the version is signed by a DEVICE key. Verify
    // device_sig ← cert ← the PINNED primary, fail-closed, honoring revocations.
    // Minted versions are owner-signed, so the required action scope is 'approve'.
    verifyDelegatedVersionSignature({
      contentHash: stampedHash,
      versionSignature: envelope,
      signedDelegation: version.delegation,
      pinnedPrimary: { keyId: pinnedPrimary.keyId, pub: pinnedPrimary.pub },
      handle: author,
      requiredScope: 'approve',
      publishedAt: version.published_at,
      revokedDeviceKeyIds: revokedDeviceKeyIds,
    });
    delegation = version.delegation;
  }
  if (needsPinAfterVerify) {
    await commitAuthorKeyPin(
      author,
      { key_id: authorKeyId, pub: authorPubBase64 },
      versionInt,
      pinDir,
    );
  }
  // Touch signatureBytes so the contract that we sign the prefixed-hash
  // STRING (not raw digest) stays load-bearing inside this module. verifyEnvelope
  // already encodes via signatureBytes internally; calling it here is purely
  // defensive against a future refactor that bypasses the wrapper.
  signatureBytes(stampedHash);

  return {
    version,
    recomputed,
    envelope,
    versionInt,
    versionLabel:
      sanitizeVersionLabel(version.version_label) ??
      sanitizeVersionLabel(manifestVersion.version_label) ??
      null,
    authorKeyId,
    authorPubBase64,
    delegation,
  };
}

function buildClientOpts(baseUrl: string, opts: PullOptions): RegistryClientOptions {
  return { baseUrl, token: opts.token, fetchImpl: opts.fetchImpl };
}

function stripPrefix(s: string): string {
  return s.startsWith(CONTENT_HASH_PREFIX) ? s.slice(CONTENT_HASH_PREFIX.length) : s;
}

/** True when manifest hash includes legacy `.skillet-backup` paths but store bytes match skill content. */
async function legacyPollutedManifestMatches(
  client: RegistryClient,
  slug: string,
  manifestHash: string,
  storeSkillHash: string,
): Promise<boolean> {
  try {
    const version = await client.getVersion(slug, stripPrefix(manifestHash));
    const full = canonicalContentHash(version.bundle);
    const stripped = skillContentHash(version.bundle);
    return full === manifestHash && stripped === storeSkillHash;
  } catch {
    return false;
  }
}

function handleFromSlug(slug: string): string {
  const m = slug.match(/^@?([a-z0-9-]+)\//);
  if (!m) {
    throw new RegistryError(
      'invalid_slug',
      `Cannot derive author handle from slug ${JSON.stringify(slug)}`,
    );
  }
  return m[1];
}
