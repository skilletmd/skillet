# packages/desktop

Tauri tray app. Root [CLAUDE.md](../../CLAUDE.md) has the repo-wide
invariants; these are desktop-specific.

- **All registry access goes through the bundled CLI sidecar** — the
  `run_skillet` call sites in `src-tauri/src/lib.rs` are the app's data
  contract. The desktop never sets `SKILLET_LEGACY_CLI`, so every command it
  invokes must exist at the CLI's device tier
  (`packages/cli/tests/desktop-contract.test.ts` enforces this). An unknown
  command fails silently: commander help goes to stderr, stdout is empty, and
  the tray renders empty state with no error.
  **One sanctioned exception:** the device-sync SSE stream
  (`src/device-sync-stream.ts`) fetches the registry directly from the
  webview — a sidecar process can't hold a push stream open for the page. This
  is a registry-wide CORS allowance (the registry allowlists the fixed webview
  origins) plus a CSP `connect-src` entry for the registry origin; any new
  direct webview call still needs its own review, and both configs' CSPs must
  stay mirrored (`src/csp-config.test.ts` enforces the superset).
- The webview is bundled by Vite with **no node shims**: import only node-free
  `@skillet/protocol` subpaths (lint-enforced; the barrel blank-pages the app).
- The sidecar bundles `core` + `cli`, where dynamic `import('node:…')` throws
  silently — static imports only (lint-enforced).
- **Update approvals happen on the web Updates page**, never in the app. The
  tray only reads `pending --json` for the badge and deep-links to web.
- `data-tauri-drag-region` only works for exact-target clicks; for draggable
  panels call `startDragging()` on mousedown instead.
- After rebasing, run `pnpm install` before `build:local` or the sidecar
  bundle fails resolving workspace subpath exports.
