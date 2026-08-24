/**
 * get_skill reaches skills you have not added.
 *
 * Summon is useless if the candidate it returns cannot be loaded, so get_skill
 * falls through to the public read path on a manifest miss. This widens a read
 * boundary, so the kit path must keep behaving exactly as before — in
 * particular a kit skill still resolves through the manifest at its pinned
 * hash, never through the public path.
 *
 * Scope note: the serve guards (scanner and moderation quarantine) and the
 * canReadSkillPrisma ACL live in the registry's DiscoverySource implementation
 * and are covered in the registry suite. A stub here could only prove the stub.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return { ...actual, readState: async () => ({ version: 1, skills: {} }) };
});

import { callTool } from "../src/handler.js";
import type { DiscoverySource, PublicReadOptions, SkillSource } from "../src/store.js";
import type { SkillEntry } from "@skillet/core";

const KIT_SKILL = {
  slug: "taylor/festival-ops",
  owner: "taylor",
  name: "Festival ops",
  description: "Run a festival",
  version: 3,
  versionLabel: "1.1.0",
  hash: "sha256:kit-pinned",
} as unknown as SkillEntry;

const kitSource: SkillSource = {
  listEntries: async () => [KIT_SKILL],
  listFiles: async () => ["SKILL.md"],
  readFile: async () => "# Festival ops (from the kit)",
};

function discovery(over: Partial<DiscoverySource> = {}): DiscoverySource {
  return {
    summon: async (handle) => ({ kind: "ok", handle, candidates: [] }),
    searchPublic: async () => [],
    authorStanding: async () => null,
    readPublicSkill: async (ref) => ({
      ref,
      name: "TypeScript review",
      description: "Review TypeScript",
      hash: "sha256:public",
      versionLabel: "2.0.0",
      skillMd: "# TypeScript review (from the registry)",
      resources: ["SKILL.md", "examples/bad.ts"],
    }),
    ...over,
  };
}

function get(args: unknown, d?: DiscoverySource) {
  return callTool("get_skill", args, [KIT_SKILL], kitSource, d);
}

describe("a skill you have not added still loads", () => {
  it("falls through to the public path on a manifest miss", async () => {
    const res = await get({ slug: "mattpocock/typescript-review" }, discovery());
    const json = res.structuredContent as Record<string, unknown>;

    expect(res.isError).toBeFalsy();
    expect(json.skill_md).toContain("from the registry");
    expect(json.version_hash).toBe("sha256:public");
    expect(json.resources).toEqual(["SKILL.md", "examples/bad.ts"]);
  });

  it("passes the summoned handle through so the author gets the credit", async () => {
    const seen: PublicReadOptions[] = [];
    const d = discovery({
      readPublicSkill: async (ref, opts) => {
        seen.push(opts ?? {});
        return {
          ref, name: "n", description: "d", hash: "h", skillMd: "body", resources: [],
        };
      },
    });

    await get({ slug: "shadcn/component-api", via: "mattpocock" }, d);

    // via is how attribution reaches the registry: the curator summoned, the
    // author wrote it, and the count belongs to the author.
    expect(seen[0].via).toBe("mattpocock");
  });

  it("honors an explicit hash so a summon candidate loads the version it named", async () => {
    const seen: PublicReadOptions[] = [];
    const d = discovery({
      readPublicSkill: async (ref, opts) => {
        seen.push(opts ?? {});
        return { ref, name: "n", description: "d", hash: "h", skillMd: "b", resources: [] };
      },
    });

    await get({ slug: "a/b", hash: "sha256:exact" }, d);

    expect(seen[0].hash).toBe("sha256:exact");
  });

  it("reports not found when the registry has no such public skill", async () => {
    const d = discovery({ readPublicSkill: async () => null });
    const res = await get({ slug: "nobody/nothing" }, d);

    expect(res.isError).toBe(true);
  });
});

describe("the kit path is unchanged", () => {
  it("still resolves a kit skill through the manifest, at its pinned hash", async () => {
    let publicCalled = false;
    const d = discovery({
      readPublicSkill: async () => {
        publicCalled = true;
        return null;
      },
    });

    const res = await get({ slug: "taylor/festival-ops" }, d);
    const json = res.structuredContent as Record<string, unknown>;

    expect(json.skill_md).toContain("from the kit");
    expect(json.version_hash).toBe("sha256:kit-pinned");
    // A kit skill must never take the public path: that would silently swap a
    // pinned version for whatever is latest.
    expect(publicCalled).toBe(false);
  });

  it("returns not found for a non-kit ref when there is no discovery", async () => {
    const res = await get({ slug: "mattpocock/typescript-review" });

    // Loopback behavior, unchanged: no capability means no reach.
    expect(res.isError).toBe(true);
  });
});

describe("traversal is rejected before any lookup", () => {
  it("refuses a ref with path traversal even when discovery exists", async () => {
    let reached = false;
    const d = discovery({
      readPublicSkill: async () => {
        reached = true;
        return null;
      },
    });

    await expect(get({ slug: "../../etc/passwd" }, d)).rejects.toThrow();
    expect(reached).toBe(false);
  });
});
