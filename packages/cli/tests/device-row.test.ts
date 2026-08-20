import assert from 'node:assert/strict'
import test from 'node:test'
import { Command, Help } from 'commander'
import { formatSkilletHelp } from '../src/help-format.js'

const helper = new Help()

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

test('device collapses to one row in root help', async () => {
  const { registerAllCommands } = await import('../src/commands/register-all.js')
  const program = new Command('skillet').version('0.1.14')
  registerAllCommands(program)

  const text = stripAnsi(formatSkilletHelp(program, helper))
  // `device show`/`device list`/`device rename` collapsed to a single `device`
  // row: the bare command is the overview, the subcommands live behind it.
  assert.match(text, /^\s+device\s/m)
  assert.doesNotMatch(text, /device show/)
  assert.doesNotMatch(text, /device rename <label>/)
  // Neighbors that must stay in / out of the root surface.
  assert.match(text, /scan/)
  assert.doesNotMatch(text, /\n  restore/m)
  assert.doesNotMatch(text, /\n  sweep/m)
  assert.doesNotMatch(text, /auth status/)
  assert.doesNotMatch(text, /auth logout/)
  assert.doesNotMatch(text, /trust show/)
  assert.doesNotMatch(text, /auth login/)
})
