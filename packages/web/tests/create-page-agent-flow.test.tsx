import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NPX_SKILLET_COMMAND } from '@/config'

// `/create` is the page named for the thing `/skillet create` does, and the
// agent flow is the good path: it drafts from work the person already did
// instead of handing them a blank SKILL.md. It leads the page deliberately, so
// pin that it is present and still first.
const SOURCE = readFileSync(
  join(process.cwd(), 'src/app/(consumer)/create/page.tsx'),
  'utf8',
)

describe('the create page leads with the agent flow', () => {
  it('shows both commands', () => {
    expect(SOURCE).toContain('NPX_SKILLET_COMMAND')
    expect(SOURCE).toContain('/skillet create')
  })

  it('renders the slash command without a shell prompt glyph', () => {
    // `$ /skillet create` would read as a terminal command and send people to
    // the wrong place. The prompt/no-prompt pair is what tells them which line
    // runs where, which is why the explaining caption could be cut.
    expect(SOURCE).toMatch(/command="\/skillet create"[^/]*prompt=\{null\}/)
  })

  it('puts the agent flow above the blank-skill card', () => {
    // Compare the JSX sites, not raw file offsets: CREATE_OPTIONS is declared
    // at the top of the module, so source order there says nothing about what
    // renders first.
    const agentBlock = SOURCE.indexOf('command="/skillet create"')
    const optionGrid = SOURCE.indexOf('{CREATE_OPTIONS.map(')
    expect(agentBlock).toBeGreaterThan(-1)
    expect(optionGrid).toBeGreaterThan(-1)
    expect(agentBlock).toBeLessThan(optionGrid)
  })

  it('uses the canonical install command, not a hand-written one', () => {
    expect(NPX_SKILLET_COMMAND).toBe('npx skilletmd')
    expect(SOURCE).not.toMatch(/command="npx /)
  })
})
