import type { Command } from "commander";
import { openBrowserUrl, resolveWebUrl } from "../open-browser-url.js";
import { ExitCode, exitWith } from "../exit-codes.js";

export function registerWebCommand(program: Command): void {
  program
    .command("web [path]")
    .description("Open skillet.md in your browser (e.g. /settings)")
    .action(async (path: string | undefined) => {
      try {
        const url = resolveWebUrl(path);
        const opened = await openBrowserUrl(url);
        if (opened) {
          console.log(`Opened ${url}`);
          return;
        }
        console.log(url);
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        exitWith(ExitCode.USAGE);
      }
    });
}
