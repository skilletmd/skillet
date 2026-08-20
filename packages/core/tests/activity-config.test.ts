// U8 — `skillet activity on|off|status` local config helpers.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setActivity, activityState } from "../src/metrics.js";

let home: string;

describe("activity config", () => {
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "skillet-home-"));
    process.env["SKILLET_DIR"] = home;
    delete process.env["SKILLET_ACTIVITY"];
  });
  afterEach(async () => {
    delete process.env["SKILLET_DIR"];
    delete process.env["SKILLET_ACTIVITY"];
    await rm(home, { recursive: true, force: true });
  });

  it("defaults to recording on with no config", async () => {
    expect(await activityState()).toMatchObject({ recording: true, source: "default" });
  });

  it("off persists activity:false and reads back as off", async () => {
    await setActivity(false);
    expect(await activityState()).toMatchObject({ recording: false, source: "config" });
    const cfg = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    expect(cfg.activity).toBe(false);
  });

  it("on persists activity:true and reads back as on", async () => {
    await setActivity(false);
    await setActivity(true);
    expect(await activityState()).toMatchObject({ recording: true, source: "config" });
  });

  it("SKILLET_ACTIVITY env overrides config and reports source 'env'", async () => {
    await setActivity(true);
    process.env["SKILLET_ACTIVITY"] = "0";
    expect(await activityState()).toMatchObject({ recording: false, source: "env" });
  });

  it("preserves other config keys when toggling", async () => {
    await setActivity(false); // writes config
    // simulate an existing disclosed flag
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(home, "config.json"), JSON.stringify({ activity: false, activityDisclosed: true }));
    await setActivity(true);
    const cfg = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    expect(cfg.activity).toBe(true);
    expect(cfg.activityDisclosed).toBe(true); // not clobbered
  });
});
