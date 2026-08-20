import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pinAuthorKey,
  loadPinnedKey,
  resolveAuthorKey,
  forceRepinAuthorKey,
  listPinnedHandles,
  assertKeyIdBindsPub,
} from "../src/signing/pin.js";
import { SignatureError } from "../src/signing/envelope.js";
import { generateAuthorKey } from "../src/signing/index.js";
import { enforcesUnixFilePermissions } from "../src/util/unix-perms.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "skillet-pin-test-"));
}

function publicKeyBytesB64(key: ReturnType<typeof generateAuthorKey>): string {
  const jwk = key.publicKey.export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

describe("pinAuthorKey / loadPinnedKey", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmp(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("pins, then loads, the same key", async () => {
    const k = generateAuthorKey();
    const pinned = await pinAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k), first_seen_version: 7 },
      dir
    );
    expect(pinned.key_id).toBe(k.keyId);

    const loaded = await loadPinnedKey("taylor", dir);
    expect(loaded?.key_id).toBe(k.keyId);
    expect(loaded?.first_seen_version).toBe(7);
  });

  it.skipIf(!enforcesUnixFilePermissions())("writes pin file at mode 0600 under the pin dir", async () => {
    const k = generateAuthorKey();
    await pinAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k), first_seen_version: 1 },
      dir
    );
    const info = await stat(join(dir, "taylor.pub.json"));
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("strips a leading @ from the handle", async () => {
    const k = generateAuthorKey();
    await pinAuthorKey(
      "@taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k), first_seen_version: 1 },
      dir
    );
    const text = await readFile(join(dir, "taylor.pub.json"), "utf8");
    expect(text).toContain(k.keyId);
  });

  it("rejects a handle that could path-traverse", async () => {
    const k = generateAuthorKey();
    await expect(
      pinAuthorKey(
        "../etc/passwd",
        { key_id: k.keyId, pub: publicKeyBytesB64(k), first_seen_version: 1 },
        dir
      )
    ).rejects.toThrow(/Invalid handle/);
  });

  it("returns null for an unpinned handle", async () => {
    expect(await loadPinnedKey("nobody", dir)).toBeNull();
  });

  it("re-pinning the same key_id is idempotent", async () => {
    const k = generateAuthorKey();
    const a = await pinAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k), first_seen_version: 1 },
      dir
    );
    const b = await pinAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k), first_seen_version: 9 },
      dir
    );
    // Same record returned — first_seen_version is NOT bumped on idempotent re-pin.
    expect(b.first_seen_version).toBe(a.first_seen_version);
  });

  it("refuses to silently re-pin a different key_id", async () => {
    const k1 = generateAuthorKey();
    const k2 = generateAuthorKey();
    await pinAuthorKey(
      "taylor",
      { key_id: k1.keyId, pub: publicKeyBytesB64(k1), first_seen_version: 1 },
      dir
    );
    await expect(
      pinAuthorKey(
        "taylor",
        { key_id: k2.keyId, pub: publicKeyBytesB64(k2), first_seen_version: 2 },
        dir
      )
    ).rejects.toBeInstanceOf(SignatureError);
  });

  it("forceRepinAuthorKey replaces an existing pin", async () => {
    const k1 = generateAuthorKey();
    const k2 = generateAuthorKey();
    await pinAuthorKey(
      "taylor",
      { key_id: k1.keyId, pub: publicKeyBytesB64(k1), first_seen_version: 1 },
      dir
    );
    const replaced = await forceRepinAuthorKey(
      "taylor",
      { key_id: k2.keyId, pub: publicKeyBytesB64(k2), first_seen_version: 2 },
      dir
    );
    expect(replaced.key_id).toBe(k2.keyId);
  });
});

describe("resolveAuthorKey (TOFU)", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmp(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("first sight pins the key and reports newlyPinned=true", async () => {
    const k = generateAuthorKey();
    const out = await resolveAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k) },
      1,
      dir
    );
    expect(out.newlyPinned).toBe(true);
    expect(out.pinned.key_id).toBe(k.keyId);
  });

  it("second sight with same key returns existing pin (newlyPinned=false)", async () => {
    const k = generateAuthorKey();
    await resolveAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k) },
      1,
      dir
    );
    const again = await resolveAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k) },
      2,
      dir
    );
    expect(again.newlyPinned).toBe(false);
  });

  it("a different key_id on second sight throws key_id_mismatch loudly", async () => {
    const k1 = generateAuthorKey();
    const k2 = generateAuthorKey();
    await resolveAuthorKey(
      "taylor",
      { key_id: k1.keyId, pub: publicKeyBytesB64(k1) },
      1,
      dir
    );
    try {
      await resolveAuthorKey(
        "taylor",
        { key_id: k2.keyId, pub: publicKeyBytesB64(k2) },
        2,
        dir
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureError);
      expect((err as SignatureError).code).toBe("key_id_mismatch");
      expect((err as SignatureError).message).toContain("author_key_changed");
    }
  });
});

