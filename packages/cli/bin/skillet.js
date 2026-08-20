#!/usr/bin/env node
/**
 * npm launcher: exec the platform optionalDependency binary when installed,
 * otherwise fall back to the bundled CJS entry (monorepo / unpublished layouts).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {Record<string, string>} */
const PLATFORM_PACKAGES = {
  'darwin-arm64': '@skilletmd/cli-darwin-arm64',
  'darwin-x64': '@skilletmd/cli-darwin-x64',
  'linux-x64': '@skilletmd/cli-linux-x64',
  'linux-arm64': '@skilletmd/cli-linux-arm64',
  'win32-x64': '@skilletmd/cli-win32-x64',
};

function resolveNativeBinary() {
  const pkgName = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`];
  if (!pkgName) return null;
  try {
    const pkgJson = require.resolve(`${pkgName}/package.json`);
    const binName = process.platform === 'win32' ? 'skillet.exe' : 'skillet';
    const candidate = join(dirname(pkgJson), 'bin', binName);
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function execAndExit(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const native = resolveNativeBinary();
if (native) {
  execAndExit(native, process.argv.slice(2));
}

const cjs = join(pkgRoot, 'dist', 'cli.cjs');
if (!existsSync(cjs)) {
  console.error(
    'Skillet CLI: no native binary for this platform and dist/cli.cjs is missing. Run `pnpm bundle` in the monorepo or reinstall skilletmd.',
  );
  process.exit(1);
}

execAndExit(process.execPath, [cjs, ...process.argv.slice(2)]);
