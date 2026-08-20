/**
 * Inline-image policy for skill bundles — shared by the registry's raw-file
 * route (server gate) and the web viewer (client mirror), so the two lists
 * can't drift. Browser-safe: no node imports (imported client-side via the
 * `@skillet/protocol/inline-images` subpath).
 *
 * Raster formats only. SVG is deliberately excluded — it is a script-injection
 * surface (inline <script>, event handlers) and keeps download-only behavior.
 */

/**
 * Max bytes the registry serves inline per image file. Distinct from the
 * publish-time bundle cap ({@link MAX_BUNDLE_BYTES} in bundle.ts, 25 MiB):
 * this bounds a single <img> fetch, not what a bundle may contain. The web
 * viewer mirrors it client-side and never requests an over-cap file.
 */
export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

/** Allowlisted extension → exact Content-Type. The registry sets the type from
 *  this map (the web sends `X-Content-Type-Options: nosniff`, so it must be
 *  exact); the key set doubles as the client-side render allowlist. */
export const INLINE_IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Lowercased extension of `path` when it is inline-renderable, else null. */
export function inlineImageExtension(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return ext in INLINE_IMAGE_CONTENT_TYPES ? ext : null;
}

/** True when the bundle path has an allowlisted raster-image extension. */
export function isInlineImagePath(path: string): boolean {
  return inlineImageExtension(path) !== null;
}
