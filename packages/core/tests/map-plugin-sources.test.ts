/**
 * Plugin sources for the map scan: where Claude Code and Codex plugins keep
 * their skills, and whether each plugin is on or off.
 *
 * Every fixture lives in a temp dir; nothing reads the real ~/.claude or
 * ~/.codex.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newestVersionFolder,
  parseClaudeEnabledPlugins,
  parseClaudeInstalledPlugins,
  parseCodexPluginConfig,
  readClaudePluginSources,
  readCodexPluginSources,
} from "../src/map/plugin-sources.js";
import { symlinksAvailable } from "./symlink-support.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skillet-map-plugins-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseClaudeInstalledPlugins", () => {
  it("splits user-scope installs from project and local ones (version 2)", () => {
    const parsed = parseClaudeInstalledPlugins({
      version: 2,
      plugins: {
        "alpha@market": [{ scope: "user", installPath: "/p/alpha/1.0.0", version: "1.0.0" }],
        "gamma@market": [
          { scope: "project", projectPath: "/proj", installPath: "/p/gamma/2.0.0", version: "2.0.0" },
        ],
        "both@market": [
          { scope: "user", installPath: "/p/both/1" },
          { scope: "local", projectPath: "/proj2", installPath: "/p/both/1" },
        ],
      },
    });
    expect(parsed.user).toEqual([
      { id: "alpha@market", name: "alpha", marketplace: "market", installPath: "/p/alpha/1.0.0", version: "1.0.0" },
      { id: "both@market", name: "both", marketplace: "market", installPath: "/p/both/1", version: null },
    ]);
    expect(parsed.other).toEqual([
      { id: "gamma@market", name: "gamma", marketplace: "market", scope: "project", projectPath: "/proj", installPath: "/p/gamma/2.0.0" },
      { id: "both@market", name: "both", marketplace: "market", scope: "local", projectPath: "/proj2", installPath: "/p/both/1" },
    ]);
  });

  it("reads the version 1 shape, where each plugin is one user-scope record", () => {
    const parsed = parseClaudeInstalledPlugins({
      version: 1,
      plugins: { "old@market": { installPath: "/p/old/0.1.0", version: "0.1.0" } },
    });
    expect(parsed.user).toEqual([
      { id: "old@market", name: "old", marketplace: "market", installPath: "/p/old/0.1.0", version: "0.1.0" },
    ]);
    expect(parsed.other).toEqual([]);
  });

  it("ignores anything that isn't the expected shape", () => {
    for (const junk of [null, [], "x", { plugins: "x" }, { plugins: { "a@b": [{ scope: "user" }] } }]) {
      expect(parseClaudeInstalledPlugins(junk)).toEqual({ user: [], other: [] });
    }
  });
});

describe("parseClaudeEnabledPlugins", () => {
  it("keeps only true/false values", () => {
    const enabled = parseClaudeEnabledPlugins({
      enabledPlugins: { "alpha@market": true, "beta@market": false, "weird@market": "yes" },
    });
    expect([...enabled.entries()]).toEqual([
      ["alpha@market", true],
      ["beta@market", false],
    ]);
    expect(parseClaudeEnabledPlugins(null).size).toBe(0);
    expect(parseClaudeEnabledPlugins({ enabledPlugins: [] }).size).toBe(0);
  });
});

describe("parseCodexPluginConfig", () => {
  it("reads each [plugins.\"<name>@<marketplace>\"] table's enabled flag and ignores the rest", () => {
    const toml = [
      'model = "gpt-test"',
      "enabled = true",
      "",
      '[plugins."delta@mkt"]',
      "enabled = true",
      "",
      "[plugins.'echo@mkt']   # single-quoted key",
      "enabled=false # trailing comment",
      "",
      '[plugins."foxtrot@mkt"]',
      "# no enabled key here",
      "",
      '[plugins."golf@mkt".mcp]',
      "enabled = false",
      "",
      "[profiles.default]",
      "enabled = true",
      "",
      "[[plugins]]",
      "enabled = false",
      "",
      "[plugins.hotel]",
      "enabled = true",
    ].join("\n");
    expect(parseCodexPluginConfig(toml)).toEqual([
      { id: "delta@mkt", name: "delta", marketplace: "mkt", enabled: true },
      { id: "echo@mkt", name: "echo", marketplace: "mkt", enabled: false },
      { id: "foxtrot@mkt", name: "foxtrot", marketplace: "mkt", enabled: null },
      { id: "hotel", name: "hotel", marketplace: null, enabled: true },
    ]);
  });

  it("handles Windows line endings and an empty file", () => {
    expect(parseCodexPluginConfig('[plugins."a@m"]\r\nenabled = false\r\n')).toEqual([
      { id: "a@m", name: "a", marketplace: "m", enabled: false },
    ]);
    expect(parseCodexPluginConfig("")).toEqual([]);
  });
});

describe("newestVersionFolder", () => {
  const v = (name: string, mtimeMs = 0) => ({ name, mtimeMs });

  it("compares versions by number, not by letter", () => {
    expect(newestVersionFolder([v("1.9.0"), v("1.10.0")])).toBe("1.10.0");
    expect(newestVersionFolder([v("26.1017.11052"), v("26.1013.40934")])).toBe("26.1017.11052");
    expect(newestVersionFolder([v("v2.0.0"), v("1.5.0")])).toBe("v2.0.0");
  });

  it("puts a release after its prerelease", () => {
    expect(newestVersionFolder([v("1.0.0"), v("1.0.0-beta")])).toBe("1.0.0");
  });

  it("prefers a real version over a name that isn't one, then the newest folder", () => {
    expect(newestVersionFolder([v("5fd93af4", 100), v("0.1.0", 50)])).toBe("0.1.0");
    expect(newestVersionFolder([v("latest", 100), v("1.10.0", 50), v("1.9.0", 200)])).toBe("1.10.0");
    expect(newestVersionFolder([v("aaa", 100), v("bbb", 200)])).toBe("bbb");
  });

  it("returns null when there are no folders", () => {
    expect(newestVersionFolder([])).toBeNull();
  });
});

describe("readClaudePluginSources", () => {
  async function installed(plugins: Record<string, unknown>, settings?: unknown): Promise<string> {
    const claudeDir = join(root, ".claude");
    await mkdir(join(claudeDir, "plugins"), { recursive: true });
    await writeFile(
      join(claudeDir, "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins }),
    );
    if (settings !== undefined) {
      await writeFile(join(claudeDir, "settings.json"), JSON.stringify(settings));
    }
    return claudeDir;
  }

  it("gives each user-scope plugin's skills folder with its on/off state", async () => {
    const alpha = join(root, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
    const beta = join(root, ".claude", "plugins", "cache", "market", "beta", "2.0.0");
    const unlisted = join(root, ".claude", "plugins", "cache", "market", "unlisted", "1.0.0");
    for (const dir of [alpha, beta, unlisted]) await mkdir(join(dir, "skills"), { recursive: true });
    const claudeDir = await installed(
      {
        "alpha@market": [{ scope: "user", installPath: alpha, version: "1.0.0" }],
        "beta@market": [{ scope: "user", installPath: beta, version: "2.0.0" }],
        "unlisted@market": [{ scope: "user", installPath: unlisted, version: "1.0.0" }],
      },
      { enabledPlugins: { "alpha@market": true, "beta@market": false } },
    );

    const result = await readClaudePluginSources({ claudeDir });
    expect(result.unreadable).toEqual([]);
    expect(result.sources).toEqual([
      {
        tool: "claude-code",
        owner: { kind: "plugin", name: "alpha", marketplace: "market", enabled: true },
        skillsDir: join(alpha, "skills"),
        version: "1.0.0",
      },
      {
        tool: "claude-code",
        owner: { kind: "plugin", name: "beta", marketplace: "market", enabled: false },
        skillsDir: join(beta, "skills"),
        version: "2.0.0",
      },
      {
        tool: "claude-code",
        owner: { kind: "plugin", name: "unlisted", marketplace: "market", enabled: null },
        skillsDir: join(unlisted, "skills"),
        version: "1.0.0",
      },
    ]);
  });

  it("puts project-scope plugins and missing installs in the unreadable list", async () => {
    const gone = join(root, ".claude", "plugins", "cache", "market", "gone", "1.0.0");
    const claudeDir = await installed({
      "gamma@market": [{ scope: "project", projectPath: join(root, "proj"), installPath: join(root, "x") }],
      "gone@market": [{ scope: "user", installPath: gone }],
    });
    const result = await readClaudePluginSources({ claudeDir });
    expect(result.sources).toEqual([]);
    // User-scope installs come first, then the other scopes, each in file order.
    expect(result.unreadable).toEqual([
      { path: gone, reason: "plugin-missing", tools: ["claude-code"], plugin: "gone@market" },
      {
        path: join(root, "proj"),
        reason: "project-plugin",
        tools: ["claude-code"],
        plugin: "gamma@market",
        detail: "project",
      },
    ]);
  });

  it("names a broken plugins file instead of throwing, and an empty Claude folder gives nothing", async () => {
    const claudeDir = join(root, ".claude");
    expect(await readClaudePluginSources({ claudeDir })).toEqual({ sources: [], unreadable: [] });

    await mkdir(join(claudeDir, "plugins"), { recursive: true });
    await writeFile(join(claudeDir, "plugins", "installed_plugins.json"), "{not json");
    const result = await readClaudePluginSources({ claudeDir });
    expect(result.sources).toEqual([]);
    expect(result.unreadable).toEqual([
      {
        path: join(claudeDir, "plugins", "installed_plugins.json"),
        reason: "unparseable",
        tools: ["claude-code"],
      },
    ]);
  });

  it("an unreadable settings file leaves every plugin's state unknown and says so", async () => {
    const alpha = join(root, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
    await mkdir(join(alpha, "skills"), { recursive: true });
    const claudeDir = await installed({ "alpha@market": [{ scope: "user", installPath: alpha }] });
    await writeFile(join(claudeDir, "settings.json"), "{broken");
    const result = await readClaudePluginSources({ claudeDir });
    expect(result.sources.map((s) => s.owner.enabled)).toEqual([null]);
    expect(result.unreadable).toEqual([
      { path: join(claudeDir, "settings.json"), reason: "unparseable", tools: ["claude-code"] },
    ]);
  });

  it("asks the gate before reading, and a refused file is listed rather than read", async () => {
    const alpha = join(root, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
    await mkdir(join(alpha, "skills"), { recursive: true });
    const claudeDir = await installed({ "alpha@market": [{ scope: "user", installPath: alpha }] });
    const asked: string[] = [];
    const result = await readClaudePluginSources({
      claudeDir,
      gate: (path) => {
        asked.push(path);
        return "protected-folder";
      },
    });
    expect(asked).toEqual([join(claudeDir, "plugins", "installed_plugins.json")]);
    expect(result).toEqual({
      sources: [],
      unreadable: [
        {
          path: join(claudeDir, "plugins", "installed_plugins.json"),
          reason: "protected-folder",
          tools: ["claude-code"],
        },
      ],
    });
  });
});

describe("readCodexPluginSources", () => {
  it("reads the newest version folder of each configured plugin", async () => {
    const codexDir = join(root, ".codex");
    const plugin = join(codexDir, "plugins", "cache", "mkt", "delta");
    await mkdir(join(plugin, "1.9.0", "skills"), { recursive: true });
    await mkdir(join(plugin, "1.10.0", "skills"), { recursive: true });
    if (symlinksAvailable) await symlink(join(plugin, "1.10.0"), join(plugin, "latest"), "dir");
    await writeFile(
      join(codexDir, "config.toml"),
      '[plugins."delta@mkt"]\nenabled = true\n\n[plugins."echo@mkt"]\nenabled = false\n',
    );
    await mkdir(join(codexDir, "plugins", "cache", "mkt", "echo", "0.1.0", "skills"), { recursive: true });

    const result = await readCodexPluginSources({ codexDir });
    expect(result.unreadable).toEqual([]);
    expect(result.sources).toEqual([
      {
        tool: "codex",
        owner: { kind: "plugin", name: "delta", marketplace: "mkt", enabled: true },
        skillsDir: join(plugin, "1.10.0", "skills"),
        version: "1.10.0",
      },
      {
        tool: "codex",
        owner: { kind: "plugin", name: "echo", marketplace: "mkt", enabled: false },
        skillsDir: join(codexDir, "plugins", "cache", "mkt", "echo", "0.1.0", "skills"),
        version: "0.1.0",
      },
    ]);
  });

  it("lists a configured plugin with no files, or a name it can't use as a folder, as unreadable", async () => {
    const codexDir = join(root, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "config.toml"),
      '[plugins."ghost@mkt"]\nenabled = true\n[plugins."../evil@mkt"]\nenabled = true\n[plugins.bare]\nenabled = true\n',
    );
    const result = await readCodexPluginSources({ codexDir });
    expect(result.sources).toEqual([]);
    expect(result.unreadable).toEqual([
      {
        path: join(codexDir, "plugins", "cache", "mkt", "ghost"),
        reason: "plugin-missing",
        tools: ["codex"],
        plugin: "ghost@mkt",
      },
      { path: join(codexDir, "config.toml"), reason: "unparseable", tools: ["codex"], plugin: "../evil@mkt" },
      { path: join(codexDir, "config.toml"), reason: "unparseable", tools: ["codex"], plugin: "bare" },
    ]);
  });

  it("no config file means no Codex plugins, and no error", async () => {
    expect(await readCodexPluginSources({ codexDir: join(root, ".codex") })).toEqual({
      sources: [],
      unreadable: [],
    });
  });
});
