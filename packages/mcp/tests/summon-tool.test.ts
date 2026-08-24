/**
 * The summon tools, at the handler seam.
 *
 * Scope: the tool contract — argument handling, the candidate shape a client
 * receives, and the two different empty answers. Serve guards, the read ACL,
 * and private-skill exclusion are enforced by the registry's DiscoverySource
 * implementation, not here, and are covered in the registry suite; a stub
 * source could only prove the stub.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return { ...actual, readState: async () => ({ version: 1, skills: {} }) };
});

import { callSummonTool } from "../src/handler.js";
import type { DiscoverySource, SummonCandidate } from "../src/store.js";

const AUTHORED: SummonCandidate = {
  ref: "mattpocock/typescript-review",
  name: "TypeScript review",
  description: "Review TypeScript for type-safety mistakes",
  hash: "aaa111",
  versionLabel: "1.2.0",
};

// Curated: it lives in mattpocock's public kit, but someone else wrote it.
const CURATED: SummonCandidate = {
  ref: "shadcn/component-api",
  name: "Component API",
  description: "Design a component API",
  hash: "bbb222",
  via: "mattpocock",
};

function discovery(over: Partial<DiscoverySource> = {}): DiscoverySource {
  return {
    summon: async (handle) => ({ kind: "ok", handle, candidates: [AUTHORED, CURATED] }),
    searchPublic: async () => [AUTHORED],
    authorStanding: async () => ({ handle: "mattpocock" }),
    readPublicSkill: async () => null,
    ...over,
  };
}

async function call(name: Parameters<typeof callSummonTool>[0], args: unknown, d = discovery()) {
  const res = await callSummonTool(name, args, d);
  return { res, json: res.structuredContent as Record<string, unknown> };
}

describe("summon returns a person's public kit", () => {
  it("returns authored and curated skills together", async () => {
    const { json } = await call("summon", { handle: "mattpocock" });

    expect(json.found).toBe(true);
    expect((json.skills as unknown[]).length).toBe(2);
  });

  it("credits the true author for a curated skill, and names the curator separately", async () => {
    const { json } = await call("summon", { handle: "mattpocock" });
    const skills = json.skills as Record<string, unknown>[];

    // Collapsing ref and via would credit the curator for someone else's work.
    expect(skills[1].ref).toBe("shadcn/component-api");
    expect(skills[1].via).toBe("mattpocock");
    // An authored skill has no curator.
    expect(skills[0].ref).toBe("mattpocock/typescript-review");
    expect(skills[0].via).toBeNull();
  });

  it("hands back the version hash get_skill needs", async () => {
    const { json } = await call("summon", { handle: "mattpocock" });
    const skills = json.skills as Record<string, unknown>[];

    expect(skills[0].version_hash).toBe("aaa111");
    expect(skills[0].version_label).toBe("1.2.0");
    // Absent label is null, not undefined: the schema declares it nullable and
    // a dropped key reads to a client as a different shape.
    expect(skills[1].version_label).toBeNull();
  });

  it("treats @handle and handle as the same person", async () => {
    const seen: string[] = [];
    const d = discovery({
      summon: async (handle) => {
        seen.push(handle);
        return { kind: "ok", handle, candidates: [] };
      },
    });

    await call("summon", { handle: "@mattpocock" }, d);
    await call("summon", { handle: "mattpocock" }, d);

    expect(seen).toEqual(["mattpocock", "mattpocock"]);
  });
});

describe("the two empty answers stay distinct", () => {
  it("reports an unknown handle as not found, without erroring", async () => {
    const d = discovery({ summon: async (handle) => ({ kind: "unknown-handle", handle }) });
    const { res, json } = await call("summon", { handle: "nobody" }, d);

    // Not a tool error: the client should correct the spelling, and an error
    // result invites it to give up instead.
    expect(res.isError).toBeFalsy();
    expect(json.found).toBe(false);
    expect(json.skills).toEqual([]);
  });

  it("reports a real author who publishes nothing as found but empty", async () => {
    const d = discovery({ summon: async (handle) => ({ kind: "ok", handle, candidates: [] }) });
    const { json } = await call("summon", { handle: "quiet" }, d);

    // Distinct from the above: this one should send the client to search_public,
    // where an unknown handle should not.
    expect(json.found).toBe(true);
    expect(json.skills).toEqual([]);
  });
});

describe("summon rejects unsafe input before reaching the registry", () => {
  it("refuses a handle with path traversal", async () => {
    let reached = false;
    const d = discovery({
      summon: async (handle) => {
        reached = true;
        return { kind: "ok", handle, candidates: [] };
      },
    });

    await expect(call("summon", { handle: "../../etc" }, d)).rejects.toThrow();
    expect(reached).toBe(false);
  });
});

describe("the cross-author fallback", () => {
  it("searches everyone and returns the same candidate shape", async () => {
    const { json } = await call("search_public", { keywords: "changelog" });
    const skills = json.skills as Record<string, unknown>[];

    // Same shape as summon, so a client that parsed one can read the other.
    expect(skills[0].ref).toBe("mattpocock/typescript-review");
    expect(skills[0].version_hash).toBe("aaa111");
  });

  it("returns an empty set rather than an error when nothing matches", async () => {
    const d = discovery({ searchPublic: async () => [] });
    const { res, json } = await call("search_public", { keywords: "nothing" }, d);

    expect(res.isError).toBeFalsy();
    expect(json.skills).toEqual([]);
  });
});

describe("author standing never argues against the author", () => {
  it("omits counts that are zero", async () => {
    const d = discovery({
      authorStanding: async () => ({ handle: "new", bio: "Just arrived", installs: 0, summons: 0 }),
    });
    const { json } = await call("author_standing", { handle: "new" }, d);

    // "Used by 0 people" is an argument against the recommendation. At launch
    // every count is zero, so a zero must not reach the model at all.
    expect(json).not.toHaveProperty("installs");
    expect(json).not.toHaveProperty("summons");
    expect(json.bio).toBe("Just arrived");
  });

  it("reports counts that are real", async () => {
    const d = discovery({
      authorStanding: async () => ({ handle: "matt", installs: 412, summons: 38 }),
    });
    const { json } = await call("author_standing", { handle: "matt" }, d);

    expect(json.installs).toBe(412);
    expect(json.summons).toBe(38);
  });

  it("states mirror provenance instead of inventing standing", async () => {
    const d = discovery({
      authorStanding: async () => ({ handle: "flutter", mirrorSource: "github.com/flutter/flutter" }),
    });
    const { json } = await call("author_standing", { handle: "flutter" }, d);

    expect(json.mirror_source).toBe("github.com/flutter/flutter");
  });

  it("errors for an author who does not exist", async () => {
    const d = discovery({ authorStanding: async () => null });
    const { res } = await call("author_standing", { handle: "ghost" }, d);

    expect(res.isError).toBe(true);
  });
});
