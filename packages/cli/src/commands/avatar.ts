import type { Command } from "commander";
import { authStatus } from "@skillet/core";
import { REGISTRY_DEFAULT } from "../cli-context.js";

/** Stable per-person hue (0–359), matching the web's avatar tint (FNV-1a). */
function handleHue(handle: string): number {
  let h = 2166136261;
  for (let i = 0; i < handle.length; i++) h = ((h ^ handle.charCodeAt(i)) * 16777619) >>> 0;
  return h % 360;
}

/**
 * Count of `face-01..NN.svg` in the web's `public/avatars/default/`. Mirrors
 * `DEFAULT_AVATAR_COUNT` in `packages/web/src/lib/avatar-color.ts` — bump both
 * together or the two surfaces pick different faces for the same person.
 */
export const DEFAULT_AVATAR_COUNT = 41;

/** djb2 — mirrors the web's `faceHash`, so a handle resolves to the SAME face. */
function faceHash(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return h;
}

/** The web's `defaultAvatarUrl()`, ported: same hash, same count, same path. */
export function defaultAvatarPath(handle: string): string {
  const n = (faceHash(handle) % DEFAULT_AVATAR_COUNT) + 1;
  return `/avatars/default/face-${String(n).padStart(2, "0")}.svg`;
}

/**
 * `skillet avatar` — print the signed-in user's avatar as a `data:` URI.
 *
 * The desktop app renders it in-process: its CSP is `img-src 'self' asset:
 * data:`, so a remote R2 avatar URL is blocked, but a data URI is safe. Fetching
 * + encoding happens here (Node) rather than loosening the desktop CSP. Emits
 * `{"data_uri": "data:image/…;base64,…" | null}` — null when signed out, the
 * user has no custom avatar, or the fetch fails (client falls back to a monogram).
 */
export function registerAvatarCommand(program: Command): void {
  // Hidden from help: internal plumbing the desktop tray calls to render the
  // signed-in user's avatar. Still registered and callable (`skillet avatar`).
  program
    .command("avatar", { hidden: true })
    .description("Print the signed-in user's avatar image (internal)")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .option("--token <token>", "Bearer token override")
    .action(async (opts: { registry: string; token?: string }) => {
      const status = await authStatus({
        registryUrl: opts.registry,
        ...(opts.token ? { token: opts.token } : {}),
      });
      // No stored avatar is the COMMON case, not an error. The web assigns
      // everyone a deterministic illustrated face client-side (resolveAvatar →
      // defaultAvatarUrl) and never persists it, so `avatar_url` stays null for
      // anyone who has not uploaded a photo. Derive the same path here or the
      // tray falls back to a monogram — which is the web's TEAM treatment, never
      // a person's, so the same account looked different on the two surfaces.
      const handle = status.whoami?.handle ?? null;
      const raw =
        status.whoami?.avatar_url ?? (handle ? defaultAvatarPath(handle) : null);
      // A custom avatar is an absolute (R2) URL; a default illustrated face is a
      // web-relative path (`/avatars/default/…`) — resolve it against the web app.
      const webBase = (process.env.SKILLET_WEB_URL || "https://skillet.md").replace(/\/+$/, "");
      const url = raw ? (/^https?:\/\//.test(raw) ? raw : `${webBase}${raw.startsWith("/") ? "" : "/"}${raw}`) : null;
      let dataUri: string | null = null;
      if (url) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const contentType = res.headers.get("content-type") || "image/webp";
            const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
            dataUri = `data:${contentType};base64,${b64}`;
          }
        } catch {
          // offline / unreachable — leave null, the client shows a monogram
        }
      }
      // Default illustrated faces are transparent black line-art on a per-person
      // pastel tint (mirrors the web's avatarTintGradient). The hue is encoded in
      // the URL (`?h=220`); fall back to a stable hash of the handle. Custom
      // photos fill the circle, so no tint.
      let tint: string | null = null;
      if (raw && raw.includes("/avatars/default/")) {
        const m = /[?&]h=(\d+)/.exec(raw);
        const hue = m ? Number(m[1]) % 360 : handleHue(status.whoami?.handle ?? "");
        tint = `radial-gradient(120% 120% at 30% 26%, hsl(${hue} 64% 94%), hsl(${hue} 52% 83%))`;
      }
      process.stdout.write(JSON.stringify({ data_uri: dataUri, tint }) + "\n");
    });
}
