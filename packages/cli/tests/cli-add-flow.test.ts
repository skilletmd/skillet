import assert from 'node:assert/strict';
import test from 'node:test';
import { Command } from 'commander';
import { registerAddCommand } from '../src/commands/add-cmd.js';

test('add command registers on device surface', () => {
  const program = new Command('skillet');
  registerAddCommand(program);
  const add = program.commands.find((c) => c.name() === 'add');
  assert.ok(add);
  const kit = add!.commands.find((c) => c.name() === 'kit');
  assert.ok(kit);
  const help = add!.helpInformation();
  assert.match(help, /--skill/);
  assert.match(help, /--list/);
  assert.match(help, /--yes/);
  assert.match(help, /--global/);
});