describe("assertKeyIdBindsPub (TOFU key_id↔pub binding)", () => {
  it("accepts a key_id that equals hex(pub)", () => {
    const k = generateAuthorKey();
    expect(() =>
      assertKeyIdBindsPub(k.keyId, publicKeyBytesB64(k))
    ).not.toThrow();
  });

  it("rejects a victim key_id paired with an attacker pub", () => {
    const victim = generateAuthorKey();
    const attacker = generateAuthorKey();
    try {
      assertKeyIdBindsPub(victim.keyId, publicKeyBytesB64(attacker));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureError);
      expect((err as SignatureError).code).toBe("signature_invalid");
      expect((err as SignatureError).message).toContain("does not match author_pub");
    }
  });
});

describe("key_id↔pub binding on pin (the finding)", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmp(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("pinAuthorKey: matching key_id == hex(pub) pins successfully", async () => {
    const k = generateAuthorKey();
    const pinned = await pinAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k), first_seen_version: 1 },
      dir
    );
    expect(pinned.key_id).toBe(k.keyId);
  });

  it("pinAuthorKey: victim key_id + attacker pub throws and pins nothing", async () => {
    const victim = generateAuthorKey();
    const attacker = generateAuthorKey();
    await expect(
      pinAuthorKey(
        "taylor",
        { key_id: victim.keyId, pub: publicKeyBytesB64(attacker), first_seen_version: 1 },
        dir
      )
    ).rejects.toBeInstanceOf(SignatureError);
    // Nothing was written.
    expect(await loadPinnedKey("taylor", dir)).toBeNull();
  });

  it("resolveAuthorKey: first-sight mismatched pair throws and pins nothing", async () => {
    const victim = generateAuthorKey();
    const attacker = generateAuthorKey();
    await expect(
      resolveAuthorKey(
        "taylor",
        { key_id: victim.keyId, pub: publicKeyBytesB64(attacker) },
        1,
        dir
      )
    ).rejects.toBeInstanceOf(SignatureError);
    expect(await loadPinnedKey("taylor", dir)).toBeNull();
  });

  it("resolveAuthorKey: repeat visit with already-pinned matching key still succeeds", async () => {
    const k = generateAuthorKey();
    await resolveAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k) },
      1,
      dir
    );
    const again = await resolveAuthorKey(
      "taylor",
      { key_id: k.keyId, pub: publicKeyBytesB64(k) },
      2,
      dir
    );
    expect(again.newlyPinned).toBe(false);
    expect(again.pinned.key_id).toBe(k.keyId);
  });

  it("pinAuthorKey: malformed (non-32-byte) pub is rejected by the format check", async () => {
    const k = generateAuthorKey();
    await expect(
      pinAuthorKey(
        "taylor",
        { key_id: k.keyId, pub: "QUJD", first_seen_version: 1 }, // 3 bytes
        dir
      )
    ).rejects.toThrow(/32 raw bytes/);
    expect(await loadPinnedKey("taylor", dir)).toBeNull();
  });
});

describe("listPinnedHandles", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmp(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns an empty array when the dir doesn't exist", async () => {
    expect(await listPinnedHandles(join(dir, "missing"))).toEqual([]);
  });

  it("lists all pinned handles", async () => {
    const k1 = generateAuthorKey();
    const k2 = generateAuthorKey();
    await pinAuthorKey(
      "alice",
      { key_id: k1.keyId, pub: publicKeyBytesB64(k1), first_seen_version: 1 },
      dir
    );
    await pinAuthorKey(
      "bob",
      { key_id: k2.keyId, pub: publicKeyBytesB64(k2), first_seen_version: 1 },
      dir
    );
    const handles = await listPinnedHandles(dir);
    expect(handles.sort()).toEqual(["alice", "bob"]);
  });
});
