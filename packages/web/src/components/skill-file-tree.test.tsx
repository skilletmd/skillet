import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SkillFileTree } from './skill-file-tree'
import { SKILL_ENTRYPOINT, formatBytes } from '@/lib/skill-bundle'
import type { SkillBundleFileEntry } from '@/lib/skill-bundle-content'
import type { SkillBundleAssets } from '@/lib/bundle-images'

afterEach(cleanup)

function file(path: string, text: string): SkillBundleFileEntry {
  return { path, kind: 'text', size: text.length, executable: false, text }
}

function binary(path: string, size = 64): SkillBundleFileEntry {
  return { path, kind: 'binary', size, executable: false }
}

const FILES: SkillBundleFileEntry[] = [
  file(SKILL_ENTRYPOINT, '# Entry\n'),
  file('scripts/validate.sh', 'line one\nline two\nflagged-line-here\nline four\n'),
]

describe('SkillFileTree deep-link (?view=)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/cloudflare/skills')
  })

  it('opens the file named in ?view= on mount', async () => {
    window.history.replaceState(null, '', '/cloudflare/skills?view=scripts%2Fvalidate.sh&line=3')
    render(<SkillFileTree files={FILES} author="cloudflare" slug="skills" />)

    // The targeted file's source is shown (it switched to the raw/source view and
    // selected the file), so its content is on screen.
    expect(await screen.findByText(/flagged-line-here/)).toBeInTheDocument()
    // The rail reflects the revealed file: its row is active (and present, having
    // expanded the parent folder), so the sidebar can scroll to it.
    const railRow = document.querySelector('[data-rail-path="scripts/validate.sh"]')
    expect(railRow).not.toBeNull()
    expect(railRow).toHaveAttribute('data-active', 'true')
    // The params are left in the URL on purpose — a refresh / shared link
    // re-reveals the same file (re-firing is idempotent).
    expect(window.location.search).toContain('view=')
  })

  it('is a no-op (no throw) when there is no reveal param', () => {
    expect(() =>
      render(<SkillFileTree files={FILES} author="cloudflare" slug="skills" />),
    ).not.toThrow()
    expect(window.location.search).toBe('')
  })

  it('ignores a reveal param pointing at a file the skill does not have', () => {
    window.history.replaceState(null, '', '/cloudflare/skills?view=nope.sh&line=1')
    render(<SkillFileTree files={FILES} author="cloudflare" slug="skills" />)
    // Unknown file → nothing revealed; the param is left in place (it never matched).
    expect(screen.queryByText(/flagged-line-here/)).not.toBeInTheDocument()
  })

  it('footer: bundle summary shows with the rail and hides when collapsed; the file size stays', () => {
    render(<SkillFileTree files={FILES} author="cloudflare" slug="skills" />)
    // Rail open by default: the bundle summary (count · total size) is present,
    // and the current file's size (SKILL.md entry) shows on the right.
    expect(screen.getByText(/\d+ files ·/)).toBeInTheDocument()
    expect(screen.getByText(formatBytes(FILES[0].size))).toBeInTheDocument()
    // Collapse the rail — the summary described the now-hidden list, so it goes…
    fireEvent.click(screen.getByRole('button', { name: 'Hide files' }))
    expect(screen.queryByText(/files ·/)).not.toBeInTheDocument()
    // …but the current file's size stays put.
    expect(screen.getByText(formatBytes(FILES[0].size))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show files' })).toBeInTheDocument()
  })

  it('image files: img chip, inline preview; other binaries keep bin + fallback', () => {
    const files = [
      file(SKILL_ENTRYPOINT, '# Entry\n'),
      binary('assets/preview.png'),
      binary('assets/data.zip'),
      binary('assets/logo.svg'),
    ]
    const assets: SkillBundleAssets = {
      author: 'cloudflare',
      slug: 'skills',
      versionHash: 'sha256:feed',
      sizes: Object.fromEntries(files.map((f) => [f.path, f.size])),
    }
    render(<SkillFileTree files={files} author="cloudflare" slug="skills" assets={assets} />)

    // Chips: images say img, other binaries keep bin.
    fireEvent.click(screen.getByTitle('assets'))
    expect(screen.getByTitle('assets/preview.png')).toHaveTextContent(/img$/)
    expect(screen.getByTitle('assets/data.zip')).toHaveTextContent(/bin$/)
    expect(screen.getByTitle('assets/logo.svg')).toHaveTextContent(/bin$/)

    // Selecting the png shows the image through the proxy files route.
    fireEvent.click(screen.getByTitle('assets/preview.png'))
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/api/registry/api/v1/skills/cloudflare/skills/versions/sha256%3Afeed/files/assets/preview.png',
    )
    expect(screen.queryByText('Binary file. No preview available.')).not.toBeInTheDocument()

    // The zip keeps the binary fallback.
    fireEvent.click(screen.getByTitle('assets/data.zip'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Binary file. No preview available.')).toBeInTheDocument()

    // SVG is excluded from inline rendering (download-only).
    fireEvent.click(screen.getByTitle('assets/logo.svg'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Binary file. No preview available.')).toBeInTheDocument()
  })

  it('a failed image preview falls back to the binary message, not a broken icon', () => {
    const files = [file(SKILL_ENTRYPOINT, '# Entry\n'), binary('assets/preview.png')]
    const assets: SkillBundleAssets = {
      author: 'cloudflare',
      slug: 'skills',
      versionHash: 'sha256:feed',
      sizes: Object.fromEntries(files.map((f) => [f.path, f.size])),
    }
    render(<SkillFileTree files={files} author="cloudflare" slug="skills" assets={assets} />)
    fireEvent.click(screen.getByTitle('assets'))
    fireEvent.click(screen.getByTitle('assets/preview.png'))
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Binary file. No preview available.')).toBeInTheDocument()
  })

  it('treats a .mdc file as markdown — offers the rendered/source toggle', async () => {
    window.history.replaceState(null, '', '/cloudflare/skills?view=rules%2Fx.mdc')
    const files = [
      file(SKILL_ENTRYPOINT, '# Entry\n'),
      file('rules/x.mdc', '---\ndescription: y\n---\n# Rules\n'),
    ]
    render(<SkillFileTree files={files} author="cloudflare" slug="skills" />)
    // The markdown view toggle only renders for a markdown file, so its presence
    // proves `.mdc` is recognized as markdown.
    expect(await screen.findByRole('button', { name: /Show source|Show rendered/ })).toBeInTheDocument()
  })
})
