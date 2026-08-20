/**
 * skillet.lock — committed, reproducible, CI-verifiable skill manifest.
 *
 * PROTOCOL §11 shape (TOML):
 *
 *   registry      = "https://registry.skillet.md"   # REQUIRED — pins the resolver
 *   generated_at  = "2026-06-13T17:42:00.000Z"
 *
 *   [[skill]]
 *   ref          = "@taylor/festival-ops"
 *   version      = 7
 *   content_hash = "sha256:..."
 *   author_key   = "<64-hex>"                    # pins the TOFU hole shut on fresh clones
 *   source       = "registry"
 *   registry_url = "https://..."                 # optional, when different from top-level
 *   signature    = { alg = "ed25519", key_id = "...", sig = "..." }
 *
 * Why the lockfile shape carries `author_key` AND `signature`:
 *   - `author_key` is what CI verifies a fresh fetch against (closes TOFU
 *     for clones — see acceptance criterion 5).
 *   - `signature` is the envelope produced at publish time and the proof
 *     CI checks against the pinned `author_key`. Without it, a fresh fetch
 *     could swap in a malicious version that still hashes correctly under
 *     a different — but registry-served — author key.
 *
 * Why we switched from JSON to TOML:
 *   - PROTOCOL §11 normative shape.
 *   - Human-diffable; reviewers can audit a skill bump in code review.
 *   - The schema is fixed and tiny, so `util/toml-lock.ts` covers it without
 *     a third-party dep.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite } from "./util/atomic.js";
import { hashRef, sha256 } from "./util/hash.js";
import {
  decodeLockToml,
  encodeLockToml,
  type TomlArrayOfTablesDoc,
  type TomlInlineTable,
} from "./util/toml-lock.js";
import { verifyEnvelope, type Signature } from "./signing/envelope.js";
import { isEd25519Signature, isSessionAttestedSignature } from "./signing/session-attest.js";
import { publicKeyFromBase64 } from "./signing/pin.js";
import { verifyDelegationCert } from "./signing/delegation.js";
import { validateDelegationCert, type SignedDelegation, ARTIFACT_SCHEMA_VERSION, resolveArtifactSchemaVersion } from "@skillet/protocol";
import type { KitState } from "./kit/types.js";
import { REGISTRY_URL_DEFAULT } from "./kit/types.js";

export interface LockEntry {
  ref: string;
  version: number;
  /**
   * Semver display label ("X.Y.Z") for `version`. Display only — CI and sync
   * verify against `version`/`content_hash`, never this. Absent for local-only
   * skills and entries written before the registry served labels.
   */
  version_label?: string;
  /** sha256-prefixed canonical content hash (PROTOCOL §2.2) */
  content_hash: string;
  /** 64-hex Ed25519 public key ID — REQUIRED for registry skills, omitted for local-only */
  author_key?: string;
  source: "local" | "registry";
  registry_url?: string;
  signature?: Signature;
  /**
   * When `signature` was produced by a delegated DEVICE key (its
   * key_id is not `author_key`), the inline SignedDelegation that chains the
   * device key to the pinned PRIMARY author key. Lets a fresh clone / CI verify
   * device_sig ← cert ← pinned primary fully offline. Stored as a JSON string
   * (`delegation_json`) in the TOML so the nested cert needs no inline-table
   * gymnastics; the signed bytes are recomputed from the parsed cert.
   */
  delegation?: SignedDelegation;
}

export interface LockFile {
  /** Wire-format version for skillet.lock. */
  schema_version: number;
  /** REQUIRED — pins the resolver explicitly so the lockfile is self-contained. */
  registry: string;
  generated_at: string;
  skills: LockEntry[];
}

const LOCK_FILENAME = "skillet.lock";

// ── encode ───────────────────────────────────────────────────────────────────

function encodeEntry(entry: LockEntry): Record<string, string | number | TomlInlineTable> {
  const out: Record<string, string | number | TomlInlineTable> = {
    ref: entry.ref,
    version: entry.version,
    content_hash: entry.content_hash,
  };
  if (entry.version_label) out.version_label = entry.version_label;
  if (entry.author_key) out.author_key = entry.author_key;
  out.source = entry.source;
  if (entry.registry_url) out.registry_url = entry.registry_url;
  if (entry.signature) {
    out.signature = {
      alg: entry.signature.alg,
      key_id: entry.signature.key_id,
      sig: entry.signature.sig,
    };
  }
  if (entry.delegation) {
    // base64 of the SignedDelegation JSON. The minimal TOML encoder rejects
    // basic strings containing quotes/backslashes (which a JSON blob is full
    // of), so we store the chain as a quote-free base64 field. The signed bytes
    // are recomputed from the parsed cert at verify time, so the wrapper's
    // exact byte form is not security-sensitive.
    out.delegation_b64 = Buffer.from(JSON.stringify(entry.delegation), "utf8").toString("base64");
  }
  return out;
}

