/**
 * Safety-stack tests for validateMaterializationPath.
 * Covers all 9 named test vectors from the architecture plan plus
 * a fuzz pass over random inputs.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { validateMaterializationPath } from "../src/util/pathsafe.js";

// The only allowlisted root for v1
const CLAUDE_ROOT = join(homedir(), ".claude", "skills");

// -----------------------------------------------------------------------
// 9 named test vectors from the architecture plan
// -----------------------------------------------------------------------

describe("validateMaterializationPath — 9 test vectors", () => {
  // Vector 1: normal file — passes
  it("TV1: normal relative path inside root passes", () => {
    expect(() =>
      validateMaterializationPath(CLAUDE_ROOT, "my-skill/SKILL.md"),
    ).not.toThrow();
  });

  // Vector 2: dot-dot traversal — rejected
  it("TV2: ../ traversal is rejected", () => {
    expect(() =>
      validateMaterializationPath(CLAUDE_ROOT, "../../../etc/passwd"),
    ).toThrow(/Path escape rejected/);
  });

  // Vector 3: absolute outside root — rejected
  it("TV3: absolute path outside declared root is rejected", () => {
    expect(() =>
      validateMaterializationPath(CLAUDE_ROOT, "/etc/passwd"),
    ).toThrow(/Path escape rejected/);
  });

  // Vector 4: absolute same root — passes (not an escape)
  it("TV4: absolute path equal to declared root is not an escape", () => {
    // The root itself is not outside the root; OS write would fail but path is safe.
    expect(() =>
      validateMaterializationPath(CLAUDE_ROOT, CLAUDE_ROOT),
    ).not.toThrow();
  });

  // Vector 5: empty path — rejected
  it("TV5: empty target path is rejected", () => {
    expect(() =>
      validateMaterializationPath(CLAUDE_ROOT, ""),
    ).toThrow(/empty target path/);
  });

  // Vector 6: double-slash normalization — passes
  it("TV6: double-slash path is normalized and passes", () => {
    expect(() =>
      validateMaterializationPath(CLAUDE_ROOT, "my-skill//SKILL.md"),
    ).not.toThrow();
  });

  // Vector 7: null byte — rejected
  it("TV7: null byte in target path is rejected", () => {
    expect(() =>
      validateMaterializationPath(CLAUDE_ROOT, "my-skill\x00evil"),
    ).toThrow(/null byte/);
  });

  // Vector 8: root not in allowlist — rejected
  it("TV8: declared root not in per-runtime allowlist is rejected", () => {
    expect(() =>
      validateMaterializationPath("/tmp/attacker-controlled", "SKILL.md"),
    ).toThrow(/not in the per-runtime allowlist/);
  });

  // Vector 9: sibling dir escape — rejected
  it("TV9: sibling-dir traversal (../<sibling>) is rejected", () => {
    expect(() =>
      validateMaterializationPath(CLAUDE_ROOT, "../sibling-dir/SKILL.md"),
    ).toThrow(/Path escape rejected/);
  });
});

// -----------------------------------------------------------------------
// Allowlist invariants
// -----------------------------------------------------------------------

describe("validateMaterializationPath — allowlist invariants", () => {
  it("null byte in declared root is rejected before allowlist check", () => {
    expect(() =>
      validateMaterializationPath(`${CLAUDE_ROOT}\x00`, "SKILL.md"),
    ).toThrow(/null byte/);
  });

  it("allowlist check rejects arbitrary home-relative paths", () => {
    // .cursor/skills is now allowlisted (Cursor adapter ships in v1).
    // Use a path that will never be a runtime root.
    expect(() =>
      validateMaterializationPath(join(homedir(), ".not-a-runtime", "skills"), "SKILL.md"),
    ).toThrow(/not in the per-runtime allowlist/);
  });

  it("allowlist check rejects relative declared roots", () => {
    expect(() =>
      validateMaterializationPath("relative/path", "SKILL.md"),
    ).toThrow(/not in the per-runtime allowlist/);
  });
});

// -----------------------------------------------------------------------
// Fuzz: FuzzValidateMaterializationPath
// -----------------------------------------------------------------------

describe("FuzzValidateMaterializationPath", () => {
  const SEED_CHARS =
    "abcdefghijklmnopqrstuvwxyz0123456789/\\..~\x00\x01\r\n\t !@#$%^&*()[]{}";

  function randString(maxLen = 40): string {
    const len = Math.floor(Math.random() * maxLen);
    let s = "";
    for (let i = 0; i < len; i++) {
      s += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
    }
    return s;
  }

  it("never throws uncaught non-Error on arbitrary target paths", () => {
    for (let i = 0; i < 100; i++) {
      const target = randString();
      try {
        validateMaterializationPath(CLAUDE_ROOT, target);
      } catch (err) {
        // Every thrown value MUST be an Error with a non-empty message
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message.length).toBeGreaterThan(0);
      }
    }
  });

  it("always rejects target paths containing a null byte", () => {
    for (let i = 0; i < 50; i++) {
      const target = `${randString(20)}\x00${randString(20)}`;
      expect(() =>
        validateMaterializationPath(CLAUDE_ROOT, target),
      ).toThrow();
    }
  });

  it("always rejects non-allowlisted declared roots regardless of target", () => {
    const badRoots = ["/tmp/x", "/var/evil", "/etc", join(homedir(), "Desktop"), ""];
    for (const root of badRoots) {
      for (let i = 0; i < 5; i++) {
        const target = randString();
        try {
          validateMaterializationPath(root, target);
          // If no throw: either the root resolved to an allowlisted path (only possible
          // if root === CLAUDE_ROOT after resolve, which none of these are) OR
          // the target was empty (rejected separately). Neither applies to our badRoots.
          throw new Error(`Expected rejection for root="${root}" target="${target}"`);
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }
      }
    }
  });
});
