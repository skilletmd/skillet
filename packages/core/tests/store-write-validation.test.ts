/**
 * B2 — writeBundleToSkillStore validates bundle paths before writing.
 *
 * A registry-served bundle's keys are attacker-controlled (hostile/compromised
 * registry, or a session-attested envelope that skips author crypto). The store
 * write path must reject traversal/absolute entries at the chokepoint so a key
 * like `../../../evil/SKILL.md` can never escape ~/.skillet/skills.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";

const TEST_ROOT = vi.hoisted(() => {
  const osMod = require("node:os") as typeof import("node:os");
  const cryptoMod = require("node:crypto") as typeof import("node:crypto");
  const pathMod = require("node:path") as typeof import("node:path");
  const root = pathMod.join(
    osMod.tmpdir(),
    `skillet-store-write-${cryptoMod.randomBytes(4).toString("hex")}`
  );
  process.env["SKILLET_DIR"] = root;
  return root;
});

import { writeBundleToSkillStore, skillContentDir } from "../src/kit/store.js";
import type { DecodedBundle } from "@skillet/protocol";

const SLUG = "alice/test-skill";

function bundle(entries: Record<string, string>): DecodedBundle {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(entries)) m.set(k, Buffer.from(v));
  return m;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("writeBundleToSkillStore path validation (B2)", () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });
  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("rejects a traversal key and writes nothing outside the store", async () => {
    const b = bundle({
      "SKILL.md": "---\nname: test\n---\n",
      "../../../evil/SKILL.md": "pwned",
    });
    await expect(writeBundleToSkillStore(SLUG, b)).rejects.toThrow();
    // The escaped target must not exist.
    expect(await exists(join(TEST_ROOT, "..", "..", "evil", "SKILL.md"))).toBe(
      false
    );
  });

  it("rejects an absolute key", async () => {
    const b = bundle({
      "SKILL.md": "---\nname: test\n---\n",
      "/tmp/evil": "pwned",
    });
    await expect(writeBundleToSkillStore(SLUG, b)).rejects.toThrow();
  });

  it("rejects a bundle missing SKILL.md at root", async () => {
    const b = bundle({ "nested/file.md": "x" });
    await expect(writeBundleToSkillStore(SLUG, b)).rejects.toThrow();
  });

  it("rejects a traversal slug (directory-component escape)", async () => {
    const b = bundle({ "SKILL.md": "---\nname: test\n---\n" });
    await expect(writeBundleToSkillStore("../../../evil", b)).rejects.toThrow(
      /escape|null/i
    );
    expect(await exists(join(TEST_ROOT, "..", "..", "evil"))).toBe(false);
  });

  it("accepts a canonical @author/slug", async () => {
    const b = bundle({ "SKILL.md": "---\nname: test\n---\n" });
    await writeBundleToSkillStore("@alice/ok-skill", b);
    expect(
      await exists(join(skillContentDir("@alice/ok-skill"), "SKILL.md"))
    ).toBe(true);
  });

  it("writes a valid bundle (regression)", async () => {
    const b = bundle({
      "SKILL.md": "---\nname: test\n---\n\nHello.\n",
      "ref/notes.md": "notes",
    });
    await writeBundleToSkillStore(SLUG, b);
    expect(await exists(join(skillContentDir(SLUG), "SKILL.md"))).toBe(true);
    expect(await exists(join(skillContentDir(SLUG), "ref", "notes.md"))).toBe(
      true
    );
  });

  // Read-side chokepoint must mirror the write side: a poisoned state.json could
  // carry a traversal slug, and every read of a skill's bytes funnels through
  // skillContentDir. It must reject the escape before any path is read.
  it("skillContentDir rejects a traversal slug", () => {
    expect(() => skillContentDir("../../../evil")).toThrow(/escape|null/i);
  });

  it("skillContentDir accepts a canonical slug", () => {
    expect(() => skillContentDir("@alice/ok-skill")).not.toThrow();
  });
});
