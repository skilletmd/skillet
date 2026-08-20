import { describe, it, expect } from "vitest";
import {
  signatureBytes,
  signEnvelope,
  verifyEnvelope,
  SignatureError,
  SIG_ALG_ED25519,
} from "../src/signing/envelope.js";
import { generateAuthorKey } from "../src/signing/index.js";

const SAMPLE_HASH = "sha256:" + "a".repeat(64);

describe("signatureBytes", () => {
  it("returns the UTF-8 bytes of the content_hash string", () => {
    const buf = signatureBytes(SAMPLE_HASH);
    expect(buf.toString("utf8")).toBe(SAMPLE_HASH);
  });

  it("rejects a hash that isn't sha256:<64-hex>", () => {
    expect(() => signatureBytes("sha256:short")).toThrow(/must match/);
    expect(() => signatureBytes("md5:" + "a".repeat(32))).toThrow(/must match/);
    expect(() => signatureBytes("sha256:" + "A".repeat(64))).toThrow(/must match/);
  });
});

describe("signEnvelope / verifyEnvelope round-trip", () => {
  it("produces a verifiable envelope", () => {
    const key = generateAuthorKey();
    const env = signEnvelope(SAMPLE_HASH, key);
    expect(env.alg).toBe(SIG_ALG_ED25519);
    expect(env.key_id).toBe(key.keyId);
    expect(Buffer.from(env.sig, "base64")).toHaveLength(64);

    expect(() => verifyEnvelope(SAMPLE_HASH, env, key.publicKey)).not.toThrow();
  });

  it("v2 binding rejects cross-name replay (NF-004)", () => {
    const key = generateAuthorKey();
    const env = signEnvelope(SAMPLE_HASH, key, {
      binding: { ref: "@alice/foo", version: 1, authorKeyId: key.keyId },
    });
    expect(env.sig_version).toBe(2);
    expect(() =>
      verifyEnvelope(SAMPLE_HASH, env, key.publicKey, {
        binding: { ref: "@alice/bar", version: 1, authorKeyId: key.keyId },
      }),
    ).toThrow(SignatureError);
  });

  it("rejects when contentHash differs (integrity_failed)", () => {
    const key = generateAuthorKey();
    const env = signEnvelope(SAMPLE_HASH, key);
    const other = "sha256:" + "b".repeat(64);
    try {
      verifyEnvelope(other, env, key.publicKey);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureError);
      expect((err as SignatureError).code).toBe("integrity_failed");
    }
  });

  it("rejects an envelope with the wrong key_id when expected is set", () => {
    const key = generateAuthorKey();
    const env = signEnvelope(SAMPLE_HASH, key);
    try {
      verifyEnvelope(SAMPLE_HASH, env, key.publicKey, {
        expectedKeyId: "b".repeat(64),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureError);
      expect((err as SignatureError).code).toBe("key_id_mismatch");
    }
  });

  it("rejects all-zero sig", () => {
    const key = generateAuthorKey();
    const env = signEnvelope(SAMPLE_HASH, key);
    env.sig = Buffer.alloc(64, 0).toString("base64");
    try {
      verifyEnvelope(SAMPLE_HASH, env, key.publicKey);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SignatureError).code).toBe("signature_invalid");
    }
  });

  it("rejects a truncated sig", () => {
    const key = generateAuthorKey();
    const env = signEnvelope(SAMPLE_HASH, key);
    env.sig = Buffer.from(env.sig, "base64").slice(0, 32).toString("base64");
    try {
      verifyEnvelope(SAMPLE_HASH, env, key.publicKey);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SignatureError).code).toBe("signature_invalid");
    }
  });

  it("rejects an unsupported alg", () => {
    const key = generateAuthorKey();
    const env = signEnvelope(SAMPLE_HASH, key);
    const tampered = { ...env, alg: "rsa" as unknown as typeof env.alg };
    try {
      verifyEnvelope(SAMPLE_HASH, tampered, key.publicKey);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SignatureError).code).toBe("signature_invalid");
    }
  });

  it("refuses to sign without a private key", () => {
    const key = generateAuthorKey();
    expect(() =>
      signEnvelope(SAMPLE_HASH, { keyId: key.keyId } as unknown as typeof key)
    ).toThrow(/private key is undefined/);
  });

  it("refuses to sign with a malformed key_id", () => {
    const key = generateAuthorKey();
    expect(() =>
      signEnvelope(SAMPLE_HASH, { ...key, keyId: "not-hex" })
    ).toThrow(/invalid key_id/);
  });
});

describe("SignatureError", () => {
  it("carries the machine-readable code", () => {
    const err = new SignatureError("integrity_failed", "boom");
    expect(err.code).toBe("integrity_failed");
    expect(err.message).toContain("integrity_failed");
  });
});
