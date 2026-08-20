import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// metrics.ts reads config via skilletDir() (dynamic), but we set env before
// import for consistency with the rest of the suite.
let dir: string;
let metrics: typeof import("./metrics.js");
let priorEnv: Record<string, string | undefined> = {};

async function readConfig(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

beforeAll(async () => {
  for (const k of ["SKILLET_DIR", "SKILLET_ACTIVITY", "SKILLET_TOKEN", "CI"]) {
    priorEnv[k] = process.env[k];
  }
  metrics = await import("./metrics.js");
});

afterAll(async () => {
  for (const [k, v] of Object.entries(priorEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "skillet-consent-"));
  process.env["SKILLET_DIR"] = dir;
  delete process.env["SKILLET_ACTIVITY"];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("first-run route consent (U4)", () => {
  it("routeConsentChosen starts false on a fresh machine", async () => {
    expect(await metrics.routeConsentChosen()).toBe(false);
    expect((await metrics.activityState()).routeConsentChosen).toBe(false);
  });

  it("chooseRouteConsent(record) sets activity + marks the choice made", async () => {
    await metrics.chooseRouteConsent(true);
    expect(await metrics.routeConsentChosen()).toBe(true);
    const cfg = await readConfig();
    expect(cfg["activity"]).toBe(true);
    expect(cfg["routeConsentChosen"]).toBe(true);
  });

  it("chooseRouteConsent(false) records the stay-local choice: activity off, choice made", async () => {
    await metrics.chooseRouteConsent(false);
    const cfg = await readConfig();
    expect(cfg["activity"]).toBe(false);
    expect(cfg["routeConsentChosen"]).toBe(true);
  });
});

describe("route-event upload gate (U4/R1)", () => {
  it("does NOT upload skill.route events until the consent choice is made, even though activity defaults ON", async () => {
    process.env["SKILLET_TOKEN"] = "tok"; // account-bound
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    // Fresh machine: activity is default-ON, but routeConsentChosen is false.
    expect((await metrics.activityState()).recording).toBe(true);
    metrics.recordEvent("skill.route", "human", { skill_ref: "@a/x" });
    await metrics.flushEvents();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uploads skill.route events once the record choice is made", async () => {
    process.env["SKILLET_TOKEN"] = "tok";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await metrics.chooseRouteConsent(true);
    metrics.recordEvent("skill.route", "human", { skill_ref: "@a/x" });
    await metrics.flushEvents();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("still uploads non-route events (e.g. sync) regardless of the route-consent gate", async () => {
    process.env["SKILLET_TOKEN"] = "tok";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    metrics.recordEvent("sync", "human", {});
    await metrics.flushEvents();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
