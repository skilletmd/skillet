#!/usr/bin/env node
/**
 * Copy compiled native binaries from packages/cli/dist/native into platform packages.
 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_TARGETS } from './native-targets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const nativeDir = join(repoRoot, 'packages', 'cli', 'dist', 'native');

const onlyIdx = process.argv.indexOf('--only');
const onlyTarget = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

if (!process.env['CLI_PUBLISH_VERSION']) {
  console.error('Set CLI_PUBLISH_VERSION to the semver being published.');
  process.exit(1);
}

for (const [key, spec] of Object.entries(NATIVE_TARGETS)) {
  if (onlyTarget && key !== onlyTarget) continue;
  const pkgDir = join(repoRoot, 'packages', `cli-${key}`);
  const ext = spec.ext ?? '';
  const src = join(nativeDir, `skillet-${spec.triple}${ext}`);
  const destDir = join(pkgDir, 'bin');
  const destName = ext ? 'skillet.exe' : 'skillet';
  await mkdir(destDir, { recursive: true });
  await copyFile(src, join(destDir, destName));
  console.log(`Staged ${key} → ${pkgDir}/bin/${destName}`);
  assertBinaryPacks(key, pkgDir, destName);
}

/**
 * Staging the binary is not the same as shipping it: npm packs what the
 * manifest's `files` field selects, not what is on disk. cli-win32-x64 listed
 * `bin/skillet` while this script writes `bin/skillet.exe` on Windows, so every
 * Windows release through 0.1.37 published a 452-byte tarball containing only
 * package.json. The optional dependency installed fine and users silently fell
 * back to the JS bundle. Ask npm what it would actually pack.
 */
function assertBinaryPacks(key, pkgDir, destName) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkgDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const files = JSON.parse(out)[0]?.files ?? [];
  const packed = files.find((f) => f.path === `bin/${destName}`);
  if (!packed) {
    const listing = files.map((f) => f.path).join(', ') || '(nothing)';
    throw new Error(
      `${key}: npm would not pack bin/${destName}. Tarball would contain: ${listing}. ` +
        `Check the "files" field in packages/cli-${key}/package.json.`,
    );
  }
  console.log(`  npm will pack bin/${destName} (${packed.size} bytes)`);
}
