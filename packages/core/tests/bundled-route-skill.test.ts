import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalContentHash } from "@skillet/protocol";
import { readBundleFromDir } from "../src/bundle/read.js";
import {
  BUNDLED_ROUTE_SLUG,
  ensureBundledRouteSkill,
} from "../src/commands/bundled-route-skill.js";
import { readState, skillContentPath } from "../src/kit/store.js";

const TEST_ROOT = vi.hoisted(() => {
  const osMod = require("node:os") as typeof import("node:os");
  const cryptoMod = require("node:crypto") as typeof import("node:crypto");
  const pathMod = require("node:path") as typeof import("node:path");
  const root = pathMod.join(
    osMod.tmpdir(),
    `skillet-bundled-route-test-${cryptoMod.randomBytes(4).toString("hex")}`,
  );
  process.env["HOME"] = root;
  process.env["SKILLET_DIR"] = pathMod.join(root, ".skillet");
  return root;
});

const BUNDLED_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../cli/bundled-skills/skillet-route",
);

describe("bundled route skill asset", () => {
  it("passes bundle validation", async () => {
    const bundle = await readBundleFromDir(BUNDLED_DIR);
    expect(bundle.has("SKILL.md")).toBe(true);
    const body = Buffer.from(bundle.get("SKILL.md")!).toString("utf8");
    expect(body).toMatch(/Searching/);
    expect(body).toMatch(/skillet route manifest/);
    expect(body).toMatch(/skillet route record/);
    expect(body).toMatch(/user-invocable:\s*true/);
  });
});

describe("ensureBundledRouteSkill", () => {
  beforeEach(async () => {
    await mkdir(join(TEST_ROOT, ".skillet", "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("installs @skillet/route into the kit", async () => {
    const result = await ensureBundledRouteSkill(BUNDLED_DIR);
    expect(result).toBe("installed");
    const state = await readState();
    expect(state.skills[BUNDLED_ROUTE_SLUG]).toBeDefined();
    await readFile(skillContentPath(BUNDLED_ROUTE_SLUG), "utf8");
  });

  it("is unchanged on a second run with the same bundle", async () => {
    await ensureBundledRouteSkill(BUNDLED_DIR);
    const result = await ensureBundledRouteSkill(BUNDLED_DIR);
    expect(result).toBe("unchanged");
  });

  it("reinstalls when bundle files were deleted", async () => {
    await ensureBundledRouteSkill(BUNDLED_DIR);
    await rm(skillContentPath(BUNDLED_ROUTE_SLUG));
    const bundle = await readBundleFromDir(BUNDLED_DIR);
    const hash = canonicalContentHash(bundle);
    const state = await readState();
    expect(state.skills[BUNDLED_ROUTE_SLUG]?.hash).toBe(hash);
    const result = await ensureBundledRouteSkill(BUNDLED_DIR);
    expect(result).toBe("updated");
    await readFile(skillContentPath(BUNDLED_ROUTE_SLUG), "utf8");
  });

  it("falls back to inlined SKILL.md when the bundle dir is absent (sidecar)", async () => {
    // The pkg sidecar has no bundled-skills on disk; the CLI passes the SKILL.md
    // inlined at bundle time. A non-existent dir must still materialize the skill.
    const inline = await readFile(join(BUNDLED_DIR, "SKILL.md"), "utf8");
    const result = await ensureBundledRouteSkill("/no/such/dir/bundled-skills", inline);
    expect(result).toBe("installed");
    const state = await readState();
    expect(state.skills[BUNDLED_ROUTE_SLUG]).toBeDefined();
    const body = await readFile(skillContentPath(BUNDLED_ROUTE_SLUG), "utf8");
    expect(body).toMatch(/skillet route manifest/);
  });

  it("throws when neither the dir nor inline content is available", async () => {
    await expect(ensureBundledRouteSkill("/no/such/dir")).rejects.toThrow();
  });
});
