/**
 * TOFU (trust-on-first-use) store for author public keys (PROTOCOL §4).
 *
 * Layout:
 *   $XDG_CONFIG_HOME/skillet/pinned/<handle>.pub.json
 *     { "key_id": "<64-hex>", "alg": "ed25519", "pub": "<base64-raw-32>",
 *       "pinned_at": "<RFC3339>", "first_seen_version": <number> }
 *
 * Why a per-handle file, not a single db:
 *   - Atomic-write semantics are trivial (one file, one rename).
 *   - A hostile registry can only attack one handle at a time; no monolithic
 *     attack surface and easy human inspection / surgical revert.
 *   - Sync state is decoupled from credentials in ~/.skillet/keys/ (own keys).
 *
 * Verification flow (sync, materialize, CI):
 *   1. Take envelope.key_id off the registry response or lockfile.
 *   2. Look up the pinned key for the handle.
 *   3. If absent → pin this key (TOFU first-sight), continue.
 *   4. If pinned and key_id matches → verify and continue.
 *   5. If pinned and key_id differs → loud `author_key_changed` and refuse
 *      to write. Never silently accept (PROTOCOL §4 hard rule).
 *
 * A lockfile clone closes the TOFU hole: the lockfile already carries the
 * pinned author_key, so a fresh checkout has the pinned identity before the
 * first network call (PROTOCOL §11 + acceptance criterion 5). See `lock.ts`.
 */

import { mkdir, readFile, readdir, writeFile, rename, unlink, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicKey, type KeyObject } from "node:crypto";
import { SignatureError } from "./envelope.js";

const VALID_KEY_ID_RE = /^[0-9a-f]{64}$/;
// Handles are URL-safe lowercase per §1.1; we still enforce a strict
// allowlist before joining to avoid path traversal from a hostile manifest.
const VALID_HANDLE_RE = /^[a-z0-9-]{1,64}$/;

export interface PinnedAuthorKey {
  /** Lowercase hex Ed25519 key ID — also the filename stem. */
  key_id: string;
  alg: "ed25519";
  /** Base64 of the 32 raw Ed25519 public-key bytes. */
  pub: string;
  pinned_at: string;
  first_seen_version: number;
}

function normalizeHandle(handle: string): string {
  const h = handle.startsWith("@") ? handle.slice(1) : handle;
  if (!VALID_HANDLE_RE.test(h)) {
    throw new Error(`Invalid handle ${JSON.stringify(handle)}`);
  }
  return h;
}

export function defaultPinDir(): string {
  const cfg = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
  return join(cfg, "skillet", "pinned");
}

function pinPath(dir: string, handle: string): string {
  return join(dir, `${normalizeHandle(handle)}.pub.json`);
}

/**
 * Bind a key_id to its public key: key_id MUST equal hex(raw pubkey bytes).
 * Without this a hostile registry can claim any pinned key_id while serving an
 * attacker pub, sign with the attacker priv, and pass both the envelope check
 * and the TOFU string comparison — the pin would provide zero protection.
 * Comparison need not be constant-time (both values are public). Mirrors the
 * invariant in commands/add.ts so every trust path shares one check.
 */
export function assertKeyIdBindsPub(keyId: string, pubBase64: string): void {
  const derivedKeyId = Buffer.from(pubBase64, "base64").toString("hex");
  if (derivedKeyId !== keyId) {
    throw new SignatureError(
      "signature_invalid",
      `author_key_id ${keyId} does not match author_pub (derived key_id ${derivedKeyId})`
    );
  }
}

/** Convert a raw 32-byte Ed25519 pub key (base64) to a Node KeyObject. */
export function publicKeyFromBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) {
    throw new Error(
      `Invalid Ed25519 public key: expected 32 raw bytes, got ${raw.length}`
    );
  }
  const jwk = { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") };
  return createPublicKey({ key: jwk, format: "jwk" });
}

/**
 * Reads the pinned key for a handle. Returns null if no pin exists yet.
 * Throws on any other I/O / parse / shape error — corruption MUST surface,
 * not silently fall through to a re-pin.
 */
export async function loadPinnedKey(
  handle: string,
  pinDir: string = defaultPinDir()
): Promise<PinnedAuthorKey | null> {
  const p = pinPath(pinDir, handle);
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as PinnedAuthorKey;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Pinned key file ${p} is malformed`);
  }
  if (parsed.alg !== "ed25519" || !VALID_KEY_ID_RE.test(parsed.key_id)) {
    throw new Error(`Pinned key file ${p} has invalid alg/key_id`);
  }
  return parsed;
}

/**
 * Pins a freshly-seen key for a handle. Atomic (temp + rename) and refuses
 * to overwrite an existing pin — overwrite is a separate, explicit ceremony
 * a human runs after reviewing an `author_key_changed` warning.
 */
export async function pinAuthorKey(
  handle: string,
  key: { key_id: string; pub: Buffer | string; first_seen_version: number },
  pinDir: string = defaultPinDir()
): Promise<PinnedAuthorKey> {
  if (!VALID_KEY_ID_RE.test(key.key_id)) {
    throw new Error(`pinAuthorKey: invalid key_id ${JSON.stringify(key.key_id)}`);
  }
  const pubB64 = typeof key.pub === "string" ? key.pub : key.pub.toString("base64");
  const raw = Buffer.from(pubB64, "base64");
  if (raw.length !== 32) {
    throw new Error(
      `pinAuthorKey: pub must be 32 raw bytes, got ${raw.length}`
    );
  }
  // Never pin a (key_id, pub) the registry didn't actually bind together.
  assertKeyIdBindsPub(key.key_id, pubB64);

  await mkdir(pinDir, { recursive: true, mode: 0o700 });
  const dest = pinPath(pinDir, handle);
  const existing = await loadPinnedKey(handle, pinDir);
  if (existing) {
    if (existing.key_id !== key.key_id) {
      throw new SignatureError(
        "key_id_mismatch",
        `author_key_changed: handle ${handle} is already pinned to ${existing.key_id}, refusing to silently re-pin to ${key.key_id}`
      );
    }
    return existing; // idempotent re-pin of same key
  }

  const record: PinnedAuthorKey = {
    key_id: key.key_id,
    alg: "ed25519",
    pub: pubB64,
    pinned_at: new Date().toISOString(),
    first_seen_version: key.first_seen_version,
  };
  const tmp = `${dest}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(record, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(tmp, 0o600);
    await rename(tmp, dest);
  } catch (err) {
    try { await unlink(tmp); } catch { /* best effort */ }
    throw err;
  }
  return record;
}