export function encodeLockFile(lock: LockFile): string {
  const doc: TomlArrayOfTablesDoc = {
    top: {
      schema_version: lock.schema_version,
      registry: lock.registry,
      generated_at: lock.generated_at,
    },
    tables: {
      skill: lock.skills.map(encodeEntry),
    },
  };
  return encodeLockToml(doc);
}

// ── write ────────────────────────────────────────────────────────────────────

/**
 * Builds a LockFile from current KitState. Each registry-sourced skill MUST
 * supply `content_hash`, `author_key`, and (if present) `signature` for CI
 * verifiability — local-only skills carry just the hash.
 */
export function buildLockFile(
  state: KitState,
  opts: {
    registry?: string;
    /** Per-slug overrides for signature / author_key as they arrive from
     *  the registry response or manifest. KitState today doesn't carry
     *  signatures; this is the seam registry-side work plugs into. */
    overrides?: Record<
      string,
      Partial<Pick<LockEntry, "content_hash" | "author_key" | "signature" | "registry_url" | "delegation">>
    >;
    now?: () => Date;
  } = {}
): LockFile {
  const registry = opts.registry ?? REGISTRY_URL_DEFAULT;
  const now = opts.now ?? (() => new Date());

  const skills: LockEntry[] = [];
  for (const [slug, entry] of Object.entries(state.skills)) {
    const override = opts.overrides?.[slug] ?? {};
    const baseHash = override.content_hash ?? hashRef(entry.hash);
    const base: LockEntry = {
      ref: slug,
      version: entry.version,
      content_hash: baseHash,
      source: entry.source,
    };
    if (entry.versionLabel) base.version_label = entry.versionLabel;
    if (entry.authorKeyId || override.author_key) {
      base.author_key = override.author_key ?? entry.authorKeyId;
    }
    if (entry.registryUrl || override.registry_url) {
      base.registry_url = override.registry_url ?? entry.registryUrl;
    }
    if (override.signature) base.signature = override.signature;
    // Carry the inline delegation for device-signed versions so a fresh clone
    // can verify the chain offline (override seam, mirrors `signature`).
    const delegation = override.delegation ?? entry.delegation;
    if (delegation) base.delegation = delegation;
    skills.push(base);
  }

  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    registry,
    generated_at: now().toISOString(),
    skills,
  };
}

export async function writeLockFile(
  cwd: string,
  state: KitState,
  registryUrl: string = REGISTRY_URL_DEFAULT,
  overrides?: Record<
    string,
    Partial<Pick<LockEntry, "content_hash" | "author_key" | "signature" | "registry_url">>
  >
): Promise<string> {
  const lockPath = join(cwd, LOCK_FILENAME);
  const lock = buildLockFile(state, { registry: registryUrl, overrides });
  await atomicWrite(lockPath, encodeLockFile(lock), { backup: false });
  return lockPath;
}

// ── decode ───────────────────────────────────────────────────────────────────

function decodeEntry(raw: Record<string, unknown>, idx: number): LockEntry {
  const need = (k: string): unknown => {
    if (!(k in raw)) {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} missing required key ${k}`);
    }
    return raw[k];
  };
  const ref = need("ref");
  const version = need("version");
  const content_hash = need("content_hash");
  const source = need("source");

  if (typeof ref !== "string") throw new Error(`skillet.lock: [[skill]] #${idx + 1} ref must be string`);
  if (typeof version !== "number") throw new Error(`skillet.lock: [[skill]] #${idx + 1} version must be integer`);
  if (typeof content_hash !== "string") throw new Error(`skillet.lock: [[skill]] #${idx + 1} content_hash must be string`);
  if (source !== "local" && source !== "registry") {
    throw new Error(`skillet.lock: [[skill]] #${idx + 1} source must be "local" or "registry", got ${JSON.stringify(source)}`);
  }

  const entry: LockEntry = { ref, version, content_hash, source };

  if (raw.version_label !== undefined) {
    if (typeof raw.version_label !== "string") {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} version_label must be string`);
    }
    entry.version_label = raw.version_label;
  }
  if (raw.author_key !== undefined) {
    if (typeof raw.author_key !== "string") {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} author_key must be string`);
    }
    entry.author_key = raw.author_key;
  }
  if (raw.registry_url !== undefined) {
    if (typeof raw.registry_url !== "string") {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} registry_url must be string`);
    }
    entry.registry_url = raw.registry_url;
  }
  if (raw.signature !== undefined) {
    const s = raw.signature as Record<string, unknown>;
    if (!s || typeof s !== "object" || s.alg !== "ed25519" || typeof s.key_id !== "string" || typeof s.sig !== "string") {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} signature has invalid shape`);
    }
    entry.signature = { alg: "ed25519", key_id: s.key_id, sig: s.sig };
  }
  if (raw.delegation_b64 !== undefined) {
    if (typeof raw.delegation_b64 !== "string") {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} delegation_b64 must be a base64 string`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw.delegation_b64, "base64").toString("utf8"));
    } catch {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} delegation_b64 is not valid base64 JSON`);
    }
    const d = parsed as Record<string, unknown>;
    if (!d || typeof d !== "object" || !d.cert || !d.cert_sig) {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} delegation_json missing cert/cert_sig`);
    }
    const shape = validateDelegationCert(d.cert);
    if (!("ok" in shape)) {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} delegation cert invalid: ${shape.message}`);
    }
    const cs = d.cert_sig as Record<string, unknown>;
    if (cs.alg !== "ed25519" || typeof cs.key_id !== "string" || typeof cs.sig !== "string") {
      throw new Error(`skillet.lock: [[skill]] #${idx + 1} delegation cert_sig has invalid shape`);
    }
    entry.delegation = {
      cert: shape.cert,
      cert_sig: { alg: "ed25519", key_id: cs.key_id, sig: cs.sig },
    };
  }

  return entry;
}

