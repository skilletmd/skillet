/**
 * Direct tests for sync.ts's verify-before-write gate (PROTOCOL §6.4 +
 * acceptance #3). The gate is what guarantees a poisoned or
 * key-rotated registry response cannot overwrite a legitimate prior file:
 * sync.ts skips materialize for any slug for which this returns non-null,
 * so any failure path covered here corresponds to "leaves existing files
 * untouched" in the running CLI.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyForMaterialize } from "../src/commands/sync.js";
import { generateAuthorKey } from "../src/signing/index.js";
import { signEnvelope } from "../src/signing/envelope.js";
import { SIG_ALG_SESSION } from "../src/signing/session-attest.js";
import { pinAuthorKey } from "../src/signing/pin.js";
import { mintDelegation } from "../src/signing/delegation.js";
import { hashRef, sha256 } from "../src/util/hash.js";
import type { SkillEntry } from "../src/kit/types.js";

function pubB64(k: ReturnType<typeof generateAuthorKey>): string {
  const jwk = k.publicKey.export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

function baseEntry(over: Partial<SkillEntry> = {}): SkillEntry {
  return {
    slug: "@taylor/festival-ops",
    name: "n",
    description: "",
    version: 7,
    hash: "a".repeat(64),
    source: "registry",
    importedAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

describe("verifyForMaterialize", () => {
  let pinDir: string;
  beforeEach(async () => { pinDir = await mkdtemp(join(tmpdir(), "skillet-vfm-")); });
  afterEach(async () => { await rm(pinDir, { recursive: true, force: true }); });

  it("local skill: passes when recomputed hash matches", async () => {
    const content = "hello";
    // entry.hash is the canonical `sha256:`-prefixed bundle hash.
    const entry = baseEntry({ source: "local", hash: hashRef(sha256(content)), authorKeyId: undefined });
    const reason = await verifyForMaterialize(entry, hashRef(sha256(content)), pinDir);
    expect(reason).toBeNull();
  });

  it("local skill: aborts with integrity_failed when hash drifted", async () => {
    const entry = baseEntry({ source: "local", hash: hashRef(sha256("original")) });
    const reason = await verifyForMaterialize(entry, hashRef(sha256("tampered")), pinDir);
    expect(reason).toMatch(/integrity_failed/);
  });

  it("registry skill: passes legitimate sig + matching pin", async () => {
    const k = generateAuthorKey();
    const content = "real";
    const contentHash = hashRef(sha256(content));
    const sig = signEnvelope(contentHash, k);
    await pinAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: pubB64(k), first_seen_version: 7 },
      pinDir
    );

    const entry = baseEntry({
      authorKeyId: k.keyId,
      authorPubBase64: pubB64(k),
      signature: sig,
      hash: sha256(content),
    });

    const reason = await verifyForMaterialize(entry, contentHash, pinDir);
    expect(reason).toBeNull();
  });

  it("registry skill: aborts when signature is missing", async () => {
    const k = generateAuthorKey();
    const entry = baseEntry({
      authorKeyId: k.keyId,
      authorPubBase64: pubB64(k),
      // no signature
    });
    const reason = await verifyForMaterialize(entry, hashRef(sha256("x")), pinDir);
    expect(reason).toMatch(/integrity_failed.*missing signature/);
  });

  it("registry skill: aborts when content_hash drifted from signed value (integrity_failed)", async () => {
    const k = generateAuthorKey();
    const content = "real";
    const signedHash = hashRef(sha256(content));
    const sig = signEnvelope(signedHash, k);
    await pinAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: pubB64(k), first_seen_version: 7 },
      pinDir
    );
    const entry = baseEntry({
      authorKeyId: k.keyId,
      authorPubBase64: pubB64(k),
      signature: sig,
    });

    // Caller passes the hash of TAMPERED content. verifyEnvelope rejects.
    const tamperedHash = hashRef(sha256("tampered"));
    const reason = await verifyForMaterialize(entry, tamperedHash, pinDir);
    expect(reason).toMatch(/integrity_failed/);
  });

  it("registry skill: aborts with key_id_mismatch when the served key differs from the pinned key (loud, never silent)", async () => {
    const pinned = generateAuthorKey();
    const attacker = generateAuthorKey();
    const content = "x";
    const contentHash = hashRef(sha256(content));
    const sig = signEnvelope(contentHash, attacker); // attacker signs

    // We pre-pin "taylor" to the legitimate key.
    await pinAuthorKey(
      "taylor",
      { key_id: pinned.keyId, pub: pubB64(pinned), first_seen_version: 1 },
      pinDir
    );

    // But the entry carries the attacker's key + sig (e.g. swapped by a
    // compromised registry response).
    const entry = baseEntry({
      authorKeyId: attacker.keyId,
      authorPubBase64: pubB64(attacker),
      signature: sig,
    });

    const reason = await verifyForMaterialize(entry, contentHash, pinDir);
    expect(reason).toMatch(/key_id_mismatch/);
  });

  it("registry skill: first-sight TOFU pins the key and accepts the sig", async () => {
    const k = generateAuthorKey();
    const content = "first-time";
    const contentHash = hashRef(sha256(content));
    const sig = signEnvelope(contentHash, k);

    const entry = baseEntry({
      slug: "@nobody/new-skill",
      authorKeyId: k.keyId,
      authorPubBase64: pubB64(k),
      signature: sig,
    });

    const reason = await verifyForMaterialize(entry, contentHash, pinDir);
    expect(reason).toBeNull();
  });

  it("registry skill: resolves bare slug handle from pinned key when owner is missing", async () => {
    const k = generateAuthorKey();
    const content = "legacy-bare-slug";
    const contentHash = hashRef(sha256(content));
    const sig = signEnvelope(contentHash, k);

    await pinAuthorKey(
      "thiago",
      { key_id: k.keyId, pub: pubB64(k), first_seen_version: 7 },
      pinDir
    );

    const entry = baseEntry({
      slug: "skillet-sync",
      owner: null,
      authorKeyId: k.keyId,
      authorPubBase64: pubB64(k),
      signature: sig,
    });

    const reason = await verifyForMaterialize(entry, contentHash, pinDir);
    expect(reason).toBeNull();
  });

  it("registry skill: resolves author handle from entry.owner when slug is bare", async () => {
    const k = generateAuthorKey();
    const content = "bare-slug";
    const contentHash = hashRef(sha256(content));
    const sig = signEnvelope(contentHash, k);

    const entry = baseEntry({
      slug: "skillet-sync",
      owner: "thiago",
      authorKeyId: k.keyId,
      authorPubBase64: pubB64(k),
      signature: sig,
    });

    const reason = await verifyForMaterialize(entry, contentHash, pinDir);
    expect(reason).toBeNull();
  });

  it("registry skill: verifies a device-delegated signature at materialize", async () => {
    const primary = generateAuthorKey();
    const device = generateAuthorKey();
    const contentHash = hashRef(sha256("delegated"));
    const { signed } = mintDelegation({
      primaryKey: primary,
      handle: "taylor",
      devicePubB64: pubB64(device),
    });
    const versionSignature = signEnvelope(contentHash, device);
    await pinAuthorKey(
      "taylor",
      { key_id: primary.keyId, pub: pubB64(primary), first_seen_version: 1 },
      pinDir,
    );
    const entry = baseEntry({
      authorKeyId: primary.keyId,
      authorPubBase64: pubB64(primary),
      signature: versionSignature,
      delegation: signed,
    });
    const reason = await verifyForMaterialize(entry, contentHash, pinDir);
    expect(reason).toBeNull();
  });

  it("registry skill: refuses materialize when device key was revoked", async () => {
    const primary = generateAuthorKey();
    const device = generateAuthorKey();
    const contentHash = hashRef(sha256("revoked-device"));
    const { signed } = mintDelegation({
      primaryKey: primary,
      handle: "taylor",
      devicePubB64: pubB64(device),
    });
    const versionSignature = signEnvelope(contentHash, device);
    await pinAuthorKey(
      "taylor",
      { key_id: primary.keyId, pub: pubB64(primary), first_seen_version: 1 },
      pinDir,
    );
    const entry = baseEntry({
      authorKeyId: primary.keyId,
      authorPubBase64: pubB64(primary),
      signature: versionSignature,
      delegation: signed,
    });
    const reason = await verifyForMaterialize(entry, contentHash, pinDir, {
      revokedDeviceKeyIds: new Set([device.keyId]),
    });
    expect(reason).toMatch(/delegation_revoked/);
  });

  it("registry skill: refuses delegated materialize when revocation fetch failed", async () => {
    const primary = generateAuthorKey();
    const device = generateAuthorKey();
    const contentHash = hashRef(sha256("revocation-outage"));
    const { signed } = mintDelegation({
      primaryKey: primary,
      handle: "taylor",
      devicePubB64: pubB64(device),
    });
    const versionSignature = signEnvelope(contentHash, device);
    await pinAuthorKey(
      "taylor",
      { key_id: primary.keyId, pub: pubB64(primary), first_seen_version: 1 },
      pinDir,
    );
    const entry = baseEntry({
      authorKeyId: primary.keyId,
      authorPubBase64: pubB64(primary),
      signature: versionSignature,
      delegation: signed,
    });
    const reason = await verifyForMaterialize(entry, contentHash, pinDir, {
      revokedDeviceKeyIds: new Set(),
      revocationFetchOk: false,
    });
    expect(reason).toMatch(/revocation list unavailable/);
  });

  it("session-attested registry skill: passes when hash matches without author keys", async () => {
    const content = "session skill body";
    const contentHash = hashRef(sha256(content));
    const entry = baseEntry({
      hash: contentHash,
      authorKeyId: undefined,
      authorPubBase64: undefined,
      signature: { alg: SIG_ALG_SESSION, key_id: "0".repeat(64), sig: "" },
    });
    const reason = await verifyForMaterialize(entry, contentHash, pinDir);
    expect(reason).toBeNull();
  });

  it("session-attested registry skill: fails when hash drifts", async () => {
    const contentHash = hashRef(sha256("original"));
    const entry = baseEntry({
      hash: contentHash,
      signature: { alg: SIG_ALG_SESSION, key_id: "0".repeat(64), sig: "" },
    });
    const reason = await verifyForMaterialize(entry, hashRef(sha256("tampered")), pinDir);
    expect(reason).toMatch(/session-attested content hash drifted/);
  });

  it("non-session registry skill without author keys still fails", async () => {
    const contentHash = hashRef(sha256("x"));
    const k = generateAuthorKey();
    const sig = signEnvelope(contentHash, k);
    const entry = baseEntry({
      hash: contentHash,
      authorKeyId: undefined,
      authorPubBase64: undefined,
      signature: sig,
    });
    const reason = await verifyForMaterialize(entry, contentHash, pinDir);
    expect(reason).toMatch(/missing author key material/);
  });
});
