import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// store.ts captures SKILLET_DIR as a load-time const, so the dir must be set
// BEFORE the modules are imported — hence dynamic import in beforeAll.
let dir: string;
let route: typeof import("./route.js");
let store: typeof import("../kit/store.js");
let history: typeof import("../kit/route-history.js");
let metrics: typeof import("../metrics.js");
let priorEnv: string | undefined;
let priorActivity: string | undefined;

async function seedKit() {
  // Clear the store, not just kit state. The manifest treats anything readable
  // on disk as a routing candidate (authored skills never get a state entry),
  // so a skill dir left by an earlier test would leak into the next one.
  await rm(join(dir, "skills"), { recursive: true, force: true });
  await store.writeState({
    version: 1,
    artifact_schema_version: 1,
    skills: {
      x: { slug: "x", owner: "a", name: "Skill X", description: "does x", hash: "sha256:x" },
      y: { slug: "y", owner: "a", name: "Skill Y", description: "does y", hash: "sha256:y" },
    },
  } as never);
  for (const slug of ["x", "y"]) {
    await mkdir(join(dir, "skills", slug), { recursive: true });
    await writeFile(join(dir, "skills", slug, "SKILL.md"), "---\nname: s\n---\n", "utf8");
  }
}

beforeAll(async () => {
  priorEnv = process.env["SKILLET_DIR"];
  priorActivity = process.env["SKILLET_ACTIVITY"];
  dir = await mkdtemp(join(tmpdir(), "skillet-route-cmd-"));
  process.env["SKILLET_DIR"] = dir;
  process.env["SKILLET_ACTIVITY"] = "0"; // anonymous / opt-out
  store = await import("../kit/store.js");
  route = await import("./route.js");
  history = await import("../kit/route-history.js");
  metrics = await import("../metrics.js");
});

afterAll(async () => {
  if (priorEnv === undefined) delete process.env["SKILLET_DIR"];
  else process.env["SKILLET_DIR"] = priorEnv;
  if (priorActivity === undefined) delete process.env["SKILLET_ACTIVITY"];
  else process.env["SKILLET_ACTIVITY"] = priorActivity;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await seedKit();
  await history.clearRouteHistory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordSkillRoute — local history write (U2)", () => {
  it("writes a content-free local row even when anonymous, and uploads nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await route.recordSkillRoute("@a/x", { runtime: "cursor" });
    expect(res.skillRef).toBe("@a/x");

    const h = await history.readRouteHistory();
    expect(h.skills["@a/x"]!.count).toBe(1);
    expect(h.skills["@a/x"]!.runtimes).toEqual({ cursor: 1 });
    // No task/rationale text ever enters the store (R12).
    const persisted = JSON.stringify(h);
    expect(persisted).not.toMatch(/task|prompt|rationale/i);

    // Let the (best-effort) flush timer fire; anonymous mode must not upload.
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws skill_not_in_kit for an unknown ref without writing history", async () => {
    await expect(route.recordSkillRoute("@a/nope")).rejects.toMatchObject({
      code: "skill_not_in_kit",
    });
    const h = await history.readRouteHistory();
    expect(h.skills["@a/nope"]).toBeUndefined();
  });

  it("uploads the pick only for registry skills; local skills stay on the machine (local history for both)", async () => {
    // A registry skill (public ref) and a local-only skill (user-authored ref).
    await store.writeState({
      version: 1,
      artifact_schema_version: 1,
      skills: {
        x: { slug: "x", owner: "a", name: "X", description: "x", hash: "sha256:x", source: "registry" },
        "my-private-thing": {
          slug: "my-private-thing",
          name: "Private",
          description: "local only",
          hash: "sha256:z",
          source: "local",
        },
      },
    } as never);
    await mkdir(join(dir, "skills", "my-private-thing"), { recursive: true });
    await writeFile(join(dir, "skills", "my-private-thing", "SKILL.md"), "---\nname: s\n---\n", "utf8");

    const spy = vi.spyOn(metrics, "recordEvent");
    await route.recordSkillRoute("@a/x"); // registry → uploads
    await route.recordSkillRoute("my-private-thing"); // local → no upload

    const routeEvents = spy.mock.calls.filter((c) => c[0] === "skill.route");
    expect(routeEvents).toHaveLength(1);
    expect(routeEvents[0]![2]).toEqual({ skill_ref: "@a/x" });

    // Local history records BOTH — the dashboard stays complete.
    const h = await history.readRouteHistory();
    expect(h.skills["@a/x"]!.count).toBe(1);
    expect(h.skills["my-private-thing"]!.count).toBe(1);
  });
});

describe("listRouteManifest — usage-ranked order (U3)", () => {
  it("orders by invocation count desc, not alphabetically (R10)", async () => {
    // @a/y is alphabetically last but more-used → must rank first.
    await route.recordSkillRoute("@a/y");
    await route.recordSkillRoute("@a/y");
    await route.recordSkillRoute("@a/x");
    const manifest = await route.listRouteManifest();
    expect(manifest.map((m) => m.skillRef)).toEqual(["@a/y", "@a/x"]);
  });

  it("collapses to alphabetical order with no history (deterministic fallback, R11)", async () => {
    const manifest = await route.listRouteManifest();
    expect(manifest.map((m) => m.skillRef)).toEqual(["@a/x", "@a/y"]);
  });
});
