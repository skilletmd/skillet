import { describe, expect, it } from 'vitest'
import { kitInstallCommand, normalizeSkillRef, skillInstallCommand } from './cli-install-commands'

describe('cli-install-commands', () => {
  it('builds a skill install command with npx and -y', () => {
    expect(skillInstallCommand('@alice/foo')).toBe('npx skilletmd add @alice/foo -y')
  })

  it('normalizes a ref without @', () => {
    expect(skillInstallCommand('alice/foo')).toBe('npx skilletmd add @alice/foo -y')
  })

  it('builds a kit install command', () => {
    expect(kitInstallCommand('alice', 'essentials')).toBe(
      'npx skilletmd add kit @alice/essentials -y',
    )
  })

  it('normalizeSkillRef leaves @ refs unchanged', () => {
    expect(normalizeSkillRef('@alice/foo')).toBe('@alice/foo')
  })
})
