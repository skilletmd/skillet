#!/usr/bin/env node
/**
 * Copy compiled native binaries from packages/cli/dist/native into platform packages.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_TARGETS } from './build-native.mjs';

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
}
