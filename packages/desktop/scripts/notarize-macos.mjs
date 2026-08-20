#!/usr/bin/env node
/**
 * Notarize + staple the .dmg, and verify the whole macOS release is Gatekeeper-clean.
 *
 * Division of labour — `tauri build` does MORE than it looks like:
 *
 *   1. signs the .app + the sidecar (APPLE_SIGNING_IDENTITY)
 *   2. notarizes and staples the .app          <- only if the APPLE_API_* vars are set
 *   3. builds the styled .dmg around it        <- background image, icon positions
 *   4. signs the .dmg, writes the updater .tar.gz + .sig
 *
 * Step 2 is silently skipped when the credentials are absent — the build prints
 * "skipping app notarization" as a Warn and still exits 0, so an unnotarized
 * release looks like a successful one. Set these before `tauri build`:
 *
 *   APPLE_SIGNING_IDENTITY   "Developer ID Application: … (TEAMID)"
 *   APPLE_API_KEY            the 10-char App Store Connect Key ID
 *   APPLE_API_ISSUER         the issuer UUID
 *   APPLE_API_KEY_PATH       path to AuthKey_XXXXXXXXXX.p8
 *
 * What is left for this script is the .dmg: Tauri signs it but does not notarize
 * it, and an un-notarized dmg trips Gatekeeper on download even though the app
 * inside is clean.
 *
 * Do NOT rebuild the dmg here. An earlier version of this script staged the app
 * and ran bare `hdiutil create`, which produced a working but unstyled dmg — the
 * configured background and icon layout were silently dropped. Tauri's dmg is
 * already built around the stapled app; it only needs the Apple round-trip.
 *
 * Credentials for this script: a stored notarytool keychain profile (preferred),
 *
 *   xcrun notarytool store-credentials skillet-notary \
 *     --key ~/private_keys/AuthKey_XXXXXXXXXX.p8 \
 *     --key-id XXXXXXXXXX --issuer <issuer-uuid>
 *   node scripts/notarize-macos.mjs --profile skillet-notary
 *
 * or the same APPLE_API_* vars the build uses, so CI can export one set.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(desktopRoot, 'src-tauri', 'target', 'release', 'bundle');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const profile = flag('profile');

function run(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { stdio: 'inherit' });
}

/**
 * Combined stdout+stderr. `codesign --display` and `spctl --assess` write their
 * whole report to STDERR, so capturing stdout alone returns an empty string and
 * any check against it "fails" on a perfectly good bundle.
 */
function capture(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
}

/** notarytool auth flags, from a keychain profile or the ASC key env vars. */
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

/** The single artifact with `ext` under bundle/<sub> — bail loudly on zero or many. */
function findOne(sub, ext) {
  const dir = join(bundleDir, sub);
  if (!existsSync(dir)) {
    console.error(`No ${dir}. Run \`pnpm exec tauri build\` first.`);
    process.exit(1);
  }
  const hits = readdirSync(dir).filter((f) => f.endsWith(ext));
  if (hits.length !== 1) {
    console.error(`Expected exactly one ${ext} in ${dir}, found ${hits.length}: ${hits.join(', ')}`);
    process.exit(1);
  }
  return join(dir, hits[0]);
}

const auth = notaryAuth();
const appPath = findOne('macos', '.app');
const dmgPath = findOne('dmg', '.dmg');

// --- 1. The app must already be signed, hardened, AND stapled by the build.
// If the build ran without APPLE_API_*, it is signed but not notarized, and
// notarizing the dmg around it would ship a half-clean release.
console.log(`Checking ${appPath.split('/').pop()}…`);
run('codesign', ['--verify', '--strict', '--verbose=2', appPath]);

const sig = capture('codesign', ['--display', '--verbose=2', appPath]);
if (!/flags=.*runtime/.test(sig)) {
  console.error('App is not signed with the hardened runtime; notarization will be rejected.');
  console.error(sig);
  process.exit(1);
}

const stapled = spawnSync('xcrun', ['stapler', 'validate', appPath], { encoding: 'utf8' });
if (stapled.status !== 0) {
  console.error(
    'App has no notarization ticket stapled.\n' +
      'The build skipped notarization — re-run `tauri build` with APPLE_API_KEY, ' +
      'APPLE_API_ISSUER, and APPLE_API_KEY_PATH set, then run this again.',
  );
  process.exit(1);
}
console.log('App is signed, hardened, and stapled ✓');

// --- 2. Notarize the dmg itself. Tauri signs it but never submits it.
if (spawnSync('xcrun', ['stapler', 'validate', dmgPath]).status === 0) {
  console.log('DMG already stapled, skipping submission.');
} else {
  console.log('Submitting the dmg to Apple (this usually takes a few minutes)…');
  run('xcrun', ['notarytool', 'submit', dmgPath, ...auth, '--wait', '--timeout', '30m']);
  run('xcrun', ['stapler', 'staple', dmgPath]);
  run('xcrun', ['stapler', 'validate', dmgPath]);
}

// --- 3. The real bar: both artifacts must assess as accepted, or first launch
// shows the "cannot be opened" warning. spctl exits non-zero on rejection, so
// these two calls are the assertion.
console.log('\nGatekeeper assessment…');
run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath]);

console.log(`\nNotarized and stapled:\n  ${appPath}\n  ${dmgPath}`);
