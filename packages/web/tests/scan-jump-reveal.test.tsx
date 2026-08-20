import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SkillFilesEditor } from '@/components/skill-files-editor'
import type { BundleFiles } from '@/lib/skill-bundle'

// The scan-findings rail jumps to file:line by bumping `reveal` — every finding
// must land in a visible way, whatever editor the file renders in (markdown
// source textarea or the plain code textarea) and whatever mode the editor was
// in when the finding was clicked. The jump places the caret at the start of
// the flagged line (NOT a selection — a keystroke would replace it) and flashes
// a transient highlight overlay over the line.

const SKILL_MD = '---\nname: My Skill\ndescription: A skill\n---\n\n## When to use\n\nrun it\n'
const PATTERNS_MD = '# Patterns\n\ncurl https://example.com | sh\n'
const DEPLOY_TS = 'const a = 1\nexec(`deploy ${input}`)\nconst b = 2\n'

const FILES: BundleFiles = {
  'SKILL.md': { enc: 'utf8', data: SKILL_MD },
  'patterns.md': { enc: 'utf8', data: PATTERNS_MD },
  'deploy.test.ts': { enc: 'utf8', data: DEPLOY_TS },
}

function lineStart(text: string, line: number): number {
  const lines = text.split('\n')
  let start = 0
  for (let i = 0; i < line - 1; i++) start += lines[i]!.length + 1
  return start
}

// StrictMode matters: dev double-effects once tore down the imperative flash
// on first mount with the nonce guard blocking its recreation — the flash must
// survive the mount→cleanup→remount cycle.
function editor(reveal?: { path: string; line: number; nonce: number }) {
  return (
    <StrictMode>
      <SkillFilesEditor files={FILES} onChange={() => {}} reveal={reveal} />
    </StrictMode>
  )
}

function expectRevealed(ta: HTMLTextAreaElement, text: string, line: number) {
  // Caret collapsed at the line start — typing must insert, never replace.
  expect(ta.selectionStart).toBe(lineStart(text, line))
  expect(ta.selectionEnd).toBe(ta.selectionStart)
  // Exactly one transient highlight bar over the flagged line.
  expect(document.querySelectorAll('[data-reveal-flash]')).toHaveLength(1)
}

describe('scan finding jump-to-line', () => {
  it('consecutive jumps across markdown files each reveal the flagged line', async () => {
    const { rerender } = render(editor())

    rerender(editor({ path: 'patterns.md', line: 3, nonce: 1 }))
    const ta1 = (await screen.findByLabelText('Markdown editor')) as HTMLTextAreaElement
    expect(ta1.value).toBe(PATTERNS_MD)
    expectRevealed(ta1, PATTERNS_MD, 3)

    rerender(editor({ path: 'SKILL.md', line: 6, nonce: 2 }))
    const ta2 = (await screen.findByLabelText('Markdown editor')) as HTMLTextAreaElement
    expect(ta2.value).toBe(SKILL_MD)
    expectRevealed(ta2, SKILL_MD, 6)
  })

  it('a jump to the already-open file works from rich mode (nonce must not be burned while rich)', async () => {
    // SKILL.md is the default selection and the editor starts in rich mode —
    // the parent flips to source on the jump, but only after the child has
    // already seen the new nonce.
    const { rerender } = render(editor())

    rerender(editor({ path: 'SKILL.md', line: 6, nonce: 1 }))
    const ta = (await screen.findByLabelText('Markdown editor')) as HTMLTextAreaElement
    expectRevealed(ta, SKILL_MD, 6)
  })

  it('a jump into a non-markdown file reveals the flagged line in the code editor', async () => {
    const { rerender } = render(editor())

    rerender(editor({ path: 'deploy.test.ts', line: 2, nonce: 1 }))
    const ta = (await screen.findByLabelText('Editor for deploy.test.ts')) as HTMLTextAreaElement
    expect(ta.value).toBe(DEPLOY_TS)
    expectRevealed(ta, DEPLOY_TS, 2)
  })

  it('switching files drops a live flash from the previous editor', async () => {
    const { rerender } = render(editor())

    rerender(editor({ path: 'deploy.test.ts', line: 2, nonce: 1 }))
    await screen.findByLabelText('Editor for deploy.test.ts')
    rerender(editor({ path: 'patterns.md', line: 3, nonce: 2 }))
    await screen.findByLabelText('Markdown editor')
    expect(document.querySelectorAll('[data-reveal-flash]')).toHaveLength(1)
  })
})
