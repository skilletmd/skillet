import { spawn } from "node:child_process";
import { webBaseUrl } from "./cli-command-tier.js";

/** Build a skillet.md URL from an optional site-relative path. */
export function resolveWebUrl(path?: string): string {
  const base = webBaseUrl();
  if (path === undefined || path.length === 0) return base;
  // Accept a bare path (`settings`) as shorthand for the rooted form
  // (`/settings`); normalize the leading slash rather than rejecting it. Still
  // reject `//…`, which the browser reads as a protocol-relative URL to another
  // origin — a bare-path input can never be that once we've prepended the slash.
  const rooted = path.startsWith("/") ? path : `/${path}`;
  if (rooted.startsWith("//")) {
    throw new Error("Path must be site-relative (e.g. /settings)");
  }
  return `${base}${rooted}`;
}

/** Reject URLs that could break out of a Windows `cmd /C start` invocation. */
export function assertSafeBrowserUrl(url: string): void {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("Browser URL must be http or https");
  }
  if (/["&\r\n]/.test(url)) {
    throw new Error("Browser URL contains unsafe characters");
  }
}

/** Open a URL in the system default browser. Returns false when no opener is available. */
export function openBrowserUrl(url: string): Promise<boolean> {
  assertSafeBrowserUrl(url);

  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? (["open", [url]] as const)
      : platform === "win32"
        ? (["cmd", ["/C", "start", "", url]] as const)
        : (["xdg-open", [url]] as const);

  return new Promise((resolve) => {
    const child = spawn(cmd, [...args], { stdio: "ignore", detached: true });
    child.on("error", () => resolve(false));
    child.on("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
