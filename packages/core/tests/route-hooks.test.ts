import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureCodexHooksFeatureFlag,
  hookRuntimesFromDetected,
  installClaudeCodeRouteHook,
  installCodexRouteHook,
  installRouteHook,
  installRouteHooksForRuntimes,
} from "../src/commands/route-hooks/index.js";
import { installCursorRouteHook } from "../src/commands/cursor-hook.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "skillet-route-hooks-"));
}

describe("hookRuntimesFromDetected", () => {
  it("maps adapter names to hook installer keys", () => {
    expect(hookRuntimesFromDetected(["cursor", "claude-code", "codex-project"])).toEqual([
      "cursor",
      "claude-code",
      "codex",
    ]);
    expect(hookRuntimesFromDetected(["hermes", "openclaw"])).toEqual([]);
  });
});

describe("installRouteHook orchestrator", () => {
  it("skips unknown runtime without throwing", async () => {
    const result = await installRouteHook("hermes", { recorderCommand: "/bin/skillet" });
    expect(result.installed).toBe(false);
    expect(result.error).toMatch(/unsupported runtime/);
  });

  it("installs cursor and claude hooks in one batch", async () => {
    const root = await tmp();
    const cursorDir = join(root, "cursor");
    const claudeDir = join(root, "claude");
    try {
      const result = await installRouteHooksForRuntimes(["cursor", "claude-code"], {
        recorderCommand: "/bin/skillet",
        cursorDir,
        claudeDir,
      });
      expect(result.installed).toEqual(["cursor", "claude-code"]);
      expect(result.warnings).toEqual([]);

      const cursorHooks = JSON.parse(await readFile(join(cursorDir, "hooks.json"), "utf8")) as {
        hooks: Record<string, Array<{ command: string }>>;
      };
      expect(cursorHooks.hooks.beforeSubmitPrompt?.some((e) => e.command.includes("route hook"))).toBe(
        true,
      );

      const claudeSettings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      const claudeHook = claudeSettings.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command ?? "";
      expect(claudeHook).toContain("route hook --runtime claude-code");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("collects warnings when one runtime fails and continues", async () => {
    const root = await tmp();
    const cursorDir = join(root, "cursor");
    const claudeDir = join(root, "claude");
    try {
      await mkdir(cursorDir, { recursive: true });
      await writeFile(join(cursorDir, "hooks.json"), "{not json");

      const result = await installRouteHooksForRuntimes(["cursor", "claude-code"], {
        recorderCommand: "/bin/skillet",
        cursorDir,
        claudeDir,
      });
      expect(result.installed).toEqual(["claude-code"]);
      expect(result.warnings.some((w) => w.startsWith("cursor"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("installClaudeCodeRouteHook", () => {
  it("preserves unrelated hook groups", async () => {
    const dir = await tmp();
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "settings.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
          },
        }),
      );

      await installClaudeCodeRouteHook({ claudeDir: dir, recorderCommand: "/bin/skillet" });
      const saved = JSON.parse(await readFile(join(dir, "settings.json"), "utf8")) as {
        hooks: Record<string, unknown>;
      };
      expect(saved.hooks.PreToolUse).toBeDefined();
      expect(saved.hooks.UserPromptSubmit).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("installCodexRouteHook", () => {
  it("creates hooks.json and enables codex_hooks", async () => {
    const dir = await tmp();
    try {
      await installCodexRouteHook({ codexDir: dir, recorderCommand: "/bin/skillet" });
      const config = await readFile(join(dir, "config.toml"), "utf8");
      expect(config).toMatch(/codex_hooks\s*=\s*true/);
      const hooks = JSON.parse(await readFile(join(dir, "hooks.json"), "utf8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      expect(hooks.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain(
        "route hook --runtime codex",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureCodexHooksFeatureFlag", () => {
  it("appends features block when missing", () => {
    expect(ensureCodexHooksFeatureFlag("")).toContain("codex_hooks = true");
  });

  it("preserves existing features keys", () => {
    const next = ensureCodexHooksFeatureFlag("[features]\nother = 1\n");
    expect(next).toContain("other = 1");
    expect(next).toContain("codex_hooks = true");
  });
});

describe("installCursorRouteHook compat", () => {
  it("uses generic route hook command", async () => {
    const dir = await tmp();
    try {
      const result = await installCursorRouteHook({ cursorDir: dir, recorderCommand: "/bin/skillet" });
      expect(result.command).toContain("route hook --runtime cursor");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("U2: parked config dirs (TCC policy)", () => {
  // HOME here is the hermetic sandbox from test-env-setup; a config dir under
  // its Documents is TCC-parked, so the installers must return skipped without
  // reading or writing any settings file. The policy is macOS-only; force it
  // on so the decoy Documents parks anywhere.
  beforeEach(() => {
    process.env["SKILLET_TCC_POLICY"] = "force";
  });
  afterEach(() => {
    delete process.env["SKILLET_TCC_POLICY"];
  });
  it("claude-code: config dir inside ~/Documents installs nothing", async () => {
    const { homedir } = await import("node:os");
    const claudeDir = join(homedir(), "Documents", "claude");
    await mkdir(claudeDir, { recursive: true });
    const result = await installClaudeCodeRouteHook({
      claudeDir,
      recorderCommand: "/bin/skillet",
    });
    expect(result.installed).toBe(false);
    await expect(readFile(join(claudeDir, "settings.json"), "utf8")).rejects.toThrow();
  });

  it("codex: config dir inside ~/Documents installs nothing", async () => {
    const { homedir } = await import("node:os");
    const codexDir = join(homedir(), "Documents", "codex");
    await mkdir(codexDir, { recursive: true });
    const result = await installCodexRouteHook({
      codexDir,
      recorderCommand: "/bin/skillet",
    });
    expect(result.installed).toBe(false);
    await expect(readFile(join(codexDir, "hooks.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(codexDir, "config.toml"), "utf8")).rejects.toThrow();
  });

  it("cursor: config dir inside ~/Documents installs nothing", async () => {
    const { homedir } = await import("node:os");
    const cursorDir = join(homedir(), "Documents", "cursor");
    await mkdir(cursorDir, { recursive: true });
    const result = await installCursorRouteHook({
      cursorDir,
      recorderCommand: "/bin/skillet",
    });
    expect(result.installed).toBe(false);
    await expect(readFile(join(cursorDir, "hooks.json"), "utf8")).rejects.toThrow();
  });

  it("orchestrator reports a parked runtime as skipped, not an error", async () => {
    const { homedir } = await import("node:os");
    const claudeDir = join(homedir(), "Documents", "claude-b");
    await mkdir(claudeDir, { recursive: true });
    const result = await installRouteHooksForRuntimes(["claude-code"], {
      recorderCommand: "/bin/skillet",
      claudeDir,
    });
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual(["claude-code"]);
    expect(result.warnings).toEqual([]);
  });
});
