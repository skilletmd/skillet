/**
 * `skillet add @author/skill` — fetch a registry skill into the kit.
 *
 * Flow (PROTOCOL §4 + §6.1):
 *   1. Parse `@author/slug` strictly — anything that wouldn't pass the
 *      server's grammar is rejected before any HTTP request.
 *   2. GET /api/v1/skills/:author/:slug/manifest → latest_hash, the matching
 *      version's signature envelope, author_key_id, author_public_key.
 *   3. GET /api/v1/skills/:author/:slug/versions/:hash → the bundle.
 *   4. Recompute canonicalContentHash(bundle) — MUST equal the server-stamped
 *      content_hash. A mismatch means the bundle on the wire isn't the bundle
 *      that was signed (acceptance criterion 1, integrity gate).
 *   5. TOFU-resolve the author key via resolveAuthorKey, then verify the
 *      envelope against signatureBytes(content_hash). Fail-closed on
 *      key_id_mismatch, signature_invalid, or a missing pubkey.
 *   6. Write the decoded bundle to the local skill store and persist the kit
 *      entry — source=registry, private-by-default, with the signature,
 *      pubkey, key_id, version index, and the original registry URL.
 *
 * Re-running `skillet add` on an already-imported ref is idempotent: same
 * content_hash → no-op; new content_hash → fetches the newer version, which
 * the materialize-time graded diff will still gate before writing into any
 * runtime directory.
 */

import matter from 'gray-matter';
import {
  CONTENT_HASH_PREFIX,
  canonicalContentHash,
  isBundleSignatureV2,
  type DecodedBundle,
} from '@skillet/protocol';
import {
  RegistryClient,
  RegistryError,
  parseSkillRef,
  type RegistryClientOptions,
} from '../registry/index.js';
import {
  verifyEnvelope,
  envelopeBindingFromSlug,
  SignatureError,
} from '../signing/envelope.js';
import { isEd25519Signature, isSessionAttestedSignature } from '../signing/session-attest.js';
import { resolveAuthorKey, defaultPinDir } from '../signing/pin.js';
import {
  writeBundleToSkillStore,
  upsertSkill,
  readState,
} from '../kit/store.js';
import { recordEvent, detectInitiator } from '../metrics.js';
import type { SkillEntry } from '../kit/types.js';

export interface AddOptions {
  /** Registry base URL (e.g. `https://registry.skillet.md`). */
  registryUrl: string;
  /** Bearer token if available. */
  token?: string;
  /** Inject an alternate fetch impl for tests. */
  fetchImpl?: typeof fetch;
  /** TOFU pin directory; defaults to `$XDG_CONFIG_HOME/skillet/pinned`. */
  pinDir?: string;
  /** When true, mark the entry as locally pinned (registry-pull won't touch it). */
  pin?: boolean;
}

export interface AddResult {
  entry: SkillEntry;
  /** True when this was the first sighting of the author's key. */
  newlyPinned: boolean;
  /** True when nothing changed (same ref, same hash already in kit). */
  noop: boolean;
}

/**
 * Resolve, verify, and persist a registry-served skill into the local kit.
 * Throws RegistryError or SignatureError on every fail-closed path; the CLI
 * surfaces the `.code` on stderr and exits non-zero.
 */
