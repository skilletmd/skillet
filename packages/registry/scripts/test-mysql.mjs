#!/usr/bin/env node
/**
 * Run the registry suite against a live MySQL.
 *
 * Replaces the POSIX-only `VAR=x OTHER="${VAR:-default}" pnpm test` form, which
 * cmd.exe cannot parse (it treats the assignments as a command name), so
 * `pnpm test:mysql` failed on Windows before reaching a single test.
 *
 * DATABASE_URL is only defaulted when unset, matching the old `${VAR:-default}`
 * behavior. The harness rewrites whatever it gets to the `_test` sibling
 * database, so this never points at a developer's dev data.
 */
import { spawnSync } from 'node:child_process';

process.env.SKILLET_MYSQL_TESTS = '1';
if (!(process.env.DATABASE_URL ?? '').trim()) {
  process.env.DATABASE_URL = 'mysql://skillet:skillet@127.0.0.1:3307/skillet_registry';
}

// pnpm resolves to pnpm.cmd on Windows, and Node refuses to spawn a .cmd
// without a shell (EINVAL, CVE-2024-27980 hardening). No user input reaches
// this command line, so the shell is safe here.
const result = spawnSync('pnpm', ['test'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`test:mysql failed to start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
