import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { optimizableImageRemotePatterns } from "./src/lib/image-hosts";
import { siteRedirects } from "./src/lib/redirects";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Allow the dev HMR WebSocket + chunks on loopback. Next's canonical dev origin
  // is `localhost`, so a `127.0.0.1` view would otherwise be treated as cross-origin
  // and have /_next/webpack-hmr blocked → no hot reload, no hydration. If you view
  // the dev app on this machine's LAN IP (e.g. from another device or cmux), add
  // that IP here locally — don't commit a machine-specific address.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    // Optimization runs in the web Node process (sharp) and is fronted by
    // Cloudflare's edge cache. Only known provider hosts are optimized; any
    // other avatar host is rendered `unoptimized` by the components, so the
    // allowlist stays tight (no open image proxy) without breaking custom
    // avatars. See src/lib/image-hosts.ts.
    remotePatterns: optimizableImageRemotePatterns(),
    formats: ["image/avif", "image/webp"],
    qualities: [75],
    // Avatars/covers rarely change (provider URLs cache-bust via query when they
    // do), so cache optimized output long to keep work off the single box.
    minimumCacheTTL: 604800, // 7 days
  },
  // node:sqlite is a native built-in (the blog store uses it). Mark it external
  // so Turbopack doesn't try to bundle it — bundling fails in dev with
  // "require is not defined".
  //
  // highlight.js / lowlight (the rehype-highlight code-block highlighter) hit
  // the SAME "require is not defined" under Turbopack dynamic SSR: bundled into
  // an ESM server chunk, their internal CJS require has no shim. Externalizing
  // loads them via Node's real require, so markdown code highlighting works on
  // dynamic pages (skill SKILL.md viewer, docs, blog).
  serverExternalPackages: ["node:sqlite", "highlight.js", "lowlight"],
  turbopack: {
    root: repoRoot,
  },
  async redirects() {
    return siteRedirects();
  },
};

export default nextConfig;
