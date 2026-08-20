/**
 * Client-side device-key delegation: minting + chain verification.
 *
 * These tests are the security proof for the CLI half. They exercise
 * the §9 invariants and the client-side acceptance criteria WITHOUT a live
 * registry: a delegated version is accepted iff its chain
 *   version.signature ← device_pub ← cert ← cert_sig ← TOFU-pinned primary
 * holds, and is refused (fail-closed) on every break, revocation, expiry, or
 * scope violation.
 */
import { describe, it, expect } from "vitest";
import {
  generateAuthorKey,
  type AuthorKey,
} from "../src/signing/index.js";
import {
  mintDelegation,
  mintRevocation,
  deviceKeyIdFromPub,
  verifyDelegationCert,
  verifyDelegatedVersionSignature,
  DelegationError,
} from "../src/signing/delegation.js";
import {
  delegationCertHash,
  revocationHash,
  validateDelegationCert,
  DELEGABLE_SCOPES,
  MAX_DELEGATION_TTL_SEC,
} from "@skillet/protocol";
import { signEnvelope, verifyEnvelope } from "../src/signing/envelope.js";
import { publicKeyFromBase64 } from "../src/signing/pin.js";

const HANDLE = "alice";
const CONTENT_HASH = "sha256:" + "a".repeat(64);
const NOW = 1_739_000_000;

/** Base64 of an AuthorKey's raw 32-byte Ed25519 public key. */
function pubB64(key: AuthorKey): string {
  return Buffer.from(key.keyId, "hex").toString("base64");
}
function pinnedOf(key: AuthorKey): { keyId: string; pub: string } {
  return { keyId: key.keyId, pub: pubB64(key) };
}

/** A primary + a device key, an approve-scoped cert, and a device-signed version. */
function setup(opts: { scopes?: ("propose" | "approve")[]; ttlSec?: number; now?: number } = {}) {
  const primary = generateAuthorKey();
  const device = generateAuthorKey();
  const { signed } = mintDelegation({
    primaryKey: primary,
    handle: HANDLE,
    devicePubB64: pubB64(device),
    now: opts.now ?? NOW,
    ...(opts.scopes ? { scopes: opts.scopes } : {}),
    ...(opts.ttlSec ? { ttlSec: opts.ttlSec } : {}),
  });
  const versionSignature = signEnvelope(CONTENT_HASH, device);
  return { primary, device, signed, versionSignature };
}

