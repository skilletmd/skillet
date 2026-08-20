import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordLocalRoute,
  readRouteHistory,
  rankSkillRefs,
  usageViews,
  exportRecord,
  clearRouteHistory,
  USAGE_DEADWEIGHT_DAYS,
  type RouteHistory,
} from "./route-history.js";

let dir: string;
let priorEnv: string | undefined;

beforeEach(async () => {
  priorEnv = process.env["SKILLET_DIR"];
  dir = await mkdtemp(join(tmpdir(), "skillet-route-history-"));
  process.env["SKILLET_DIR"] = dir;
});

afterEach(async () => {
  if (priorEnv === undefined) delete process.env["SKILLET_DIR"];
  else process.env["SKILLET_DIR"] = priorEnv;
  await rm(dir, { recursive: true, force: true });
});

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe("route-history store", () => {
  it("returns a well-formed empty history on a fresh machine", async () => {
    const h = await readRouteHistory();
    expect(h.skills).toEqual({});
  });

  it("increments count and per-runtime count, advances lastUsed, sets firstUsed once", async () => {
    const t2 = daysAgo(2);
    const t1 = daysAgo(1);
    await recordLocalRoute({ skillRef: "@a/x", runtime: "cursor", ts: t2 });
    await recordLocalRoute({ skillRef: "@a/x", runtime: "claude-code", ts: t1 });
    const h = await readRouteHistory();
    const s = h.skills["@a/x"]!;
    expect(s.count).toBe(2);
    expect(s.runtimes).toEqual({ cursor: 1, "claude-code": 1 });
    expect(s.firstUsed).toBe(t2);
    expect(s.lastUsed).toBe(t1);
  });

  it("ranks by count desc, then lastUsed desc, then skillRef asc (R10)", async () => {
    await recordLocalRoute({ skillRef: "@a/low", ts: daysAgo(1) });
    await recordLocalRoute({ skillRef: "@a/high", ts: daysAgo(5) });
    await recordLocalRoute({ skillRef: "@a/high", ts: daysAgo(4) });
    const h = await readRouteHistory();
    const ranked = rankSkillRefs(["@a/low", "@a/high"], h);
    expect(ranked).toEqual(["@a/high", "@a/low"]); // high has count 2
  });

  it("breaks a count tie by most-recent lastUsed", async () => {
    const h: RouteHistory = {
      version: 1,
      skills: {
        "@a/old": { count: 2, firstUsed: daysAgo(9), lastUsed: daysAgo(9), runtimes: {} },
        "@a/new": { count: 2, firstUsed: daysAgo(9), lastUsed: daysAgo(1), runtimes: {} },
      },
    };
    expect(rankSkillRefs(["@a/old", "@a/new"], h)).toEqual(["@a/new", "@a/old"]);
  });

  it("collapses to skillRef-ascending when there is no history (deterministic fallback, R11)", async () => {
    const h = await readRouteHistory();
    const ranked = rankSkillRefs(["@z/b", "@a/a", "@m/m"], h);
    expect(ranked).toEqual(["@a/a", "@m/m", "@z/b"]);
  });

  it("sorts a kit skill absent from history after ranked skills, in skillRef order", async () => {
    await recordLocalRoute({ skillRef: "@used/skill", ts: daysAgo(1) });
    const h = await readRouteHistory();
    const ranked = rankSkillRefs(["@zzz/never", "@used/skill", "@aaa/never"], h);
    expect(ranked).toEqual(["@used/skill", "@aaa/never", "@zzz/never"]);
  });

  it("flags a skill last routed past the dead-weight window, not one inside it", async () => {
    await recordLocalRoute({ skillRef: "@old/x", ts: daysAgo(USAGE_DEADWEIGHT_DAYS + 1) });
    await recordLocalRoute({ skillRef: "@new/x", ts: daysAgo(USAGE_DEADWEIGHT_DAYS - 1) });
    const h = await readRouteHistory();
    const views = usageViews(h);
    expect(views.find((v) => v.skillRef === "@old/x")!.deadWeight).toBe(true);
    expect(views.find((v) => v.skillRef === "@new/x")!.deadWeight).toBe(false);
  });

  it("firewall: drops non-allow-listed fields and sanitizes retained values (R12)", async () => {
    await recordLocalRoute({
      skillRef: "@a/x",
      runtime: "Cursor IDE — v2 (secret task text)",
      // @ts-expect-error — a caller trying to smuggle content must not persist it
      task: "book a flight to Paris for my boss",
    });
    const raw = await readFile(join(dir, "route-history.json"), "utf8");
    expect(raw).not.toContain("Paris");
    expect(raw).not.toContain("book a flight");
    const h = await readRouteHistory();
    // runtime value is charset+length sanitized, not the raw free-text string
    expect(Object.keys(h.skills["@a/x"]!.runtimes)[0]).toMatch(/^[a-z0-9._-]+$/);
  });

  it("exports version + skills, no other keys leave the machine", async () => {
    await recordLocalRoute({ skillRef: "@a/x" });
    const exported = exportRecord(await readRouteHistory());
    expect(Object.keys(exported).sort()).toEqual(["skills", "version"]);
    expect(exported.skills["@a/x"]!.count).toBe(1);
  });

  it("survives a corrupt history file without throwing", async () => {
    await recordLocalRoute({ skillRef: "@a/x" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "route-history.json"), "{ not json", "utf8");
    const h = await readRouteHistory();
    expect(h.skills).toEqual({});
  });

  it("ignores extra fields from a newer writer (forward-compatible read)", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "route-history.json"),
      JSON.stringify({
        version: 2,
        skills: { "@a/x": { count: 1, firstUsed: daysAgo(1), lastUsed: daysAgo(1), runtimes: {}, futureField: 3 } },
        futureTopLevel: { anything: true },
      }),
      "utf8",
    );
    const h = await readRouteHistory();
    expect(h.skills["@a/x"]!.count).toBe(1); // reads cleanly despite unknown fields from a newer writer
    expect(rankSkillRefs(["@a/x"], h)).toEqual(["@a/x"]);
  });

  it("clears the local history", async () => {
    await recordLocalRoute({ skillRef: "@a/x" });
    await clearRouteHistory();
    const h = await readRouteHistory();
    expect(h.skills).toEqual({});
  });
});
