#!/usr/bin/env node
/**
 * Remove setup-node's _authToken line so npm publish uses Trusted Publisher OIDC.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const npmrcPath =
  process.env['NPM_CONFIG_USERCONFIG'] ??
  join(process.env['HOME'] ?? process.env['USERPROFILE'] ?? homedir(), '.npmrc');

if (!existsSync(npmrcPath)) {
  console.log(`No npmrc at ${npmrcPath}; OIDC publish can proceed.`);
  process.exit(0);
}

const lines = readFileSync(npmrcPath, 'utf8').split(/\r?\n/);
const kept = lines.filter(
  (line) =>
    line.trim() &&
    !line.includes('_authToken') &&
    !/^\s*always-auth\s*=/i.test(line),
);

writeFileSync(npmrcPath, kept.length ? `${kept.join('\n')}\n` : '');
console.log(`Prepared ${npmrcPath} for OIDC publish (removed _authToken).`);
