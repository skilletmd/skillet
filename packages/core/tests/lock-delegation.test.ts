/**
 * skillet.lock offline verification of a DEVICE-signed version.
 *
 * A fresh clone / CI run has no network: it must verify
 *   lockfile signature ← device_pub ← inline cert ← pinned primary author_key
 * entirely from the committed lockfile + the served primary pubkey. These tests
 * exercise the encode → decode round trip and the fail-closed verify branch.
 */
import { describe, it, expect } from "vitest";
import { generateAuthorKey } from "../src/signing/index.js";
import { signEnvelope } from "../src/signing/envelope.js";
import { mintDelegation } from "../src/signing/delegation.js";
import {
  encodeLockFile,
  decodeLockFile,
  verifyLockedSignature,
  type LockEntry,
  type LockFile,
} from "../src/lock.js";
import { sha256, hashRef } from "../src/util/hash.js";

const HANDLE = "taylor";

function deviceSignedEntry() {
  const primary = generateAuthorKey();
  const device = generateAuthorKey();
  const primaryPubB64 = Buffer.from(primary.keyId, "hex").toString("base64");
  const devicePubB64 = Buffer.from(device.keyId, "hex").toString("base64");

  const bundle = Buffer.from("# A skill bundle\n");
  const contentHash = hashRef(sha256(bundle)); // matches lock.ts defaultHasher

  const { signed } = mintDelegation({
    primaryKey: primary,
    handle: HANDLE,
    devicePubB64,
    now: 1_739_000_000,
  });
  const sig = signEnvelope(contentHash, device);

  const entry: LockEntry = {
    ref: `@${HANDLE}/festival-ops`,
    version: 7,
    content_hash: contentHash,
    author_key: primary.keyId, // the PINNED PRIMARY id
    source: "registry",
    signature: sig, // signed by the DEVICE key
    delegation: signed,
  };
  return { entry, bundle, primaryPubB64, device, primary };
}

describe("lockfile delegation — encode/decode round trip", () => {
  it("survives an encode → decode round trip (base64 chain field)", () => {
    const { entry } = deviceSignedEntry();
    const lock: LockFile = {
      schema_version: 1,
      registry: "https://registry.skillet.md",
      generated_at: "2026-06-14T00:00:00.000Z",
      skills: [entry],
    };
    const decoded = decodeLockFile(encodeLockFile(lock));
    expect(decoded.skills).toHaveLength(1);
    const d = decoded.skills[0];
    expect(d.delegation).toBeDefined();
    expect(d.delegation?.cert.device_key_id).toBe(entry.delegation?.cert.device_key_id);
    expect(d.signature?.key_id).toBe(entry.signature?.key_id);
  });
});

describe("lockfile delegation — verifyLockedSignature (offline CI)", () => {
  it("accepts a device-signed entry whose chain roots in the pinned primary", () => {
    const { entry, bundle, primaryPubB64 } = deviceSignedEntry();
    const finding = verifyLockedSignature(entry, bundle, primaryPubB64);
    expect(finding.ok).toBe(true);
  });

  it("rejects when the served primary pubkey is NOT the pinned one (T1)", () => {
    const { entry, bundle } = deviceSignedEntry();
    const attackerPrimaryPubB64 = Buffer.from(generateAuthorKey().keyId, "hex").toString("base64");
    const finding = verifyLockedSignature(entry, bundle, attackerPrimaryPubB64);
    expect(finding.ok).toBe(false);
    expect(finding.reason).toMatch(/key_id_mismatch/);
  });

  it("rejects a device-signed entry with no inline delegation (no downgrade)", () => {
    const { entry, bundle, primaryPubB64 } = deviceSignedEntry();
    const stripped: LockEntry = { ...entry };
    delete stripped.delegation;
    const finding = verifyLockedSignature(stripped, bundle, primaryPubB64);
    expect(finding.ok).toBe(false);
    expect(finding.reason).toMatch(/lock_missing_delegation/);
  });

  it("rejects when the bundle bytes do not match the pinned content hash", () => {
    const { entry, primaryPubB64 } = deviceSignedEntry();
    const finding = verifyLockedSignature(entry, Buffer.from("tampered"), primaryPubB64);
    expect(finding.ok).toBe(false);
    expect(finding.reason).toMatch(/integrity_failed/);
  });
});