describe("minting (CLI primary-key path)", () => {
  it("mints a cert that validates, binds the device id to the pub, and self-verifies", () => {
    const primary = generateAuthorKey();
    const device = generateAuthorKey();
    const { signed } = mintDelegation({
      primaryKey: primary,
      handle: HANDLE,
      devicePubB64: pubB64(device),
      now: NOW,
    });
    const cert = signed.cert;

    expect(validateDelegationCert(cert)).toMatchObject({ ok: true });
    expect(cert.author_key_id).toBe(primary.keyId);
    expect(cert.handle).toBe(HANDLE);
    expect(cert.device_key_id).toBe(device.keyId);
    expect(cert.device_key_id).toBe(deviceKeyIdFromPub(cert.device_pub));
    // default scopes = both delegable scopes; never claim/publish
    expect(cert.scopes).toEqual([...DELEGABLE_SCOPES]);
    // cert_sig verifies against the primary over the cert hash
    expect(() =>
      verifyEnvelope(delegationCertHash(cert), signed.cert_sig, publicKeyFromBase64(pubB64(primary)), {
        expectedKeyId: primary.keyId,
      }),
    ).not.toThrow();
  });

  it("caps the TTL at MAX_DELEGATION_TTL_SEC even when a longer one is requested", () => {
    const primary = generateAuthorKey();
    const device = generateAuthorKey();
    const { signed } = mintDelegation({
      primaryKey: primary,
      handle: HANDLE,
      devicePubB64: pubB64(device),
      ttlSec: MAX_DELEGATION_TTL_SEC * 10,
      now: NOW,
    });
    expect(signed.cert.expires_at - signed.cert.issued_at).toBe(MAX_DELEGATION_TTL_SEC);
  });

  it("refuses a non-delegable scope (claim is never delegable, §9.5)", () => {
    const primary = generateAuthorKey();
    const device = generateAuthorKey();
    expect(() =>
      mintDelegation({
        primaryKey: primary,
        handle: HANDLE,
        devicePubB64: pubB64(device),
        // @ts-expect-error — deliberately passing a forbidden scope
        scopes: ["claim"],
      }),
    ).toThrow(DelegationError);
  });

  it("refuses to mint without a private key", () => {
    const primary = generateAuthorKey();
    const device = generateAuthorKey();
    const pubOnly: AuthorKey = { keyId: primary.keyId, publicKey: primary.publicKey };
    expect(() =>
      mintDelegation({ primaryKey: pubOnly, handle: HANDLE, devicePubB64: pubB64(device) }),
    ).toThrow(/private key/);
  });

  it("mints a revocation that verifies against the primary", () => {
    const primary = generateAuthorKey();
    const device = generateAuthorKey();
    const rev = mintRevocation({ primaryKey: primary, deviceKeyId: device.keyId, now: NOW });
    expect(rev.revocation.device_key_id).toBe(device.keyId);
    expect(rev.revocation.author_key_id).toBe(primary.keyId);
    expect(() =>
      verifyEnvelope(revocationHash(rev.revocation), rev.revocation_sig, publicKeyFromBase64(pubB64(primary)), {
        expectedKeyId: primary.keyId,
      }),
    ).not.toThrow();
  });
});

describe("client-side chain verification — happy path", () => {
  it("accepts a device-signed version that chains to the pinned primary", () => {
    const { primary, device, signed, versionSignature } = setup();
    const res = verifyDelegatedVersionSignature({
      contentHash: CONTENT_HASH,
      versionSignature,
      signedDelegation: signed,
      pinnedPrimary: pinnedOf(primary),
      handle: HANDLE,
      requiredScope: "approve",
      publishedAt: NOW + 10,
    });
    expect(res).toEqual({ deviceKeyId: device.keyId, via: "delegation" });
  });

  it("verifyDelegationCert returns the cert when it chains to the pinned primary", () => {
    const { primary, device, signed } = setup();
    const cert = verifyDelegationCert(signed, pinnedOf(primary));
    expect(cert.device_key_id).toBe(device.keyId);
  });
});

describe("AC#2 — fail-closed: a broken chain is never materialized", () => {
  it("refuses a device-signed version with NO delegation (downgrade, T9)", () => {
    const { primary, versionSignature } = setup();
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature,
        signedDelegation: null,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 10,
      }),
    ).toThrow(expect.objectContaining({ code: "delegation_missing" }));
  });

  it("refuses a cert signed by a DIFFERENT primary than the one pinned (T1)", () => {
    const { signed, versionSignature } = setup();
    const attackerPrimary = generateAuthorKey(); // not the pinned key
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature,
        signedDelegation: signed,
        pinnedPrimary: pinnedOf(attackerPrimary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 10,
      }),
    ).toThrow(DelegationError);
  });

  it("refuses a tampered cert (swapped device_pub) — cert_sig no longer verifies (T2)", () => {
    const { primary, signed, versionSignature } = setup();
    const evil = generateAuthorKey();
    const tampered = {
      cert: { ...signed.cert, device_pub: pubB64(evil), device_key_id: evil.keyId },
      cert_sig: signed.cert_sig, // stale signature over the original cert
    };
    expect(() => verifyDelegationCert(tampered, pinnedOf(primary))).toThrow();
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature: signEnvelope(CONTENT_HASH, evil),
        signedDelegation: tampered,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 10,
      }),
    ).toThrow();
  });

  it("refuses when the version sig key_id does not match the cert's device key", () => {
    const { primary, signed } = setup();
    const other = generateAuthorKey();
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature: signEnvelope(CONTENT_HASH, other), // signed by a non-delegated key
        signedDelegation: signed,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 10,
      }),
    ).toThrow(expect.objectContaining({ code: "delegation_invalid" }));
  });

  it("refuses when the device sig is over a different content hash", () => {
    const { primary, signed } = setup();
    const device = generateAuthorKey();
    // Re-issue the cert for this `device` so key ids line up, then sign a DIFFERENT hash.
    const { signed: signed2 } = mintDelegation({
      primaryKey: primary,
      handle: HANDLE,
      devicePubB64: pubB64(device),
      now: NOW,
    });
    void signed;
    const otherHash = "sha256:" + "b".repeat(64);
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature: signEnvelope(otherHash, device),
        signedDelegation: signed2,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 10,
      }),
    ).toThrow();
  });

  it("refuses when the cert handle does not match the author (T6)", () => {
    const { primary, signed, versionSignature } = setup();
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature,
        signedDelegation: signed,
        pinnedPrimary: pinnedOf(primary),
        handle: "mallory", // not the cert's handle
        requiredScope: "approve",
        publishedAt: NOW + 10,
      }),
    ).toThrow(expect.objectContaining({ code: "delegation_invalid" }));
  });
});

