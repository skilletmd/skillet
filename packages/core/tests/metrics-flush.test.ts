// U9 — the activity sink flushes its buffered batch reliably and fail-silently.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recordEvent, flushEvents, reportAvailability } from "../src/metrics.js";

describe("flushEvents", () => {
  let posts: Array<{ url: string; body: unknown }>;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    posts = [];
    origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, opts: { body?: string } = {}) => {
      posts.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    process.env["SKILLET_TOKEN"] = "skillet_d_test"; // give flush a bearer
    process.env["SKILLET_ACTIVITY"] = "1"; // force recording ON (bypass config cache)
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env["SKILLET_TOKEN"];
    delete process.env["SKILLET_ACTIVITY"];
  });

  it("posts a buffered event on flush", async () => {
    recordEvent("sync", "human", { count: 1 });
    await flushEvents();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain("/api/v1/events");
    expect((posts[0].body as { events: Array<{ name: string }> }).events[0].name).toBe("sync");
  });

  it("empty queue → no network call", async () => {
    await flushEvents();
    expect(posts).toHaveLength(0);
  });

  it("private mode (opt-out) drops the queue without posting", async () => {
    process.env["SKILLET_ACTIVITY"] = "0";
    recordEvent("sync", "human");
    await flushEvents();
    expect(posts).toHaveLength(0);
  });

  it("a flush failure never throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    recordEvent("sync", "human");
    await expect(flushEvents()).resolves.toBeUndefined();
  });

  it("a second flush is a no-op (the queue was drained)", async () => {
    recordEvent("sync", "human");
    await flushEvents();
    await flushEvents();
    expect(posts).toHaveLength(1);
  });
});

describe("reportAvailability", () => {
  let posts: Array<{ url: string; body: { skill_refs: string[]; runtimes: string[] } }>;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    posts = [];
    origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, opts: { body?: string } = {}) => {
      posts.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : { skill_refs: [], runtimes: [] } });
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    process.env["SKILLET_TOKEN"] = "skillet_d_test";
    process.env["SKILLET_ACTIVITY"] = "1";
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env["SKILLET_TOKEN"];
    delete process.env["SKILLET_ACTIVITY"];
  });

  it("posts availability to /sync/availability", async () => {
    await reportAvailability(["@a/x"], ["claude", "codex"]);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain("/api/v1/sync/availability");
    expect(posts[0].body).toEqual({ skill_refs: ["@a/x"], runtimes: ["claude", "codex"] });
  });

  it("private mode (opt-out) sends nothing", async () => {
    process.env["SKILLET_ACTIVITY"] = "0";
    await reportAvailability(["@a/x"], ["claude"]);
    expect(posts).toHaveLength(0);
  });

  it("empty refs or runtimes send nothing", async () => {
    await reportAvailability([], ["claude"]);
    await reportAvailability(["@a/x"], []);
    expect(posts).toHaveLength(0);
  });
});
