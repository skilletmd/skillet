// Preloaded before the CLI test suite (see package.json "test" --import).
//
// A shell that has run the dev app exports SKILLET_WEB_URL / SKILLET_REGISTRY_URL
// pointing at localhost. Many tests (help snapshot, resolveWebUrl) assert the
// production https://skillet.md base, so an ambient override makes them fail —
// on a dev machine or in any CI runner that happens to set these. Scrub the URL
// overrides here so the suite is hermetic. Tests that exercise the override path
// set the var themselves and restore it. SKILLET_DIR is intentionally left alone
// (disk isolation is handled separately).
for (const key of ["SKILLET_WEB_URL", "SKILLET_REGISTRY_URL"]) {
  delete process.env[key];
}

// Author-key pins live under XDG_CONFIG_HOME ?? ~/.config (core signing/pin.ts).
// Pin-accept tests exercise the real accept path, so route the pin dir into a
// throwaway sandbox; without this a test could write the developer's real
// ~/.config/skillet/pinned. Tests needing a specific pin dir still pass an
// explicit pinDir or override the var themselves.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env["XDG_CONFIG_HOME"] = join(
  mkdtempSync(join(tmpdir(), "skillet-cli-test-config-")),
  ".config",
);
