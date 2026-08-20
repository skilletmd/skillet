/**
 * Native binary compile smoke (skipped when Bun is not installed).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, chmod, readdir } from 'node:fs/promises';
import { spawnSync, execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildScript = join(pkgRoot, 'scripts', 'build-native.mjs');
const cliBundle = join(pkgRoot, 'dist', 'cli.cjs');
const nativeDir = join(pkgRoot, 'dist', 'native');

function resolveBunBin() {
  return process.env['BUN_INSTALL']
    ? join(process.env['BUN_INSTALL'], 'bin', 'bun')
    : join(homedir(), '.bun', 'bin', 'bun');
}

test('compiles cli.cjs and runs --version when Bun is installed', async (t) => {
  try {
    await access(resolveBunBin());
  } catch {
    t.skip('Bun not installed');
    return;
  }

  try {
    await access(cliBundle);
  } catch {
    execSync('pnpm bundle', { cwd: pkgRoot, stdio: 'inherit' });
  }

  execSync(`node "${buildScript}"`, { cwd: pkgRoot, stdio: 'inherit' });

  const entries = await readdir(nativeDir);
  const binaryName = entries.find((name) => name.startsWith('skillet-'));
  assert.ok(binaryName);
  const binary = join(nativeDir, binaryName);
  await chmod(binary, 0o755);

  const version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.match(version.stdout.trim(), /\d+\.\d+\.\d+/);
});
