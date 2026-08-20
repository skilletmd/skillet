import { describe, expect, it } from 'vitest'
import {
  bundlePathError,
  computeBundleDiff,
  decodeFile,
  entryFromBytes,
  hasBundleChanges,
  isJunkPath,
  isLikelyExecutable,
  removeBundleFile,
  renameBundleFile,
  setBundleFile,
  validateBundleFiles,
  type BundleFiles,
} from '@/lib/skill-bundle'

/** base64 of arbitrary bytes, for binary-file cases. */
function b64(bytes: number[]): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

describe('decodeFile', () => {
  it('decodes utf8 entries as text', () => {
    const d = decodeFile({ enc: 'utf8', data: 'hello' })
    expect(d.binary).toBe(false)
    expect(d.text).toBe('hello')
  })

  it('decodes printable base64 as text', () => {
    const d = decodeFile({ enc: 'base64', data: btoa('plain text') })
    expect(d.binary).toBe(false)
    expect(d.text).toBe('plain text')
  })

  it('flags base64 with a NUL byte as binary', () => {
    const d = decodeFile({ enc: 'base64', data: b64([0x00, 0x01, 0x02]) })
    expect(d.binary).toBe(true)
    expect(d.text).toBeNull()
  })
})

describe('computeBundleDiff — grading', () => {
  const base: BundleFiles = {
    'SKILL.md': { enc: 'utf8', data: 'line one\nline two\n' },
    'keep.txt': { enc: 'utf8', data: 'unchanged\n' },
    'gone.txt': { enc: 'utf8', data: 'remove me\n' },
  }
  const proposed: BundleFiles = {
    'SKILL.md': { enc: 'utf8', data: 'line one\nline TWO\nline three\n' },
    'keep.txt': { enc: 'utf8', data: 'unchanged\n' },
    'new.txt': { enc: 'utf8', data: 'brand new\n' },
  }

  it('grades added / removed / modified / unchanged and sorts by path', () => {
    const diff = computeBundleDiff(base, proposed)
    expect(diff.map((d) => [d.path, d.status])).toEqual([
      ['SKILL.md', 'modified'],
      ['gone.txt', 'removed'],
      ['keep.txt', 'unchanged'],
      ['new.txt', 'added'],
    ])
  })

  it('renders a unified diff body for modified text files', () => {
    const skill = computeBundleDiff(base, proposed).find((d) => d.path === 'SKILL.md')!
    expect(skill.diff).toContain(' line one')
    expect(skill.diff).toContain('-line two')
    expect(skill.diff).toContain('+line TWO')
    expect(skill.diff).toContain('+line three')
  })

  it('does not render a phantom trailing blank line when appending content at EOF', () => {
    // A file ending in "\n" is N lines, not N+1. Appending "hey" after a terminal
    // block must not show the shifted final newline as an extra "+" after "hey"
    // (the "even though the caret ends at hey, it says I added an extra line" bug).
    const b: BundleFiles = { 'SKILL.md': { enc: 'utf8', data: '```\ncode\n```\n' } }
    const p: BundleFiles = { 'SKILL.md': { enc: 'utf8', data: '```\ncode\n```\n\nhey\n' } }
    const diff = computeBundleDiff(b, p)[0].diff!
    const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    // The blank markdown separator, then hey — and nothing after it.
    expect(added).toEqual(['+', '+hey'])
  })

  it('leaves unchanged and removed files without a diff body', () => {
    const diff = computeBundleDiff(base, proposed)
    expect(diff.find((d) => d.path === 'keep.txt')!.diff).toBeNull()
    expect(diff.find((d) => d.path === 'gone.txt')!.diff).toBeNull()
  })

  it('grades binary changes without a diff body', () => {
    const b: BundleFiles = { 'logo.png': { enc: 'base64', data: b64([0x00, 0x01]) } }
    const p: BundleFiles = { 'logo.png': { enc: 'base64', data: b64([0x00, 0x02]) } }
    const [diff] = computeBundleDiff(b, p)
    expect(diff.status).toBe('modified')
    expect(diff.binary).toBe(true)
    expect(diff.diff).toBeNull()
  })

  it('treats byte-identical files across encodings as unchanged', () => {
    const b: BundleFiles = { 'a.txt': { enc: 'utf8', data: 'same' } }
    const p: BundleFiles = { 'a.txt': { enc: 'base64', data: btoa('same') } }
    expect(computeBundleDiff(b, p)[0].status).toBe('unchanged')
  })
})

describe('hasBundleChanges', () => {
  it('is false when nothing changed', () => {
    const files: BundleFiles = { 'SKILL.md': { enc: 'utf8', data: 'x' } }
    expect(hasBundleChanges(files, files)).toBe(false)
  })

  it('is true when a file was added', () => {
    const base: BundleFiles = { 'SKILL.md': { enc: 'utf8', data: 'x' } }
    const proposed: BundleFiles = { ...base, 'new.txt': { enc: 'utf8', data: 'y' } }
    expect(hasBundleChanges(base, proposed)).toBe(true)
  })
})

describe('entryFromBytes', () => {
  it('encodes clean UTF-8 as a text entry', () => {
    const entry = entryFromBytes(new TextEncoder().encode('hello world'))
    expect(entry).toEqual({ enc: 'utf8', data: 'hello world' })
  })

  it('encodes bytes with a NUL byte as base64 and round-trips', () => {
    const bytes = new Uint8Array([0x00, 0x10, 0xff, 0x42])
    const entry = entryFromBytes(bytes)
    expect(entry.enc).toBe('base64')
    expect(Array.from(decodeFile(entry).bytes)).toEqual(Array.from(bytes))
  })
})