export function decodeLockFile(input: string): LockFile {
  const doc = decodeLockToml(input);
  const schema_version = resolveArtifactSchemaVersion(
    doc.top.schema_version,
    'skillet.lock',
  );
  const registry = doc.top.registry;
  if (typeof registry !== "string" || registry === "") {
    throw new Error("skillet.lock: top-level `registry` is required (PROTOCOL §11)");
  }
  const generated_at = doc.top.generated_at;
  if (typeof generated_at !== "string") {
    throw new Error("skillet.lock: top-level `generated_at` must be a string");
  }
  const skillTables = doc.tables.skill ?? [];
  const skills = skillTables.map((t, i) =>
    decodeEntry(t as Record<string, unknown>, i)
  );
  return { schema_version, registry, generated_at, skills };
}

export async function readLockFile(cwd: string): Promise<LockFile> {
  const lockPath = join(cwd, LOCK_FILENAME);
  const raw = await readFile(lockPath, "utf8");
  return decodeLockFile(raw);
}

// ── verify (CI-side; acceptance criterion 5) ────────────────────────────────

export interface LockVerificationFinding {
  ref: string;
  ok: boolean;
  reason?: string;
}

/**
 * Verifies a candidate bundle for a single locked skill.
 *
 * Semantics (CI / `skillet sync` against a lockfile):
 *   - Recompute the canonical content hash from `bundleBytes` and compare to
 *     the lockfile's pinned `content_hash`. Mismatch → `integrity_failed`.
 *   - Verify the lockfile's `signature` envelope against the pinned
 *     `author_key` (NOT against whatever the registry happens to serve right
 *     now). This is what closes the TOFU hole for fresh clones — a poisoned
 *     first fetch fails here, not silently pins a new key.
 *
 * `bundleHasher` lets callers plug in the canonical bundle hash without a
 * breaking change. Default is the v0 single-string hash so existing call
 * sites keep working until that subtask lands.
 */
export function verifyLockedSkill(
  entry: LockEntry,
  bundleBytes: Buffer,
  opts: { bundleHasher?: (b: Buffer) => string } = {}
): LockVerificationFinding {
  if (entry.source === "local") {
    // Local skills are not signed; only the hash anchors integrity.
    const recomputed = (opts.bundleHasher ?? defaultHasher)(bundleBytes);
    if (recomputed !== entry.content_hash) {
      return {
        ref: entry.ref,
        ok: false,
        reason: `integrity_failed: hash ${recomputed} does not match lockfile ${entry.content_hash}`,
      };
    }
    return { ref: entry.ref, ok: true };
  }

  if (!entry.author_key) {
    return {
      ref: entry.ref,
      ok: false,
      reason:
        "lock_missing_author_key: registry-sourced skill must pin author_key (PROTOCOL §11)",
    };
  }
  if (!entry.signature) {
    return {
      ref: entry.ref,
      ok: false,
      reason:
        "lock_missing_signature: registry-sourced skill must carry a signature envelope",
    };
  }

  const recomputed = (opts.bundleHasher ?? defaultHasher)(bundleBytes);
  if (recomputed !== entry.content_hash) {
    return {
      ref: entry.ref,
      ok: false,
      reason: `integrity_failed: hash ${recomputed} does not match lockfile ${entry.content_hash}`,
    };
  }

  // Resolve the pinned key from the lockfile (NOT from the registry). The
  // lockfile carries the author_key id only; we need the actual pubkey bytes.
  // Convention: when the registry serves a version it also returns the
  // base64 pubkey alongside the signature. CI MUST take that pubkey, compute
  // its key_id, and confirm key_id === entry.author_key BEFORE calling this.
  // For pure-hash use we still expose a sig-less verification path.
  return { ref: entry.ref, ok: true, reason: "verify_pubkey_externally" };
}

