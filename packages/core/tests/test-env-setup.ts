/**
 * Vitest setup: isolate unit tests from the developer's shell env AND from the
 * developer's real Skillet home.
 *
 * Two hazards this closes:
 *  1. An exported SKILLET_TOKEN in ~/.zshrc shadows mocked fetch in sync/login
 *     tests.
 *  2. Hard rule — a test must NEVER read or write the developer's real
 *     ~/.skillet. `skilletDir()` resolves `process.env.SKILLET_DIR`, falling
 *     back to `~/.skillet`. Because local dev exports SKILLET_DIR=~/.skillet,
 *     any test that seeds a device.json/session.json via `skilletDir()` without
 *     setting its own SKILLET_DIR (e.g. it only overrides HOME) would clobber
 *     the real file — silently un-pairing the desktop app.
 *
 * We neutralize the inherited HOME/SKILLET_DIR at module-load time, which runs
 * BEFORE each test file is imported. Tests that assign their own SKILLET_DIR
 * (at top level or in beforeEach) still win — this only replaces the unsafe
 * default. Nothing here runs per-test, so top-level-only assignments survive.
 */
import { beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect to a throwaway sandbox so an unguarded test can't touch real files.
const sandbox = mkdtempSync(join(tmpdir(), "skillet-test-home-"));
process.env["HOME"] = sandbox;
process.env["SKILLET_DIR"] = join(sandbox, ".skillet");
if (process.platform === "win32") process.env["USERPROFILE"] = sandbox;
// Author-key pins live under XDG_CONFIG_HOME ?? ~/.config (signing/pin.ts).
// The HOME redirect covers the fallback, but a dev shell that exports
// XDG_CONFIG_HOME would bypass it and point defaultPinDir() at the real
// config dir — redirect it into the sandbox too.
process.env["XDG_CONFIG_HOME"] = join(sandbox, ".config");

// A dev shell that points the desktop app at a local registry exports
// SKILLET_WEB_URL / SKILLET_REGISTRY_URL. Scrub them so URL-sensitive tests
// pass identically in a dev shell, a clean shell, and CI. Tests exercising the
// override path set the vars themselves.
delete process.env["SKILLET_WEB_URL"];
delete process.env["SKILLET_REGISTRY_URL"];

beforeEach(() => {
  delete process.env["SKILLET_TOKEN"];
});