describe("AC#3 — revoked device key is refused fresh acceptance", () => {
  it("refuses when the device key id is in the revocation set", () => {
    const { primary, device, signed, versionSignature } = setup();
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature,
        signedDelegation: signed,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 10,
        revokedDeviceKeyIds: new Set([device.keyId]),
      }),
    ).toThrow(expect.objectContaining({ code: "delegation_revoked" }));
  });

  it("accepts when a DIFFERENT key is revoked", () => {
    const { primary, signed, versionSignature } = setup();
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature,
        signedDelegation: signed,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 10,
        revokedDeviceKeyIds: new Set(["f".repeat(64)]),
      }),
    ).not.toThrow();
  });
});

describe("expiry + scope gates", () => {
  it("refuses a version published after the cert expired (§5)", () => {
    const { primary, signed, versionSignature } = setup({ ttlSec: 100, now: NOW });
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature,
        signedDelegation: signed,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 1000, // past expires_at = NOW+100
      }),
    ).toThrow(expect.objectContaining({ code: "delegation_expired" }));
  });

  it("accepts a version published inside the cert window", () => {
    const { primary, signed, versionSignature } = setup({ ttlSec: 1000, now: NOW });
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature,
        signedDelegation: signed,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 500,
      }),
    ).not.toThrow();
  });

  it("refuses an out-of-scope action (cert is propose-only, version needs approve)", () => {
    const { primary, signed, versionSignature } = setup({ scopes: ["propose"], now: NOW });
    expect(() =>
      verifyDelegatedVersionSignature({
        contentHash: CONTENT_HASH,
        versionSignature,
        signedDelegation: signed,
        pinnedPrimary: pinnedOf(primary),
        handle: HANDLE,
        requiredScope: "approve",
        publishedAt: NOW + 10,
      }),
    ).toThrow(expect.objectContaining({ code: "delegation_scope_denied" }));
  });
});

describe("deviceKeyIdFromPub", () => {
  it("rejects a pub that is not 32 raw bytes", () => {
    expect(() => deviceKeyIdFromPub(Buffer.alloc(31).toString("base64"))).toThrow(DelegationError);
  });
  it("rejects lenient base64 that does not round-trip to the same string", () => {
    const valid = pubB64(generateAuthorKey());
    const junkSuffix = `${valid}!!!`;
    expect(() => deviceKeyIdFromPub(junkSuffix)).toThrow(DelegationError);
  });
  it("round-trips a valid pub to its hex id", () => {
    const k = generateAuthorKey();
    expect(deviceKeyIdFromPub(pubB64(k))).toBe(k.keyId);
  });
});
