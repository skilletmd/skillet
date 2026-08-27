/**
 * The library fall-through, which was silently returning nothing in production.
 *
 * Three independent breaks, each enough on its own to empty the result:
 *   1. Keywords were joined into one `q`. The registry matches `q` as a literal
 *      substring, so "changelog release notes" asked for a phrase no skill
 *      contains. The router's own instructions say to compose up to three
 *      keywords, so this was every search it ever issued.
 *   2. The reader looked for `body.skills`. `/search` answers `body.groups.skills`.
 *   3. Search rows carry `author`/`slug` and no `latest_hash`, and a candidate
 *      without a pinned hash is not loadable.
 *
 * These pin all three, plus the relevance floor that keeps a shared-word
 * coincidence from being applied to someone's task as if it fit.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchPublicSkills, RELEVANCE_FLOOR } from "../src/commands/summon.js";

interface Row {
  author: string;
  slug: string;
  description?: string;
  score?: number;
  install_count?: number;
}

/** Serve `/search` per keyword and `/skills/:a/:s` for the hash lookup. */
function stubRegistry(byQuery: Record<string, Row[]>, opts: { hash?: string | null } = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    calls.push(u);
    const search = /\/search\?q=([^&]+)/.exec(u);
    if (search) {
      const q = decodeURIComponent(search[1]!);
      return {
        ok: true,
        json: async () => ({ query: q, groups: { skills: byQuery[q] ?? [] } }),
      };
    }
    if (/\/skills\//.test(u)) {
      const hash = opts.hash === undefined ? "sha256:abc" : opts.hash;
      return { ok: true, json: async () => (hash ? { latest_hash: hash } : {}) };
    }
    return { ok: false, status: 404 };
  }) as unknown as typeof fetch;
  return calls;
}

const row = (author: string, slug: string, score = 1): Row => ({
  author,
  slug,
  description: `${slug} does a thing`,
  score,
  install_count: 0,
});

describe("searchPublicSkills", () => {
  let origFetch: typeof globalThis.fetch;
  beforeEach(() => {
    origFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("sends one request per keyword, never a joined phrase", async () => {
    const calls = stubRegistry({ changelog: [row("phuryn", "release-notes")] });
    await searchPublicSkills(["changelog", "release", "notes"]);

    const queries = calls
      .map((u) => /\/search\?q=([^&]+)/.exec(u)?.[1])
      .filter(Boolean)
      .map((q) => decodeURIComponent(q!));
    expect(queries).toEqual(["changelog", "release", "notes"]);
    expect(queries).not.toContain("changelog release notes");
  });

  it("reads groups.skills, the shape /search actually answers", async () => {
    stubRegistry({ review: [row("garrytan", "review")] });
    const out = await searchPublicSkills(["review"]);
    expect(out.map((c) => c.ref)).toEqual(["@garrytan/review"]);
  });

  it("resolves the pinned hash the load path needs", async () => {
    stubRegistry({ review: [row("garrytan", "review")] }, { hash: "sha256:deadbeef" });
    const [candidate] = await searchPublicSkills(["review"]);
    expect(candidate!.latestHash).toBe("sha256:deadbeef");
  });

  it("drops a candidate with no pinned version, however well it matched", async () => {
    stubRegistry({ review: [row("garrytan", "review")] }, { hash: null });
    expect(await searchPublicSkills(["review"])).toEqual([]);
  });

  it("ranks a ref that answers more keywords above one that answers fewer", async () => {
    stubRegistry({
      blog: [row("a", "narrow", 1)],
      writing: [row("b", "broad", 0.75)],
      post: [row("b", "broad", 0.75)],
    });
    const out = await searchPublicSkills(["blog", "writing", "post"]);
    expect(out[0]!.ref).toBe("@b/broad");
  });

  it("suppresses a shared-word coincidence below the relevance floor", async () => {
    stubRegistry({
      contract: [row("x", "summarize-meeting", RELEVANCE_FLOOR - 0.25)],
    });
    // Better to admit there is no skill for this than to apply the wrong one.
    expect(await searchPublicSkills(["contract"])).toEqual([]);
  });

  it("deduplicates keywords so one term cannot inflate match breadth", async () => {
    const calls = stubRegistry({ review: [row("garrytan", "review")] });
    await searchPublicSkills(["Review", "review", " REVIEW "]);
    const searches = calls.filter((u) => u.includes("/search?q="));
    expect(searches).toHaveLength(1);
  });

  it("returns nothing for empty keywords without calling the registry", async () => {
    const calls = stubRegistry({});
    expect(await searchPublicSkills(["  ", ""])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("survives a registry failure by returning no candidates", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await searchPublicSkills(["review"])).toEqual([]);
  });
});
