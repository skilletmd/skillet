/**
 * The map scan's folder rules (plan: Folder rules table, KTD2). Pure name
 * logic, no filesystem: which folders count as skills, their source, what
 * Remove may do, and whether they back up.
 */
import { describe, it, expect } from "vitest";
import {
  MAP_SOURCE_RULES,
  UNIVERSAL_SKILLS_READERS,
  dominantSource,
  isSkippedName,
  ruleForContainer,
  ruleForSkillFolder,
} from "../src/map/folder-rules.js";

describe("MAP_SOURCE_RULES", () => {
  it("matches the plan's table: only local skills back up, and Remove differs per source", () => {
    expect(MAP_SOURCE_RULES).toEqual({
      local: { remove: "trash", backsUp: true },
      "skillet-imported": { remove: "leave-kit-store", backsUp: false },
      "skillet-added": { remove: "kit-removal", backsUp: false },
      "skillet-own": { remove: "name-skill-page", backsUp: false },
      synced: { remove: "name-organization", backsUp: false },
      app: { remove: "name-folder", backsUp: false },
      plugin: { remove: "name-plugin", backsUp: false },
    });
  });
});

describe("isSkippedName", () => {
  it("skips dot-folders anywhere", () => {
    expect(isSkippedName(".trash")).toBe(true);
    expect(isSkippedName(".git")).toBe(true);
    expect(isSkippedName(".system")).toBe(true);
    expect(isSkippedName(".DS_Store")).toBe(true);
  });

  it("skips Skillet's router skill in every layout it was written in", () => {
    expect(isSkippedName("skillet")).toBe(true);
    expect(isSkippedName("skillet--route")).toBe(true);
    expect(isSkippedName("@skillet--route")).toBe(true);
  });

  it("keeps ordinary skills, including Skillet's other bundled names", () => {
    expect(isSkippedName("agent-browser")).toBe(false);
    expect(isSkippedName("skillet-create")).toBe(false);
    expect(isSkippedName("_local--agent-browser")).toBe(false);
  });
});

describe("ruleForSkillFolder", () => {
  it("a plain folder is local", () => {
    expect(ruleForSkillFolder("agent-browser", null)).toEqual({
      source: "local",
      slug: "agent-browser",
      maker: null,
    });
  });

  it("_local--<slug> is Skillet-managed, imported", () => {
    expect(ruleForSkillFolder("_local--agent-browser", null)).toEqual({
      source: "skillet-imported",
      slug: "agent-browser",
      maker: null,
    });
  });

  it("<owner>--<slug> from another maker is Skillet-managed, added", () => {
    expect(ruleForSkillFolder("alice--festival-ops", "test-handle")).toEqual({
      source: "skillet-added",
      slug: "festival-ops",
      maker: "alice",
    });
    expect(ruleForSkillFolder("@alice--festival-ops", null)).toEqual({
      source: "skillet-added",
      slug: "festival-ops",
      maker: "alice",
    });
  });

  it("<you>--<slug> is the person's own skill, with or without the @", () => {
    expect(ruleForSkillFolder("test-handle--festival-ops", "test-handle").source).toBe("skillet-own");
    expect(ruleForSkillFolder("@test-handle--festival-ops", "@test-handle").source).toBe("skillet-own");
    expect(ruleForSkillFolder("test-handle--festival-ops", "Test-Handle").source).toBe("skillet-own");
  });

  it("a name that only looks like owner--slug, with an owner no handle could have, stays local", () => {
    expect(ruleForSkillFolder("My Notes--v2", null)).toEqual({
      source: "local",
      slug: "My Notes--v2",
      maker: null,
    });
  });
});

describe("ruleForContainer", () => {
  it("synced/ in Claude Code's folder holds organization skills", () => {
    expect(ruleForContainer("claude", "synced")).toEqual({ kind: "synced" });
  });

  it("synced/ in another tool's folder is just an app folder", () => {
    expect(ruleForContainer("universal", "synced")).toEqual({ kind: "app", app: "synced" });
  });

  it("@owner/ is Skillet's owner namespace", () => {
    expect(ruleForContainer("claude", "@alice")).toEqual({ kind: "maker", maker: "alice" });
    expect(ruleForContainer("other", "@alice")).toEqual({ kind: "maker", maker: "alice" });
  });

  it("any other folder with skills below it belongs to the app that put it there", () => {
    expect(ruleForContainer("claude", "someapp")).toEqual({ kind: "app", app: "someapp" });
    expect(ruleForContainer("codex", "@")).toEqual({ kind: "app", app: "@" });
  });
});

describe("dominantSource", () => {
  it("an outside owner wins over Skillet, and Skillet wins over a loose copy", () => {
    expect(dominantSource(["local", "plugin"])).toBe("plugin");
    expect(dominantSource(["local", "synced"])).toBe("synced");
    expect(dominantSource(["app", "skillet-own"])).toBe("app");
    expect(dominantSource(["local", "skillet-imported"])).toBe("skillet-imported");
    expect(dominantSource(["skillet-imported", "skillet-added"])).toBe("skillet-added");
    expect(dominantSource(["skillet-added", "skillet-own"])).toBe("skillet-own");
    expect(dominantSource(["local", "local"])).toBe("local");
  });
});

describe("UNIVERSAL_SKILLS_READERS", () => {
  it("names the tools that load ~/.agents/skills", () => {
    expect([...UNIVERSAL_SKILLS_READERS]).toEqual(["codex", "opencode", "cursor"]);
  });
});
