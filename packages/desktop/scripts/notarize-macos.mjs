#!/usr/bin/env node
/**
 * Notarize + staple the signed macOS artifacts produced by `tauri build`.
 *
 * `tauri build` already code-signs the .app, the sidecar, and the .dmg with the
 * Developer ID identity in APPLE_SIGNING_IDENTITY. Notarization is the separate
 * Apple-side step: submit the artifact, wait for the ticket, staple it so the
 * app launches without a network round-trip, then confirm Gatekeeper accepts it.
 *
 * Credentials — either a stored notarytool keychain profile (preferred; nothing
 * lands in a file or in shell history):
 *
 *   xcrun notarytool store-credentials skillet-notary \
 *     --key ~/private_keys/AuthKey_XXXXXXXXXX.p8 \
 *     --key-id XXXXXXXXXX --issuer <issuer-uuid>
 *
 *   node scripts/notarize-macos.mjs --profile skillet-notary
 *
 * ...or App Store Connect API key values straight from the environment, which is
 * what CI uses:
 *
 *   APPLE_API_KEY_PATH  path to AuthKey_XXXXXXXXXX.p8
 *   APPLE_API_KEY       the 10-char Key ID
 *   APPLE_API_ISSUER    the issuer UUID
 *
 * Staple the .app BEFORE the .dmg: stapling the app mutates its bundle, and a
 * dmg built around an unstapled app ships an unstapled app inside it. Tauri has
 * already built the dmg by the time this runs, so the dmg is re-created from the
 * stapled app rather than stapled in place.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(desktopRoot, 'src-tauri', 'target', 'release', 'bundle');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const profile = flag('profile');
const identity = process.env['APPLE_SIGNING_IDENTITY'];

/** notarytool auth flags, from a keychain profile or raw ASC key env vars. */
function notaryAuth() {
  if (profile) return ['--keychain-profile', profile];
  const keyPath = process.env['APPLE_API_KEY_PATH'];
  const keyId = process.env['APPLE_API_KEY'];
  const issuer = process.env['APPLE_API_ISSUER'];
  if (keyPath && keyId && issuer) {
    return ['--key', keyPath, '--key-id', keyId, '--issuer', issuer];
  }
  console.error(
    'No notarization credentials. Pass --profile <name>, or set APPLE_API_KEY_PATH + APPLE_API_KEY + APPLE_API_ISSUER.',
  );
  process.exit(1);
}

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
}
function capture(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8' }).trim();
}

/** The single .app under bundle/macos — bail loudly on zero or many. */
function findApp() {
  const dir = join(bundleDir, 'macos');
  if (!existsSync(dir)) {
    console.error(`No macOS bundle at ${dir}. Run \`pnpm exec tauri build\` first.`);
    process.exit(1);
  }
  const apps = readdirSync(dir).filter((f) => f.endsWith('.app'));
  if (apps.length !== 1) {
    console.error(`Expected exactly one .app in ${dir}, found ${apps.length}: ${apps.join(', ')}`);
    process.exit(1);
  }
  return join(dir, apps[0]);
}

const auth = notaryAuth();
const appPath = findApp();
const appName = appPath.split('/').pop();

// --- 0. The app must already be Developer ID signed with a hardened runtime.
// Notarization rejects an ad-hoc or unsigned bundle, and the rejection log is
// far less legible than this check.
console.log(`Verifying signature on ${appName}…`);
run('codesign', ['--verify', '--strict', '--verbose=2', appPath]);
const flags = capture('codesign', ['--display', '--verbose=2', appPath]);
if (!/flags=.*runtime/.test(flags)) {
  console.error('App is not signed with the hardened runtime; notarization will be rejected.');
  console.error(flags);
  process.exit(1);
}

// --- 1. Notarize the .app. Submitted as a zip because notarytool takes
// zip/dmg/pkg only, never a bare bundle directory.
const staging = mkdtempSync(join(tmpdir(), 'skillet-notarize-'));
const zipPath = join(staging, 'app.zip');
console.log('Zipping app for submission…');
run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);

console.log('Submitting to Apple (this usually takes a few minutes)…');
run('xcrun', ['notarytool', 'submit', zipPath, ...auth, '--wait', '--timeout', '30m']);

// --- 2. Staple the app, so first launch works offline.
console.log('Stapling ticket to the app…');
run('xcrun', ['stapler', 'staple', appPath]);
run('xcrun', ['stapler', 'validate', appPath]);

// --- 3. Rebuild the dmg around the now-stapled app. Tauri's dmg was assembled
// before the ticket existed, so shipping it would hand users an unstapled app.
const dmgDir = join(bundleDir, 'dmg');
const dmgs = existsSync(dmgDir) ? readdirSync(dmgDir).filter((f) => f.endsWith('.dmg')) : [];
if (dmgs.length === 1) {
  const dmgPath = join(dmgDir, dmgs[0]);
  console.log(`Rebuilding ${dmgs[0]} around the stapled app…`);
  const stage = join(staging, 'dmg-stage');
  run('mkdir', ['-p', stage]);
  run('cp', ['-R', appPath, stage]);
  run('ln', ['-s', '/Applications', join(stage, 'Applications')]);
  rmSync(dmgPath, { force: true });
  run('hdiutil', ['create', '-volname', 'Skillet', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmgPath]);
  if (identity) {
    run('codesign', ['--force', '--timestamp', '--sign', identity, dmgPath]);
  }
  console.log('Notarizing the dmg…');
  run('xcrun', ['notarytool', 'submit', dmgPath, ...auth, '--wait', '--timeout', '30m']);
  run('xcrun', ['stapler', 'staple', dmgPath]);
  run('xcrun', ['stapler', 'validate', dmgPath]);
} else if (dmgs.length > 1) {
  console.warn(`Skipping dmg step: expected one .dmg, found ${dmgs.length}.`);
}

// --- 4. The real bar: a freshly downloaded copy must assess as accepted, or
// first launch shows the "cannot be opened" warning.
console.log('Gatekeeper assessment…');
run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);

rmSync(staging, { recursive: true, force: true });
console.log(`\nNotarized and stapled: ${appPath}`);