/**
 * The other half of CI verification: given the pinned author_key id, the
 * server-served public key bytes, and the bundle's locked signature, verify.
 *
 * Split from `verifyLockedSkill` because the public-key bytes live outside
 * the lockfile (the lockfile pins the *identifier*, not the key material —
 * matches PROTOCOL §11). CI fetches the pubkey from the registry's
 * `author_key_id` claim record and confirms `key_id === pinned`.
 */
export function verifyLockedSignature(
  entry: LockEntry,
  bundleBytes: Buffer,
  servedPublicKeyB64: string,
  opts: { bundleHasher?: (b: Buffer) => string } = {}
): LockVerificationFinding {
  const baseline = verifyLockedSkill(entry, bundleBytes, opts);
  if (!baseline.ok || entry.source !== "registry") return baseline;

  // Confirm the served pubkey actually corresponds to the pinned key_id.
  const pubKey = publicKeyFromBase64(servedPublicKeyB64);
  const jwk = pubKey.export({ format: "jwk" }) as { x: string };
  const derivedKeyId = Buffer.from(jwk.x, "base64url").toString("hex");
  if (derivedKeyId !== entry.author_key) {
    return {
      ref: entry.ref,
      ok: false,
      reason: `key_id_mismatch: registry pubkey id ${derivedKeyId} does not match lockfile-pinned ${entry.author_key}`,
    };
  }

  const sig = entry.signature as Signature;
  if (isSessionAttestedSignature(sig)) {
    return {
      ref: entry.ref,
      ok: false,
      reason:
        'session_attest_unverified: lockfile/CI requires an Ed25519 author signature; session-attested skills need interactive approval',
    };
  }
  if (!isEd25519Signature(sig)) {
    return {
      ref: entry.ref,
      ok: false,
      reason: `signature_invalid: unsupported lockfile signature alg ${JSON.stringify((entry.signature as Signature).alg)}`,
    };
  }
  try {
    if (sig.key_id === entry.author_key) {
      // Direct: the version was signed by the primary key itself.
      verifyEnvelope(entry.content_hash, sig, pubKey, { expectedKeyId: entry.author_key });
    } else {
      // Delegated path: the version was signed by a DEVICE key. Verify
      // the full chain offline against the pinned PRIMARY (servedPublicKeyB64,
      // already confirmed to match entry.author_key above). Expiry/revocation
      // are pin-time/sync-time gates (design §3.5); a version already content-
      // addressed-pinned in the lockfile is not retroactively unwound here — we
      // re-prove only that the chain roots in the pinned primary.
      if (!entry.delegation) {
        return {
          ref: entry.ref,
          ok: false,
          reason:
            "lock_missing_delegation: device-signed registry skill must carry an inline delegation",
        };
      }
      const cert = verifyDelegationCert(entry.delegation, {
        keyId: entry.author_key,
        pub: servedPublicKeyB64,
      });
      if (sig.key_id !== cert.device_key_id) {
        return {
          ref: entry.ref,
          ok: false,
          reason: `key_id_mismatch: lockfile signature key_id ${sig.key_id} is not the delegated device ${cert.device_key_id}`,
        };
      }
      const refHandle = handleFromRef(entry.ref);
      if (refHandle && cert.handle !== refHandle) {
        return {
          ref: entry.ref,
          ok: false,
          reason: `delegation_handle_mismatch: cert handle ${JSON.stringify(cert.handle)} does not match ref ${JSON.stringify(refHandle)}`,
        };
      }
      verifyEnvelope(entry.content_hash, sig, publicKeyFromBase64(cert.device_pub), {
        expectedKeyId: cert.device_key_id,
      });
    }
  } catch (err) {
    return {
      ref: entry.ref,
      ok: false,
      reason: (err as Error).message,
    };
  }

  return { ref: entry.ref, ok: true };
}

/** Extracts the author handle from a `@handle/slug` (or `handle/slug`) ref. */
function handleFromRef(ref: string): string | null {
  const m = ref.match(/^@?([a-z0-9-]+)\//);
  return m ? m[1] : null;
}

/** Default content hasher — single-buffer sha256. This will be replaced
 *  with the canonical multi-file bundle hash without touching the envelope. */
function defaultHasher(bundle: Buffer): string {
  return hashRef(sha256(bundle));
}

export const LOCK_FILENAME_CONST = LOCK_FILENAME;
