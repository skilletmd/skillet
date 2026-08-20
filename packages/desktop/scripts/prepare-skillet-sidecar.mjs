#!/usr/bin/env node
/**
 * Build a standalone `skillet` sidecar for the current OS/arch and place it where
 * Tauri externalBin expects: src-tauri/binaries/skillet-<target-triple>.
 */
import { execSync } from 'node:child_process';
import { chmod, mkdir, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(desktopRoot, '..', '..');
const binDir = join(desktopRoot, 'src-tauri', 'binaries');
const cliBundle = join(repoRoot, 'packages', 'cli', 'dist', 'cli.cjs');

/** @type {Record<string, { triple: string; ext?: string }>} */
const PLATFORMS = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin' },
  'darwin-x64': { triple: 'x86_64-apple-darwin' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', ext: '.exe' },
};

const key = `${os.platform()}-${os.arch()}`;
const spec = PLATFORMS[key];
if (!spec) {
  console.error(`Unsupported sidecar platform: ${key}`);
  process.exit(1);
}

console.log(`Building skillet sidecar for ${key} (${spec.triple})…`);

// Defer to the CLI's own dependency list rather than restating it. This used to
// build protocol and core only, and the bundle also needs mcp and every
// adapters-* dist — esbuild fails with "Could not resolve
// @skillet/adapters-claude-code" on a clean checkout, and never on a dev machine
// where those dists are already warm. build-cli-deps.mjs is what `skilletmd
// test` and build-native.mjs both use, so the sidecar cannot drift from it again.
execSync(
  `node "${join(repoRoot, 'packages', 'cli', 'scripts', 'build-cli-deps.mjs')}" && pnpm --filter skilletmd bundle`,
  { cwd: repoRoot, stdio: 'inherit' },
);

await mkdir(binDir, { recursive: true });

const finalName = `skillet-${spec.triple}${spec.ext ?? ''}`;
const finalPath = join(binDir, finalName);

execSync(`node "${join(repoRoot, 'packages', 'cli', 'scripts', 'build-native.mjs')}" --target ${key}`, {
  cwd: repoRoot,
  stdio: 'inherit',
});

const compiledPath = join(repoRoot, 'packages', 'cli', 'dist', 'native', finalName);
await rename(compiledPath, finalPath);

if (os.platform() !== 'win32') {
  await chmod(finalPath, 0o755);
}

const MIN_CLI_VERSION = [0, 1, 24];

/** @param {string} raw */
function parseSemver(raw) {
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** @param {[number, number, number]} a @param {[number, number, number]} b */
function semverGte(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

let versionOut = '';
try {
  versionOut = execSync(`"${finalPath}" --version`, { encoding: 'utf8' }).trim();
} catch (err) {
  console.error(`Sidecar --version failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const parsed = parseSemver(versionOut);
if (!parsed || !semverGte(parsed, MIN_CLI_VERSION)) {
  console.error(
    `Sidecar must be skilletmd >= ${MIN_CLI_VERSION.join('.')} (got ${versionOut || 'unknown'})`,
  );
  process.exit(1);
}
console.log(`Sidecar version OK: ${versionOut}`);

try {
  const dry = execSync(`"${finalPath}" sync --dry-run --json`, {
    encoding: 'utf8',
    cwd: os.homedir(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const payload = JSON.parse(dry);
  const kits = payload?.data?.kits ?? payload?.kits;
  if (!Array.isArray(kits)) {
    console.warn('Dry-run JSON missing kits[] — tray will fall back to list groups');
  } else {
    console.log(`Dry-run kits smoke OK (${kits.length} group(s))`);
  }
} catch (err) {
  console.warn(
    `Dry-run kits smoke skipped (unlinked machine is OK): ${err instanceof Error ? err.message : err}`,
  );
}

// The route skill's SKILL.md is inlined into cli.cjs (bundle-cli.mjs define) so
// it reaches the compiled sidecar, which can't read dist/bundled-skills from disk.
// Assert the inline actually happened — the exact regression that left
// desktop-only users without /skillet. We grep cli.cjs (the compile input),
// NOT the final binary: the marker string is not findable as raw text in the
// compiled artifact even though it ships.
const ROUTE_SKILL_MARKER = 'Route natural-language tasks to the best skill';
const bundleText = await readFile(cliBundle, 'utf8');
if (!bundleText.includes(ROUTE_SKILL_MARKER)) {
  console.error(
    'Sidecar is missing the bundled @skillet/route SKILL.md — /skillet will not materialize for desktop-only users.',
  );
  process.exit(1);
}
console.log('Bundled route skill present in sidecar ✓');

console.log(`Sidecar ready → ${finalPath}`);