export async function add(ref: string, opts: AddOptions): Promise<AddResult> {
  const parsed = parseSkillRef(ref);
  // parseSkillRef already enforced /^[a-z0-9-]+$/ on both author and slug —
  // no `..`, no path separators, no shell metacharacters — so the canonical
  // ref is safe to use as the kit key AND as the relative path inside the
  // local skill store (`~/.skillet/skills/@author/slug/`).

  const client = new RegistryClient(buildClientOptions(opts));

  // ------------------------------------------------------------------------
  // 1. Manifest → pick latest_hash + its version envelope + author identity.
  // ------------------------------------------------------------------------
  const manifestRes = await client.getSkillManifest(parsed.canonical);
  const manifest = manifestRes.value;
  if (!manifest) {
    // `notModified` is meaningless on a first `add` — we passed no ETag.
    throw new RegistryError(
      'malformed_response',
      `Manifest for ${parsed.canonical} returned 304 unexpectedly`,
    );
  }
  if (!manifest.latest_hash || manifest.versions.length === 0) {
    throw new RegistryError(
      'no_versions',
      `${parsed.canonical} has no published versions yet`,
    );
  }
  if (!manifest.author_key_id || !manifest.author_public_key) {
    throw new RegistryError(
      'author_not_claimed',
      `Author "@${parsed.author}" has not registered a signing key — refusing to TOFU-pin a missing identity`,
    );
  }

  // Versions come back DESC by published_at; index 0 is the newest. Position
  // counted from the oldest is the monotonic `version` integer the protocol
  // talks about (PROTOCOL §2.3 placeholder; matches the server's sync route).
  const latestIdx = manifest.versions.findIndex(
    (v) => v.hash === manifest.latest_hash,
  );
  if (latestIdx < 0) {
    throw new RegistryError(
      'malformed_response',
      `Manifest latest_hash ${manifest.latest_hash} not present in versions list for ${parsed.canonical}`,
    );
  }
  const versionInt = manifest.versions.length - latestIdx;
  const manifestVersion = manifest.versions[latestIdx];
  if (manifestVersion.yanked) {
    throw new RegistryError(
      'version_yanked',
      `${parsed.canonical}@${manifest.latest_hash} is yanked — refusing new install`,
    );
  }
  if (!manifestVersion.signature) {
    throw new RegistryError(
      'unsigned_version',
      `${parsed.canonical}@${manifest.latest_hash} is unsigned — registry-served versions must carry an Ed25519 envelope (PROTOCOL §4)`,
    );
  }

  // ------------------------------------------------------------------------
  // 2. Skip the round trip if this exact hash is already in the kit.
  // ------------------------------------------------------------------------
  const state = await readState();
  const expectedHashPrefixed = `${CONTENT_HASH_PREFIX}${stripPrefix(manifest.latest_hash)}`;
  const existing = state.skills[parsed.canonical];
  if (existing && existing.source === 'registry' && existing.hash === expectedHashPrefixed) {
    // Honour `--pin` even when re-running on an already-imported ref so the
    // user can flip the pinned bit without re-downloading.
    if (opts.pin && !existing.pinned) {
      const updated: SkillEntry = { ...existing, pinned: true, updatedAt: new Date().toISOString() };
      await upsertSkill(updated);
      pingInstallMetric(client, parsed.canonical);
      return { entry: updated, newlyPinned: false, noop: false };
    }
    pingInstallMetric(client, parsed.canonical);
    return { entry: existing, newlyPinned: false, noop: true };
  }

  // ------------------------------------------------------------------------
  // 3. Fetch the actual bundle.
  // ------------------------------------------------------------------------
  const version = await client.getVersion(parsed.canonical, manifest.latest_hash);

  // The version endpoint can shadow the manifest signature (e.g. on a rotation
  // mid-publish). Use whichever is present, preferring the version-detail
  // one since that's the canonical pairing with the bytes we just received.
  const envelope = version.signature ?? manifestVersion.signature;
  if (!envelope) {
    throw new RegistryError(
      'unsigned_version',
      `Version ${manifest.latest_hash} for ${parsed.canonical} has no signature on either manifest or detail endpoint`,
    );
  }
  // Author identity: prefer the version-detail body (locks identity to the
  // exact published version), fall back to the manifest top-level fields.
  const authorKeyId = version.author_key_id ?? manifest.author_key_id;
  const authorPubBase64 = version.author_public_key ?? manifest.author_public_key;
  if (!authorKeyId || !authorPubBase64) {
    throw new RegistryError(
      'author_not_claimed',
      `Author "@${parsed.author}" identity is incomplete — cannot verify ${manifest.latest_hash}`,
    );
  }
  if (!isSessionAttestedSignature(envelope)) {
    if (envelope.key_id !== authorKeyId) {
      // Loud — a signature signed by a different key than the claimed identity.
      throw new SignatureError(
        'key_id_mismatch',
        `Version ${manifest.latest_hash} signature key_id ${envelope.key_id} disagrees with author_key_id ${authorKeyId}`,
      );
    }
  }
  // Bind author_key_id to author_pub: key_id MUST equal hex(raw pubkey bytes).
  // Without this check a MITM can claim any pinned key_id while serving an
  // attacker pub, sign with the attacker priv, and pass both the envelope check
  // and the TOFU string comparison — the pinned key provides zero protection.
  const derivedKeyId = Buffer.from(authorPubBase64, 'base64').toString('hex');
  if (derivedKeyId !== authorKeyId) {
    throw new SignatureError(
      'signature_invalid',
      `author_key_id ${authorKeyId} does not match author_pub (derived key_id ${derivedKeyId})`,
    );
  }

  // ------------------------------------------------------------------------
  // 4. Integrity gate: recompute the canonical hash before trusting bytes.
  // ------------------------------------------------------------------------
  const recomputed = canonicalContentHash(version.bundle);
  if (recomputed !== version.content_hash) {
    throw new SignatureError(
      'signature_invalid',
      `Bundle for ${parsed.canonical}@${manifest.latest_hash} hashed to ${recomputed}, server stamped ${version.content_hash}`,
    );
  }
  if (recomputed !== expectedHashPrefixed) {
    throw new SignatureError(
      'signature_invalid',
      `Bundle hash ${recomputed} does not match manifest latest_hash ${expectedHashPrefixed}`,
    );
  }

  // ------------------------------------------------------------------------
  // 5. TOFU + envelope verification.
  // ------------------------------------------------------------------------
  const pinDir = opts.pinDir ?? defaultPinDir();
  let newlyPinned = false;
  if (isSessionAttestedSignature(envelope)) {
    // Registry attested via verified session at publish time.
  } else {
    if (!isEd25519Signature(envelope)) {
      throw new SignatureError(
        'signature_invalid',
        `unsupported signature alg ${JSON.stringify((envelope as { alg: string }).alg)}`,
      );
    }
    const resolved = await resolveAuthorKey(
      parsed.author,
      { key_id: authorKeyId, pub: authorPubBase64 },
      versionInt,
      pinDir,
    );
    newlyPinned = resolved.newlyPinned;
    // A v2 envelope signs a struct binding key + ref + version + content_hash,
    // so verification needs that same context or it throws "v2 envelope requires
    // binding context" and no v2-signed skill can ever be added. The sync path
    // (registry/pull.ts) already passes it; this call site did not, so `skillet
    // sync` accepted v2 versions that `skillet add` rejected.
    verifyEnvelope(recomputed, envelope, resolved.keyObject, {
      expectedKeyId: authorKeyId,
      binding: isBundleSignatureV2(envelope)
        ? envelopeBindingFromSlug(parsed.canonical, versionInt, authorKeyId)
        : undefined,
    });
  }

  // ------------------------------------------------------------------------
  // 6. Persist the bundle + kit entry.
  // ------------------------------------------------------------------------
  await writeBundleToSkillStore(parsed.canonical, version.bundle);

  // Save into the account's "Saved" kit so the skill is a first-class kit
  // member: it syncs across the user's devices, flows through the /updates
  // consent queue, and is edit-capturable — not a second-class bare install.
  // Best-effort: a handle-less account (403 → null) or a network hiccup falls
  // back to the local-only entry, matching the prior install behavior. Preserve
  // an existing sourceKit so a re-add never downgrades a kit-subscribed skill.
  let savedKitRef = existing?.sourceKit ?? null;
  let savedKitId = existing?.sourceKitId ?? null;
  try {
    const saved = await client.saveToLibrary(parsed.canonical);
    if (saved) {
      savedKitRef = saved.kit_ref;
      savedKitId = saved.kit_id;
    }
  } catch {
    // Keep the local entry; the next sync reconciles Saved-kit membership.
  }

  const { name, description } = extractMetadata(version.bundle, parsed.slug);
  const now = new Date().toISOString();
  const entry: SkillEntry = {
    slug: parsed.canonical,
    owner: parsed.author,
    name,
    description,
    version: versionInt,
    hash: recomputed,
    source: 'registry',
    // An explicit `skillet add @them/skill` pulls a stranger's skill —
    // classify as external so the external global default (diff-gate) applies.
    // Preserve an existing class so a re-add doesn't silently downgrade trust.
    sourceClass: existing?.sourceClass ?? 'external',
    ...(savedKitRef ? { sourceKit: savedKitRef } : {}),
    ...(savedKitId ? { sourceKitId: savedKitId } : {}),
    registryUrl: client.url,
    authorKeyId,
    authorPubBase64,
    signature: envelope,
    importedAt: existing?.importedAt ?? now,
    updatedAt: now,
    ...(opts.pin ? { pinned: true } : {}),
  };
  await upsertSkill(entry);

  pingInstallMetric(client, parsed.canonical);

  // Metric: human-initiated `add` event (PROTOCOL §10 — daemon/CI excluded).
  recordEvent('skill.add', detectInitiator(), {
    slug: parsed.canonical,
    newlyPinned,
    pinned: entry.pinned === true,
  });

  return { entry, newlyPinned, noop: false };
}

