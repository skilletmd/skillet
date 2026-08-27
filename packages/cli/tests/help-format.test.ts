import assert from 'node:assert/strict';
import test from 'node:test';
import { Command, Help } from 'commander';
import { formatSkilletHelp } from '../src/help-format.js';
import { registerAllCommands } from '../src/commands/register-all.js';
import { ROOT_FOOTER_POWER_COMMANDS, ROOT_SURFACE, rootHelpRowCount } from '../src/help/root-surface.js';

const helper = new Help();

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

test('root help lists journey groups and root-tier commands from matrix', () => {
  // Full registration: root help now resolves descriptions from the real
  // registered commands (single-source), so a toy program would throw.
  const program = new Command('skillet').version('0.1.2');
  registerAllCommands(program);

  const text = stripAnsi(formatSkilletHelp(program, helper));
  assert.match(text, /Skillet 0\.1\.2/);
  assert.match(text, /Getting started/);
  assert.match(text, /Sync & share/);
  assert.match(text, /This machine/);
  // `device` collapsed to one row; the subcommands live behind it.
  assert.match(text, /^\s+device\s/m);
  assert.doesNotMatch(text, /device show/);
  assert.match(text, /first run: connect, then sync/);

  for (const row of ROOT_SURFACE.filter((r) => r.tier === 'root')) {
    const escaped = row.usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(text, new RegExp(escaped));
  }

  // 17 since `create` earned a root row: it is the authoring front door, in the
  // same group as add/search/list. `eval` stays in the footer, not a row.
  assert.equal(rootHelpRowCount(), 17);
  assert.doesNotMatch(text, /kit create/);
  assert.doesNotMatch(text, /publish/);
  assert.doesNotMatch(text, /Trust/);
  assert.doesNotMatch(text, /auth login/);
  assert.doesNotMatch(text, /auth status/);
  assert.doesNotMatch(text, /^\s+import \[source\]\s/m);
  assert.doesNotMatch(text, /^\s+status\s/m);
  assert.doesNotMatch(text, /^\s+pending\s/m);
  assert.doesNotMatch(text, /^\s+trust\s/m);
  assert.doesNotMatch(text, /^\s+pin\s/m);
  assert.doesNotMatch(text, /update-mode/);
  // scan demoted off the root rows; it lives in the power-user footer now.
  assert.doesNotMatch(text, /^\s+scan\s/m);
  assert.doesNotMatch(text, /^\s+add kit\s/m);
  assert.doesNotMatch(text, /^\s+route\s/m);
  assert.match(text, /doctor/);
  assert.match(text, /usage/);
  assert.match(text, /activity/);

  // Footer lists the power-user commands by bare name (dot-separated), not as
  // repeated `skillet <cmd>` phrases.
  for (const cmd of ROOT_FOOTER_POWER_COMMANDS) {
    assert.match(text, new RegExp(`\\b${cmd}\\b`));
  }
});

test('root help lists mcp under Sync & share; route is hidden', () => {
  const program = new Command('skillet').version('0.1.2');
  registerAllCommands(program);

  const text = stripAnsi(formatSkilletHelp(program, helper));
  assert.match(text, /Sync & share/);
  assert.match(text, /mcp/);
  assert.doesNotMatch(text, /^\s+route\s/m);
  assert.doesNotMatch(text, /Advanced/);
  assert.doesNotMatch(text, /Agent clients/);
  assert.doesNotMatch(text, /Link & install/);
});

test('group help lists subcommands with descriptions', () => {
  const program = new Command('skillet');
  const auth = program.command('auth').description('Session commands');
  auth.command('login').description('Email magic link');
  auth.command('logout').description('Sign out');

  const text = stripAnsi(formatSkilletHelp(auth, helper));
  assert.match(text, /auth/);
  assert.match(text, /login/);
  assert.match(text, /Email magic link/);
  assert.match(text, /logout/);
});
