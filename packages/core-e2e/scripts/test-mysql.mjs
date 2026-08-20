#!/usr/bin/env node
/**
 * Run the cross-package e2e suites against a live MySQL.
 *
 * Replaces the POSIX-only `SKILLET_MYSQL_TESTS=1 pnpm test:e2e` form. cmd.exe
 * reads a leading `VAR=value` as the name of a program, so that script failed on
 * Windows before running anything.
 *
 * The suites take their database from CORE_E2E_DATABASE_URL (default
 * mysql://root:skillet@127.0.0.1:3307/skillet_core_e2e, matching
 * docker-compose.mysql.yml) and probe the port first, so they skip rather than
 * hang when MySQL is not up.
 */
import { spawnSync } from 'node:child_process';

process.env.SKILLET_MYSQL_TESTS = '1';

// pnpm resolves to pnpm.cmd on Windows, and Node refuses to spawn a .cmd
// without a shell (EINVAL, CVE-2024-27980 hardening). No user input reaches
// this command line, so the shell is safe here.
const result = spawnSync('pnpm', ['test:e2e'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`test:mysql failed to start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
