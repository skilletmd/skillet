#!/usr/bin/env node
/**
 * Build workspace packages required before bundling or native-compiling the CLI.
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const steps = [
  'pnpm --filter @skillet/protocol build',
  'pnpm --filter @skillet/core build',
  'pnpm --filter @skillet/mcp build',
  'pnpm --filter "@skillet/adapters-*" build',
];

export function buildCliDeps() {
  for (const step of steps) {
    execSync(step, { cwd: repoRoot, stdio: 'inherit' });
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  buildCliDeps();
}
