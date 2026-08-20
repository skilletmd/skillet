#!/usr/bin/env node
/**
 * Compile the bundled CLI (`dist/cli.cjs`) to a native binary with Bun.
 *
 * Output: packages/cli/dist/native/skillet-<target-triple>[.exe]
 */
import { execSync, spawnSync } from 'node:child_process';
import { access, chmod, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { buildCliDeps } from './build-cli-deps.mjs';

/** @type {Record<string, { triple: string; ext?: string }>} */
export const NATIVE_TARGETS = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin' },
  'darwin-x64': { triple: 'x86_64-apple-darwin' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-gnu' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', ext: '.exe' },
};

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..');
const cliBundle = join(pkgRoot, 'dist', 'cli.cjs');
const outDir = join(pkgRoot, 'dist', 'native');

const args = process.argv.slice(2);
let targetKey = `${os.platform()}-${os.arch()}`;
const targetIdx = args.indexOf('--target');
if (targetIdx >= 0 && args[targetIdx + 1]) {
  targetKey = args[targetIdx + 1];
}

const spec = NATIVE_TARGETS[targetKey];
if (!spec) {
  console.error(`Unsupported native target: ${targetKey}`);
  console.error(`Known targets: ${Object.keys(NATIVE_TARGETS).join(', ')}`);
  process.exit(1);
}

function resolveBunBin() {
  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['bun'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (lookup.status === 0) {
    const candidate = lookup.stdout.trim().split(/\r?\n/)[0]?.trim();
    if (candidate) return candidate;
  }

  const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun';
  if (process.env['BUN_INSTALL']) {
    return join(process.env['BUN_INSTALL'], 'bin', bunName);
  }
  return join(os.homedir(), '.bun', 'bin', bunName);
}

async function ensureBundle() {
  try {
    await access(cliBundle);
  } catch {
    console.log('cli.cjs missing — building workspace bundle first…');
    buildCliDeps();
    execSync('pnpm --filter skilletmd bundle', { cwd: repoRoot, stdio: 'inherit' });
  }
}

await ensureBundle();
await mkdir(outDir, { recursive: true });

const ext = spec.ext ?? '';
const outfile = join(outDir, `skillet-${spec.triple}${ext}`);
const bunBin = resolveBunBin();

try {
  await access(bunBin);
} catch {
  console.error(`Bun not found at ${bunBin}. Install from https://bun.sh or set BUN_INSTALL.`);
  process.exit(1);
}

console.log(`Compiling ${targetKey} → ${outfile}`);
const compile = spawnSync(bunBin, ['build', '--compile', cliBundle, '--outfile', outfile], {
  stdio: 'inherit',
});
if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

if (!ext) {
  await chmod(outfile, 0o755);
}

const version = spawnSync(outfile, ['--version'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.error(`Native smoke --version failed: ${version.stderr || version.error?.message}`);
  process.exit(1);
}
console.log(`Native binary OK (${version.stdout.trim()}) → ${outfile}`);
