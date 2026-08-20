import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VersionHistory } from '@/components/skills/version-history'
import type { SkillVersion } from '@/lib/types'

// The component fetches the file index + SKILL.md at two hashes via the BFF
// helpers; stub both so the test drives the real expand → fetch → diff → render
// path (including whole-tree file detection) without a network.
const indexMock = vi.fn()
const fileMock = vi.fn()
vi.mock('@/lib/skill-bundle-file-fetch', () => ({
  fetchSkillBundleFileIndexClient: (...args: unknown[]) => indexMock(...args),
  fetchSkillBundleFileClient: (...args: unknown[]) => fileMock(...args),
}))

const VERSIONS: SkillVersion[] = [
  { version: 'v1.1.0', publishedAt: '2026-07-13T00:00:00Z', hash: 'hashB' },
  { version: 'v1.0.0', publishedAt: '2026-07-13T00:00:00Z', hash: 'hashA' },
]

const OLD_SKILL = 'Line one\nLine two\nLine three'
const NEW_SKILL = 'Line one\nLine two changed\nLine three\nLine four'
const NEW_SCRIPT = '#!/bin/sh\necho hi'

const textFile = (text: string) => ({ path: 'x', kind: 'text', size: text.length, executable: false, text })
const indexEntry = (path: string, size: number) => ({ path, kind: 'text' as const, size, executable: false })

beforeEach(() => {
  indexMock.mockReset()
  fileMock.mockReset()

  indexMock.mockImplementation((_a: string, _s: string, hash: string) =>
    Promise.resolve(
      hash === 'hashB'
        ? [indexEntry('SKILL.md', NEW_SKILL.length), indexEntry('scripts/run.sh', NEW_SCRIPT.length)]
        : [indexEntry('SKILL.md', OLD_SKILL.length)],
    ),
  )
  fileMock.mockImplementation((_a: string, _s: string, hash: string, path: string) => {
    if (path === 'SKILL.md') return Promise.resolve(textFile(hash === 'hashB' ? NEW_SKILL : OLD_SKILL))
    if (path === 'scripts/run.sh' && hash === 'hashB') return Promise.resolve(textFile(NEW_SCRIPT))
    return Promise.resolve(null)
  })
})

describe('VersionHistory', () => {
  it('renders each version as a collapsed row by default and fetches nothing', () => {
    render(<VersionHistory versions={VERSIONS} author="alice" slug="my-skill" />)
    expect(screen.getByText('v1.1.0')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(indexMock).not.toHaveBeenCalled()
    expect(fileMock).not.toHaveBeenCalled()
  })

  it('expands to a whole-tree diff: modified SKILL.md and an added file', async () => {
    const user = userEvent.setup()
    render(<VersionHistory versions={VERSIONS} author="alice" slug="my-skill" />)

    await user.click(screen.getByRole('button', { name: /v1\.1\.0/ }))

    // File index fetched for both versions.
    await waitFor(() => expect(indexMock).toHaveBeenCalledTimes(2))

    // SKILL.md diff surfaces the changed + added lines and the removed original.
    await waitFor(() => {
      expect(screen.getByText('Line two changed')).toBeInTheDocument()
    })
    expect(screen.getByText('Line four')).toBeInTheDocument()
    expect(screen.getByText('Line two')).toBeInTheDocument()

    // The newly added supporting file shows up as its own diff, labeled "added".
    expect(screen.getByText('scripts/run.sh')).toBeInTheDocument()
    expect(screen.getByText('added')).toBeInTheDocument()
    expect(screen.getByText('echo hi')).toBeInTheDocument()
  })

  it('labels the oldest version as the initial version (no previous to diff)', async () => {
    const user = userEvent.setup()
    render(<VersionHistory versions={VERSIONS} author="alice" slug="my-skill" />)

    await user.click(screen.getByRole('button', { name: /v1\.0\.0/ }))

    expect(await screen.findByText('Initial version.')).toBeInTheDocument()
    expect(indexMock).not.toHaveBeenCalled()
    expect(fileMock).not.toHaveBeenCalled()
  })
})