/**
 * Explicit overwrite for the human-approved rotation path: after a loud
 * `author_key_changed` warning, a user opts to re-pin. Kept separate from
 * `pinAuthorKey` so the silent-accept path does not exist.
 */
export async function forceRepinAuthorKey(
  handle: string,
  key: { key_id: string; pub: Buffer | string; first_seen_version: number },
  pinDir: string = defaultPinDir()
): Promise<PinnedAuthorKey> {
  const dest = pinPath(pinDir, handle);
  try { await unlink(dest); } catch { /* may not exist */ }
  return pinAuthorKey(handle, key, pinDir);
}

/**
 * Resolve the author primary key for signature verification without persisting
 * a TOFU pin. Call {@link commitAuthorKeyPin} only after verification succeeds.
 */
export async function authorKeyForVerification(
  handle: string,
  served: { key_id: string; pub: string },
  pinDir: string = defaultPinDir(),
): Promise<{
  keyObject: KeyObject;
  pinnedPrimary: { keyId: string; pub: string };
  needsPinAfterVerify: boolean;
}> {
  assertKeyIdBindsPub(served.key_id, served.pub);
  const existing = await loadPinnedKey(handle, pinDir);
  if (existing) {
    if (existing.key_id !== served.key_id) {
      throw new SignatureError(
        "key_id_mismatch",
        `author_key_changed: handle ${handle} pinned to ${existing.key_id}, registry served ${served.key_id}`
      );
    }
    return {
      keyObject: publicKeyFromBase64(existing.pub),
      pinnedPrimary: { keyId: existing.key_id, pub: existing.pub },
      needsPinAfterVerify: false,
    };
  }
  return {
    keyObject: publicKeyFromBase64(served.pub),
    pinnedPrimary: { keyId: served.key_id, pub: served.pub },
    needsPinAfterVerify: true,
  };
}

/** Persist a TOFU pin after signature verification succeeded on first sight. */
export async function commitAuthorKeyPin(
  handle: string,
  served: { key_id: string; pub: string },
  at_version: number,
  pinDir: string = defaultPinDir(),
): Promise<PinnedAuthorKey> {
  return pinAuthorKey(
    handle,
    { key_id: served.key_id, pub: served.pub, first_seen_version: at_version },
    pinDir,
  );
}

/**
 * Resolution helper: given a handle and the registry-served pubkey, returns
 * a verifiable KeyObject. On TOFU first-sight, pins the key and returns it.
 * On match, returns the pinned key. On mismatch, throws SignatureError
 * (`key_id_mismatch`) — caller MUST treat as a hard stop.
 *
 * `at_version` is recorded for forensics (which version pinned this key).
 */
export async function resolveAuthorKey(
  handle: string,
  served: { key_id: string; pub: string },
  at_version: number,
  pinDir: string = defaultPinDir()
): Promise<{ keyObject: KeyObject; pinned: PinnedAuthorKey; newlyPinned: boolean }> {
  // The registry-served (key_id, pub) MUST bind before we trust it on either
  // the first-sight pin or the repeat-visit compare. Reject a forged pair up
  // front so a mismatched pub can never reach the string comparison below.
  assertKeyIdBindsPub(served.key_id, served.pub);
  const existing = await loadPinnedKey(handle, pinDir);
  if (existing) {
    if (existing.key_id !== served.key_id) {
      throw new SignatureError(
        "key_id_mismatch",
        `author_key_changed: handle ${handle} pinned to ${existing.key_id}, registry served ${served.key_id}`
      );
    }
    return {
      keyObject: publicKeyFromBase64(existing.pub),
      pinned: existing,
      newlyPinned: false,
    };
  }
  const pinned = await pinAuthorKey(
    handle,
    { key_id: served.key_id, pub: served.pub, first_seen_version: at_version },
    pinDir
  );
  return {
    keyObject: publicKeyFromBase64(pinned.pub),
    pinned,
    newlyPinned: true,
  };
}

/** For diagnostics/`skillet doctor`: list every handle the user has pinned. */
export async function listPinnedHandles(
  pinDir: string = defaultPinDir()
): Promise<string[]> {
  try {
    const entries = await readdir(pinDir);
    return entries
      .filter((e) => e.endsWith(".pub.json"))
      .map((e) => e.slice(0, -".pub.json".length))
      .filter((h) => VALID_HANDLE_RE.test(h));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// Re-export so callers that only deal with TOFU never import envelope.ts.
export { SignatureError } from "./envelope.js";
