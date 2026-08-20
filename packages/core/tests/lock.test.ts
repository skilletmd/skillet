import { describe, it, expect } from "vitest";
import {
  encodeLockFile,
  decodeLockFile,
  buildLockFile,
  verifyLockedSkill,
  verifyLockedSignature,
  type LockFile,
} from "../src/lock.js";
import { signEnvelope } from "../src/signing/envelope.js";
import { generateAuthorKey } from "../src/signing/index.js";
import { sha256, hashRef } from "../src/util/hash.js";

const FIXED_NOW = new Date("2026-06-13T17:00:00.000Z");
const SAMPLE_HASH = hashRef("a".repeat(64));

function pubB64(k: ReturnType<typeof generateAuthorKey>): string {
  const jwk = k.publicKey.export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

// ── encode / decode round-trip ──────────────────────────────────────────────

describe("encodeLockFile / decodeLockFile", () => {
  it("round-trips a registry-sourced skill with signature", () => {
    const k = generateAuthorKey();
    const sig = signEnvelope(SAMPLE_HASH, k);

    const lock: LockFile = {
      schema_version: 1,
      registry: "https://registry.skillet.md",
      generated_at: FIXED_NOW.toISOString(),
      skills: [
        {
          ref: "@taylor/festival-ops",
          version: 7,
          content_hash: SAMPLE_HASH,
          author_key: k.keyId,
          source: "registry",
          signature: sig,
        },
      ],
    };

    const text = encodeLockFile(lock);
    const round = decodeLockFile(text);

    expect(round).toEqual(lock);
  });

  it("emits TOML with [[skill]] table, not JSON braces, with registry top-level", () => {
    const lock: LockFile = {
      schema_version: 1,
      registry: "https://registry.skillet.md",
      generated_at: FIXED_NOW.toISOString(),
      skills: [
        {
          ref: "@me/local",
          version: 1,
          content_hash: SAMPLE_HASH,
          source: "local",
        },
      ],
    };
    const text = encodeLockFile(lock);
    expect(text).toMatch(/^registry = "https:\/\/registry\.skillet\.md"/m);
    expect(text).toMatch(/^\[\[skill\]\]$/m);
    expect(text).toMatch(/ref = "@me\/local"/);
    expect(text.startsWith("{")).toBe(false);
  });

  it("rejects a lockfile without `registry` (required per §11)", () => {
    expect(() =>
      decodeLockFile(`generated_at = "2026-06-13T00:00:00Z"\n\n[[skill]]\nref = "@x/y"\nversion = 1\ncontent_hash = "${SAMPLE_HASH}"\nsource = "local"\n`)
    ).toThrow(/registry.*required/);
  });

  it("rejects an entry whose source is neither local nor registry", () => {
    const bad = `registry = "https://r"\ngenerated_at = "x"\n\n[[skill]]\nref = "@x/y"\nversion = 1\ncontent_hash = "${SAMPLE_HASH}"\nsource = "bogus"\n`;
    expect(() => decodeLockFile(bad)).toThrow(/source must be/);
  });

  it("rejects a duplicate key in a [[skill]] entry", () => {
    const bad = `registry = "https://r"\ngenerated_at = "x"\n\n[[skill]]\nref = "@x/y"\nref = "@x/z"\nversion = 1\ncontent_hash = "${SAMPLE_HASH}"\nsource = "local"\n`;
    expect(() => decodeLockFile(bad)).toThrow(/duplicate key/);
  });

  it("preserves entry order across round-trip", () => {
    const k = generateAuthorKey();
    const sig = signEnvelope(SAMPLE_HASH, k);
    const lock: LockFile = {
      schema_version: 1,
      registry: "https://r",
      generated_at: FIXED_NOW.toISOString(),
      skills: [
        { ref: "@a/one", version: 1, content_hash: SAMPLE_HASH, source: "local" },
        { ref: "@b/two", version: 2, content_hash: SAMPLE_HASH, author_key: k.keyId, source: "registry", signature: sig },
        { ref: "@c/three", version: 3, content_hash: SAMPLE_HASH, source: "local" },
      ],
    };
    const round = decodeLockFile(encodeLockFile(lock));
    expect(round.skills.map((s) => s.ref)).toEqual(["@a/one", "@b/two", "@c/three"]);
  });

  it("round-trips version_label and omits it when absent", () => {
    const lock: LockFile = {
      schema_version: 1,
      registry: "https://registry.skillet.md",
      generated_at: FIXED_NOW.toISOString(),
      skills: [
        {
          ref: "@taylor/festival-ops",
          version: 7,
          version_label: "1.2.3",
          content_hash: SAMPLE_HASH,
          source: "registry",
        },
        { ref: "@me/local", version: 1, content_hash: SAMPLE_HASH, source: "local" },
      ],
    };
    const text = encodeLockFile(lock);
    expect(text).toMatch(/^version_label = "1\.2\.3"$/m);
    // Exactly one entry carries the key — the label-less one stays label-less.
    expect(text.match(/version_label/g)).toHaveLength(1);

    const round = decodeLockFile(text);
    expect(round).toEqual(lock);
    expect(round.skills[1]).not.toHaveProperty("version_label");
  });

  it("rejects a non-string version_label", () => {
    const bad = `registry = "https://r"\ngenerated_at = "x"\n\n[[skill]]\nref = "@x/y"\nversion = 1\nversion_label = 2\ncontent_hash = "${SAMPLE_HASH}"\nsource = "local"\n`;
    expect(() => decodeLockFile(bad)).toThrow(/version_label must be string/);
  });

  it("decodes legacy lockfiles without schema_version as v1", () => {
    const decoded = decodeLockFile(
      `registry = "https://registry.skillet.md"\n` +
        `generated_at = "2026-06-13T00:00:00Z"\n\n` +
        `[[skill]]\nref = "@x/y"\nversion = 1\ncontent_hash = "${SAMPLE_HASH}"\nsource = "local"\n`,
    );
    expect(decoded.schema_version).toBe(1);
  });
});

// ── buildLockFile honors authorKeyId from KitState ──────────────────────────

describe("buildLockFile", () => {
  it("copies authorKeyId into author_key for registry skills", () => {
    const k = generateAuthorKey();
    const lock = buildLockFile(
      {
        version: 1,
        skills: {
          "@taylor/festival-ops": {
            slug: "@taylor/festival-ops",
            name: "Festival ops",
            description: "",
            version: 7,
            hash: "a".repeat(64),
            source: "registry",
            authorKeyId: k.keyId,
            importedAt: FIXED_NOW.toISOString(),
            updatedAt: FIXED_NOW.toISOString(),
          },
        },
      },
      { now: () => FIXED_NOW }
    );
    expect(lock.skills[0].author_key).toBe(k.keyId);
  });

  it("copies versionLabel into version_label and leaves it absent otherwise", () => {
    const lock = buildLockFile(
      {
        version: 1,
        skills: {
          "@taylor/festival-ops": {
            slug: "@taylor/festival-ops",
            name: "Festival ops",
            description: "",
            version: 7,
            versionLabel: "1.2.3",
            hash: "a".repeat(64),
            source: "registry",
            importedAt: FIXED_NOW.toISOString(),
            updatedAt: FIXED_NOW.toISOString(),
          },
          "local-only": {
            slug: "local-only",
            name: "Local",
            description: "",
            version: 1,
            hash: "b".repeat(64),
            source: "local",
            importedAt: FIXED_NOW.toISOString(),
            updatedAt: FIXED_NOW.toISOString(),
          },
        },
      },
      { now: () => FIXED_NOW }
    );
    expect(lock.skills[0].version_label).toBe("1.2.3");
    expect(lock.skills[1]).not.toHaveProperty("version_label");
  });

  it("applies signature override into lockfile entry", () => {
    const k = generateAuthorKey();
    const sig = signEnvelope(SAMPLE_HASH, k);
    const lock = buildLockFile(
      {
        version: 1,
        skills: {
          "@a/b": {
            slug: "@a/b",
            name: "n",
            description: "",
            version: 1,
            hash: "a".repeat(64),
            source: "registry",
            authorKeyId: k.keyId,
            importedAt: FIXED_NOW.toISOString(),
            updatedAt: FIXED_NOW.toISOString(),
          },
        },
      },
      {
        now: () => FIXED_NOW,
        overrides: { "@a/b": { signature: sig, content_hash: SAMPLE_HASH } },
      }
    );
    expect(lock.skills[0].signature).toEqual(sig);
  });
});

// ── verifyLockedSkill: hash check ───────────────────────────────────────────

describe("verifyLockedSkill (hash-only path)", () => {
  it("passes when local content rehashes to the pinned content_hash", () => {
    const bytes = Buffer.from("hello world");
    const finding = verifyLockedSkill(
      {
        ref: "@me/local",
        version: 1,
        content_hash: hashRef(sha256(bytes)),
        source: "local",
      },
      bytes
    );
    expect(finding.ok).toBe(true);
  });

  it("rejects when local content rehashes to a different hash (integrity_failed)", () => {
    const finding = verifyLockedSkill(
      {
        ref: "@me/local",
        version: 1,
        content_hash: hashRef(sha256(Buffer.from("original"))),
        source: "local",
      },
      Buffer.from("tampered")
    );
    expect(finding.ok).toBe(false);
    expect(finding.reason).toContain("integrity_failed");
  });

  it("flags registry skill missing author_key in lockfile", () => {
    const finding = verifyLockedSkill(
      {
        ref: "@x/y",
        version: 1,
        content_hash: hashRef(sha256(Buffer.from("x"))),
        source: "registry",
        // no author_key
      },
      Buffer.from("x")
    );
    expect(finding.ok).toBe(false);
    expect(finding.reason).toContain("lock_missing_author_key");
  });

  it("flags registry skill missing signature in lockfile", () => {
    const k = generateAuthorKey();
    const finding = verifyLockedSkill(
      {
        ref: "@x/y",
        version: 1,
        content_hash: hashRef(sha256(Buffer.from("x"))),
        source: "registry",
        author_key: k.keyId,
        // no signature
      },
      Buffer.from("x")
    );
    expect(finding.ok).toBe(false);
    expect(finding.reason).toContain("lock_missing_signature");
  });
});

// ── verifyLockedSignature: closes the TOFU hole for fresh clones ─────────────

describe("verifyLockedSignature (CI / fresh clone verification)", () => {
  it("verifies a registry skill end-to-end with the served pubkey", () => {
    const k = generateAuthorKey();
    const bytes = Buffer.from("real content");
    const contentHash = hashRef(sha256(bytes));
    const sig = signEnvelope(contentHash, k);
    const finding = verifyLockedSignature(
      {
        ref: "@taylor/festival-ops",
        version: 7,
        content_hash: contentHash,
        source: "registry",
        author_key: k.keyId,
        signature: sig,
      },
      bytes,
      pubB64(k)
    );
    expect(finding.ok).toBe(true);
  });

  it("rejects when the served pubkey id differs from the pinned author_key (key_id_mismatch)", () => {
    const k1 = generateAuthorKey();
    const k2 = generateAuthorKey();
    const bytes = Buffer.from("content");
    const contentHash = hashRef(sha256(bytes));
    const sig = signEnvelope(contentHash, k1);

    const finding = verifyLockedSignature(
      {
        ref: "@taylor/festival-ops",
        version: 7,
        content_hash: contentHash,
        source: "registry",
        author_key: k1.keyId,
        signature: sig,
      },
      bytes,
      pubB64(k2)
    );
    expect(finding.ok).toBe(false);
    expect(finding.reason).toContain("key_id_mismatch");
  });

  it("rejects a poisoned first fetch: attacker-signed bundle posing as the pinned handle (key_id_mismatch)", () => {
    const honest = generateAuthorKey();
    const attacker = generateAuthorKey();
    const bytes = Buffer.from("malicious content");
    const contentHash = hashRef(sha256(bytes));

    // The attacker signs with their own key, but the lockfile pins `honest`.
    // The signature envelope embeds the attacker's key_id; verifyEnvelope
    // catches that BEFORE it ever attempts the (would-fail) cryptographic
    // verify — that order is intentional, key_id_mismatch is the louder,
    // more diagnosable failure mode.
    const sig = signEnvelope(contentHash, attacker);
    const finding = verifyLockedSignature(
      {
        ref: "@honest/skill",
        version: 1,
        content_hash: contentHash,
        source: "registry",
        author_key: honest.keyId,
        signature: sig,
      },
      bytes,
      pubB64(honest)
    );
    expect(finding.ok).toBe(false);
    // Still fail-closed. A signature whose key_id is neither the
    // pinned primary nor backed by an inline delegation is rejected as a missing
    // delegation (a non-primary key must prove its chain); the older direct path
    // surfaced key_id_mismatch. Either way the poisoned fetch is refused.
    expect(finding.reason).toMatch(/key_id_mismatch|integrity_failed|lock_missing_delegation/);
  });

  it("rejects a poisoned first fetch where envelope key_id is forged to match: cryptographic verify fails (integrity_failed)", () => {
    // Harder attack: the attacker can't produce a sig that verifies under
    // honest's pubkey, but they CAN craft an envelope whose key_id field
    // matches honest's id (the wire envelope is plaintext data). The
    // cryptographic verify is what stops them.
    const honest = generateAuthorKey();
    const attacker = generateAuthorKey();
    const bytes = Buffer.from("malicious content");
    const contentHash = hashRef(sha256(bytes));

    const realSig = signEnvelope(contentHash, attacker);
    const forgedEnvelope = { ...realSig, key_id: honest.keyId };

    const finding = verifyLockedSignature(
      {
        ref: "@honest/skill",
        version: 1,
        content_hash: contentHash,
        source: "registry",
        author_key: honest.keyId,
        signature: forgedEnvelope,
      },
      bytes,
      pubB64(honest)
    );
    expect(finding.ok).toBe(false);
    expect(finding.reason).toContain("integrity_failed");
  });

  it("rejects when registry-served bundle bytes hash-drifted from the lockfile", () => {
    const k = generateAuthorKey();
    const original = Buffer.from("real content");
    const tampered = Buffer.from("not what was published");
    const sig = signEnvelope(hashRef(sha256(original)), k);

    const finding = verifyLockedSignature(
      {
        ref: "@taylor/festival-ops",
        version: 7,
        content_hash: hashRef(sha256(original)),
        source: "registry",
        author_key: k.keyId,
        signature: sig,
      },
      tampered,
      pubB64(k)
    );
    expect(finding.ok).toBe(false);
    expect(finding.reason).toContain("integrity_failed");
  });

  it("rejects session-attested signatures in lockfile/CI verification (U5 Option B)", () => {
    const k = generateAuthorKey();
    const bytes = Buffer.from("web-published");
    const contentHash = hashRef(sha256(bytes));
    const finding = verifyLockedSignature(
      {
        ref: "@taylor/web-skill",
        version: 1,
        content_hash: contentHash,
        source: "registry",
        author_key: k.keyId,
        signature: { alg: "session", key_id: k.keyId, sig: "" },
      },
      bytes,
      pubB64(k),
    );
    expect(finding.ok).toBe(false);
    expect(finding.reason).toContain("session_attest_unverified");
  });
});