describe('bundlePathError', () => {
  it('accepts safe relative POSIX paths', () => {
    expect(bundlePathError('references/notes.md')).toBeNull()
  })

  it('rejects traversal, absolute, backslash, and trailing-slash paths', () => {
    expect(bundlePathError('../escape.md')).not.toBeNull()
    expect(bundlePathError('/etc/passwd')).not.toBeNull()
    expect(bundlePathError('a\\b.md')).not.toBeNull()
    expect(bundlePathError('dir/')).not.toBeNull()
    expect(bundlePathError('')).not.toBeNull()
  })

  it('rejects dotfiles and blocked config paths like the server', () => {
    expect(bundlePathError('settings.json')).not.toBeNull()
    expect(bundlePathError('hooks/pre-run.sh')).not.toBeNull()
    expect(bundlePathError('.git/config')).not.toBeNull()
  })
})

describe('isJunkPath', () => {
  it('flags VCS and build-artifact directories', () => {
    expect(isJunkPath('.git/config')).toBe(true)
    expect(isJunkPath('scripts/node_modules/x.js')).toBe(true)
    expect(isJunkPath('references/notes.md')).toBe(false)
  })

  it('flags dotfiles (they can never live in a bundle)', () => {
    expect(isJunkPath('templates/worker/.gitignore')).toBe(true)
    expect(isJunkPath('.env')).toBe(true)
    expect(isJunkPath('.editorconfig')).toBe(true)
    // A dot-directory with a normal filename is allowed by the wire format.
    expect(isJunkPath('.claude/config.json')).toBe(false)
  })
})

describe('isLikelyExecutable', () => {
  it('flags by extension', () => {
    expect(isLikelyExecutable('scripts/run.sh', new Uint8Array())).toBe(true)
    expect(isLikelyExecutable('bin/tool.exe', new Uint8Array())).toBe(true)
  })

  it('flags by shebang and ELF magic', () => {
    expect(isLikelyExecutable('go', new Uint8Array([0x23, 0x21, 0x2f]))).toBe(true)
    expect(isLikelyExecutable('a.out', new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toBe(true)
  })

  it('does not flag plain text', () => {
    expect(isLikelyExecutable('references/notes.md', new TextEncoder().encode('# notes'))).toBe(
      false,
    )
  })
})

describe('validateBundleFiles', () => {
  it('reports a missing SKILL.md as incomplete, not a hard error', () => {
    const result = validateBundleFiles({ 'a.txt': { enc: 'utf8', data: 'x' } })
    expect(result.errors).toEqual([])
    expect(result.incomplete.some((e) => e.includes('SKILL.md'))).toBe(true)
  })

  it('does not flag executables — they publish without a validation warning', () => {
    // Scripts are surfaced by the rail `exec` badge, the install-time consent
    // prompt, and the harm scanner — not by a stack of per-file banners here.
    const result = validateBundleFiles({
      'SKILL.md': { enc: 'utf8', data: '# ok' },
      'scripts/run.sh': { enc: 'utf8', data: '#!/bin/sh\necho hi' },
    })
    expect(result.errors).toEqual([])
  })

  it('errors on an unsafe path', () => {
    const result = validateBundleFiles({
      'SKILL.md': { enc: 'utf8', data: '# ok' },
      '../evil.md': { enc: 'utf8', data: 'x' },
    })
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('reports frontmatter-only SKILL.md (empty body) as incomplete', () => {
    const result = validateBundleFiles({
      'SKILL.md': { enc: 'utf8', data: '---\nname: My Skill\n---\n\n   \n' },
    })
    expect(result.errors).toEqual([])
    expect(result.incomplete.some((e) => e.includes('instructions'))).toBe(true)
  })

  it('reports an entirely empty SKILL.md as incomplete', () => {
    const result = validateBundleFiles({
      'SKILL.md': { enc: 'utf8', data: '   \n' },
    })
    expect(result.errors).toEqual([])
    expect(result.incomplete.some((e) => e.includes('instructions'))).toBe(true)
  })

  it('accepts SKILL.md with frontmatter and a real body', () => {
    const result = validateBundleFiles({
      'SKILL.md': { enc: 'utf8', data: '---\nname: My Skill\n---\n\nDo the thing when asked.\n' },
    })
    expect(result.errors).toEqual([])
    expect(result.incomplete).toEqual([])
  })
})

describe('bundle mutations', () => {
  const base: BundleFiles = {
    'SKILL.md': { enc: 'utf8', data: '# s' },
    'a.txt': { enc: 'utf8', data: 'a' },
  }

  it('sets, removes, and renames without mutating the input', () => {
    const added = setBundleFile(base, 'b.txt', { enc: 'utf8', data: 'b' })
    expect(Object.keys(added).sort()).toEqual(['SKILL.md', 'a.txt', 'b.txt'])
    expect(Object.keys(base).sort()).toEqual(['SKILL.md', 'a.txt'])

    const removed = removeBundleFile(base, 'a.txt')
    expect(Object.keys(removed)).toEqual(['SKILL.md'])

    const renamed = renameBundleFile(base, 'a.txt', 'docs/a.txt')
    expect(renamed['docs/a.txt']).toEqual({ enc: 'utf8', data: 'a' })
    expect(renamed['a.txt']).toBeUndefined()
  })
})
