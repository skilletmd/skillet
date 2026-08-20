import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, chmod, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateAuthorKey,
  saveAuthorKey,
  loadAuthorKey,
  loadAuthorKeyById,
  signBundle,
  verifyBundle,
  skilletReleasePublicKey,
} from "../src/signing/index.js";
import { enforcesUnixFilePermissions } from "../src/util/unix-perms.js";

// ── helpers ──────────────────────────────────────────────────────────────────

async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "skillet-signing-test-"));
}

// ── generateAuthorKey ────────────────────────────────────────────────────────

describe("generateAuthorKey", () => {
  it("returns a valid key pair with a 64-char hex keyId", () => {
    const key = generateAuthorKey();
    expect(key.keyId).toMatch(/^[0-9a-f]{64}$/);
    expect(key.publicKey).toBeDefined();
    expect(key.privateKey).toBeDefined();
  });

  it("produces a unique keyId on each call (entropy check)", () => {
    const k1 = generateAuthorKey();
    const k2 = generateAuthorKey();
    expect(k1.keyId).not.toBe(k2.keyId);
  });
});

// ── saveAuthorKey / loadAuthorKey ─────────────────────────────────────────────

describe("saveAuthorKey / loadAuthorKey", () => {
  let dir: string;

  beforeEach(async () => { dir = await tmpDir(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("round-trips keyId, publicKey, and privateKey", async () => {
    const key = generateAuthorKey();
    await saveAuthorKey(key, dir);
    const loaded = await loadAuthorKey(dir);

    expect(loaded.keyId).toBe(key.keyId);
    expect(
      loaded.publicKey.export({ type: "spki", format: "der" })
    ).toEqual(key.publicKey.export({ type: "spki", format: "der" }));
    expect(
      loaded.privateKey!.export({ type: "pkcs8", format: "der" })
    ).toEqual(key.privateKey!.export({ type: "pkcs8", format: "der" }));
  });

  it.skipIf(!enforcesUnixFilePermissions())("writes .sk file at mode 0600", async () => {
    const key = generateAuthorKey();
    await saveAuthorKey(key, dir);

    const skFile = join(dir, "skillet", "keys", `${key.keyId}.sk`);
    const info = await stat(skFile);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("writes the file under <configDir>/skillet/keys/<keyId>.sk", async () => {
    const key = generateAuthorKey();
    await saveAuthorKey(key, dir);

    const expected = join(dir, "skillet", "keys", `${key.keyId}.sk`);
    const info = await stat(expected); // throws if missing
    expect(info.isFile()).toBe(true);
  });

  it("throws when privateKey is absent", async () => {
    const key = generateAuthorKey();
    const verifyOnly = { keyId: key.keyId, publicKey: key.publicKey };
    await expect(saveAuthorKey(verifyOnly, dir)).rejects.toThrow(
      /Cannot save author key/
    );
  });

  it.skipIf(!enforcesUnixFilePermissions())("throws when key file has insecure permissions (0644)", async () => {
    const key = generateAuthorKey();
    await saveAuthorKey(key, dir);

    const skFile = join(dir, "skillet", "keys", `${key.keyId}.sk`);
    await chmod(skFile, 0o644);

    await expect(loadAuthorKey(dir)).rejects.toThrow(/insecure permissions/);
  });

  it("throws when no key file exists", async () => {
    await expect(loadAuthorKey(dir)).rejects.toThrow(/No author key found/);
  });
});

describe("loadAuthorKeyById", () => {
  let dir: string;

  beforeEach(async () => { dir = await tmpDir(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("rejects path traversal keyIds", async () => {
    const bad = ["../../etc/passwd", "../keys/foo", "foo/bar", ""];
    for (const id of bad) {
      await expect(loadAuthorKeyById(dir, id)).rejects.toThrow(
        /Invalid key ID/
      );
    }
  });

  it("rejects uppercase hex keyIds", async () => {
    const uppercase = "A".repeat(64);
    await expect(loadAuthorKeyById(dir, uppercase)).rejects.toThrow(
      /Invalid key ID/
    );
  });

  it.skipIf(process.platform === "win32")("rejects a symlink in place of the .sk file", async () => {
    const key = generateAuthorKey();
    await saveAuthorKey(key, dir);

    const skFile = join(dir, "skillet", "keys", `${key.keyId}.sk`);
    const realFile = `${skFile}.real`;
    // Rename real .sk aside, plant symlink pointing to it
    const { rename } = await import("node:fs/promises");
    await rename(skFile, realFile);
    await symlink(realFile, skFile);

    await expect(loadAuthorKeyById(dir, key.keyId)).rejects.toThrow(/symlink/);
  });
});

// ── signBundle / verifyBundle — happy path ────────────────────────────────────

describe("signBundle / verifyBundle", () => {
  it("round-trips: sign then verify succeeds", () => {
    const key = generateAuthorKey();
    const bundle = Buffer.from("a canonical skill bundle");
    const sig = signBundle(bundle, key);

    expect(sig).toHaveLength(64);
    expect(() => verifyBundle(bundle, sig, key.publicKey)).not.toThrow();
  });

  it("works with an empty bundle", () => {
    const key = generateAuthorKey();
    const sig = signBundle(Buffer.alloc(0), key);
    expect(() =>
      verifyBundle(Buffer.alloc(0), sig, key.publicKey)
    ).not.toThrow();
  });

  it("signBundle throws when privateKey is absent", () => {
    const key = generateAuthorKey();
    const verifyOnly = { keyId: key.keyId, publicKey: key.publicKey };
    expect(() => signBundle(Buffer.from("data"), verifyOnly)).toThrow(
      /Cannot sign/
    );
  });
});

// ── verifyBundle — adversarial inputs ────────────────────────────────────────

describe("verifyBundle adversarial", () => {
  const bundle = Buffer.from("original skill bundle content");
  let key: ReturnType<typeof generateAuthorKey>;
  let sig: Buffer;

  beforeEach(() => {
    key = generateAuthorKey();
    sig = signBundle(bundle, key);
  });

  it("fails on tampered bundle content", () => {
    const tampered = Buffer.from("tampered skill bundle content!");
    expect(() => verifyBundle(tampered, sig, key.publicKey)).toThrow(
      /Signature verification failed/
    );
  });

  it("fails when verifying with wrong public key", () => {
    const other = generateAuthorKey();
    expect(() => verifyBundle(bundle, sig, other.publicKey)).toThrow(
      /Signature verification failed/
    );
  });

  it("fails on truncated signature (32 bytes)", () => {
    const truncated = sig.slice(0, 32);
    expect(() => verifyBundle(bundle, truncated, key.publicKey)).toThrow(
      /invalid length/
    );
  });

  it("fails on all-zero signature", () => {
    const zero = Buffer.alloc(64, 0);
    expect(() => verifyBundle(bundle, zero, key.publicKey)).toThrow(
      /all-zero/
    );
  });

  it("fails on empty signature", () => {
    expect(() =>
      verifyBundle(bundle, Buffer.alloc(0), key.publicKey)
    ).toThrow(/missing or empty/);
  });

  it("fails on single-bit-flipped signature", () => {
    const flipped = Buffer.from(sig);
    flipped[32] ^= 0x01;
    expect(() => verifyBundle(bundle, flipped, key.publicKey)).toThrow(
      /Signature verification failed/
    );
  });

  it("fails on same-length wrong key", () => {
    const other = generateAuthorKey();
    expect(() => verifyBundle(bundle, sig, other.publicKey)).toThrow(
      /Signature verification failed/
    );
  });
});

// ── Skillet release key ──────────────────────────────────────────────────────────

describe("skilletReleasePublicKey", () => {
  it("returns a valid Ed25519 public KeyObject", () => {
    const pub = skilletReleasePublicKey();
    expect(pub.asymmetricKeyType).toBe("ed25519");
  });

  it("returns an independent object on each call", () => {
    const a = skilletReleasePublicKey();
    const b = skilletReleasePublicKey();
    // Exported bytes must be equal
    expect(a.export({ type: "spki", format: "der" })).toEqual(
      b.export({ type: "spki", format: "der" })
    );
    // But they are distinct objects
    expect(a).not.toBe(b);
  });
});
