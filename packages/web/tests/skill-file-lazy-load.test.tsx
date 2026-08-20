import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FilesSection } from '@/components/skills/files-section'

vi.mock('@/lib/skill-bundle-file-fetch', () => ({
  fetchSkillBundleFileClient: vi.fn(),
}))

import { fetchSkillBundleFileClient } from '@/lib/skill-bundle-file-fetch'

const mockFetch = vi.mocked(fetchSkillBundleFileClient)

const FILES = [
  { path: 'SKILL.md', kind: 'text' as const, size: 10, executable: false },
  { path: 'references/notes.md', kind: 'text' as const, size: 8, executable: false },
]

describe('FilesSection lazy file loading', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('fetches supporting file text when a path is selected', async () => {
    mockFetch.mockResolvedValue({
      path: 'references/notes.md',
      kind: 'text',
      size: 8,
      executable: false,
      text: '# Notes',
    })

    render(
      <FilesSection
        files={FILES}
        versionHash="sha256:abc"
        author="alice"
        slug="demo"
        skillMdSlot={<div>skill md</div>}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'references' }))
    await user.click(screen.getByRole('button', { name: 'notes.md' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('alice', 'demo', 'sha256:abc', 'references/notes.md')
    })
    expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument()
  })
})
