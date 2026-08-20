import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWebUrl } from '../src/open-browser-url.js'

test('resolveWebUrl returns base when path is omitted', () => {
  const prev = process.env['SKILLET_WEB_URL']
  process.env['SKILLET_WEB_URL'] = 'https://staging.skillet.md/'
  try {
    assert.equal(resolveWebUrl(), 'https://staging.skillet.md')
    assert.equal(resolveWebUrl(''), 'https://staging.skillet.md')
  } finally {
    if (prev === undefined) delete process.env['SKILLET_WEB_URL']
    else process.env['SKILLET_WEB_URL'] = prev
  }
})

test('resolveWebUrl appends site-relative paths only', () => {
  assert.equal(resolveWebUrl('/settings'), 'https://skillet.md/settings')
  // A bare path is shorthand for the rooted form.
  assert.equal(resolveWebUrl('settings'), 'https://skillet.md/settings')
  // Protocol-relative input would target another origin — rejected.
  assert.throws(() => resolveWebUrl('//evil.example'), /site-relative/)
  // A pasted absolute URL stays on the skillet.md origin, never breaks out.
  assert.equal(
    resolveWebUrl('https://evil.example'),
    'https://skillet.md/https://evil.example',
  )
})

test('web command is registered on the device surface', async () => {
  const { Command } = await import('commander')
  const { registerAllCommands } = await import('../src/commands/register-all.js')
  const program = new Command('skillet')
  registerAllCommands(program)
  const web = program.commands.find((c) => c.name() === 'web')
  assert.ok(web)
  assert.match(web!.description() ?? '', /browser/i)
})
