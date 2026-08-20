import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCursorRouteHook } from "../src/commands/cursor-hook.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "skillet-cursor-hook-"));
}

describe("installCursorRouteHook", () => {
  it("installs a beforeSubmitPrompt hook and preserves unrelated hooks", async () => {
    const dir = await tmp();
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "hooks.json"),
        JSON.stringify({
          version: 1,
          hooks: {
            afterFileEdit: [{ command: "echo edited" }],
            beforeSubmitPrompt: [{ command: "echo other" }],
          },
        }),
      );

      const result = await installCursorRouteHook({
        cursorDir: dir,
        recorderCommand: "/Applications/Skillet.app/Contents/MacOS/skillet",
      });

      const saved = JSON.parse(await readFile(result.hooksPath, "utf8")) as {
        version: number;
        hooks: Record<string, Array<{ command: string; matcher?: string; failClosed?: boolean }>>;
      };
      expect(saved.version).toBe(1);
      expect(saved.hooks.afterFileEdit?.[0]?.command).toBe("echo edited");
      expect(saved.hooks.beforeSubmitPrompt).toHaveLength(2);
      const skilletHook = saved.hooks.beforeSubmitPrompt?.find((entry) =>
        entry.command.includes("route hook"),
      );
      expect(skilletHook?.command).toContain("/Applications/Skillet.app/Contents/MacOS/skillet");
      expect(skilletHook?.matcher).toBe("UserPromptSubmit");
      expect(skilletHook?.failClosed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces a previous Skillet route hook entry", async () => {
    const dir = await tmp();
    try {
      await installCursorRouteHook({ cursorDir: dir, recorderCommand: "/old/skillet" });
      await installCursorRouteHook({ cursorDir: dir, recorderCommand: "/new/skillet" });
      const saved = JSON.parse(await readFile(join(dir, "hooks.json"), "utf8")) as {
        hooks: Record<string, Array<{ command: string }>>;
      };
      const routeHooks =
        saved.hooks.beforeSubmitPrompt?.filter((entry) =>
          entry.command.includes("route hook"),
        ) ?? [];
      expect(routeHooks).toHaveLength(1);
      expect(routeHooks[0]?.command).toContain("/new/skillet");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