import { pingInstallMetric } from "../registry/install-metric.js";

function buildClientOptions(opts: AddOptions): RegistryClientOptions {
  return {
    baseUrl: opts.registryUrl,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  };
}

function stripPrefix(s: string): string {
  return s.startsWith(CONTENT_HASH_PREFIX) ? s.slice(CONTENT_HASH_PREFIX.length) : s;
}

/**
 * Pull the SKILL.md frontmatter out of the decoded bundle so the kit entry
 * carries the human name/description without reading from disk again. The
 * bundle has already passed validateBundle (SKILL.md present at root), so
 * the get below is safe; fall back to the slug for skills without frontmatter.
 */
function extractMetadata(
  bundle: DecodedBundle,
  fallbackName: string,
): { name: string; description: string } {
  const entrypoint = bundle.get('SKILL.md');
  if (!entrypoint) return { name: fallbackName, description: '' };
  try {
    const parsed = matter(Buffer.from(entrypoint).toString('utf8'));
    const fm = parsed.data as Record<string, unknown>;
    const name = typeof fm.name === 'string' && fm.name.length > 0 ? fm.name : fallbackName;
    const description = typeof fm.description === 'string' ? fm.description : '';
    return { name, description };
  } catch {
    return { name: fallbackName, description: '' };
  }
}
