import { describe, it, expect } from 'vitest'
import {
  renderMarkdownToSafeHtml,
  parseEditDiff,
  changedFiles,
  diffToHtml,
  buildFileTree,
  fileIsMarkdown,
  frontmatterCardHtml,
  parseFrontmatter,
  humanSize,
  type EditDiffFile,
} from './viewer-render'

// The viewer renders UNTRUSTED skill markdown into innerHTML and shows a
// yours-vs-theirs diff (U6, AE5/AE6). These cover the pure render logic — the
// DOM wiring in viewer.ts is thin.

describe('renderMarkdownToSafeHtml (AE5 — markdown → sanitized HTML)', () => {
  it('renders headings, emphasis, and lists to HTML', () => {
    const html = renderMarkdownToSafeHtml('# Title\n\nSome **bold** text.\n\n- one\n- two')
    expect(html).toContain('<h1>')
    expect(html).toContain('Title')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<li>one</li>')
  })

  it('keeps a safe http(s) link and hardens it', () => {
    const html = renderMarkdownToSafeHtml('[docs](https://example.com/page)')
    expect(html).toContain('href="https://example.com/page"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })

  it('strips a script tag injected in the markdown', () => {
    // A raw <script> never survives sanitization. (In the happy-dom test env
    // DOMPurify empties the whole string here; the real WebKit/Chromium webview
    // keeps the sibling content — either way, no <script> reaches innerHTML.)
    const html = renderMarkdownToSafeHtml('ok\n\n<script>alert(1)</script>')
    expect(html).not.toContain('<script')
  })
})

describe('renderMarkdownToSafeHtml (AE6 — hostile links are inert)', () => {
  it('inerts a javascript: link (no href, scheme gone)', () => {
    const html = renderMarkdownToSafeHtml('[click](javascript:alert(1))')
    expect(html.toLowerCase()).not.toContain('javascript:')
    expect(html).not.toMatch(/href=/)
    // The link text survives as plain, un-clickable content.
    expect(html).toContain('click')
  })

  it('inerts a data: link', () => {
    const html = renderMarkdownToSafeHtml('[x](data:text/html,<script>alert(1)</script>)')
    expect(html.toLowerCase()).not.toContain('data:text/html')
    expect(html).not.toMatch(/href="data:/)
  })

  it('inerts a vbscript: link', () => {
    const html = renderMarkdownToSafeHtml('[y](vbscript:msgbox(1))')
    expect(html.toLowerCase()).not.toContain('vbscript:')
  })
})

describe('parseEditDiff', () => {
  it('parses the edit_diff JSON envelope', () => {
    const parsed = parseEditDiff(
      JSON.stringify({ ok: true, skill: '@a/b', files: [{ path: 'SKILL.md', status: 'changed' }] }),
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.files).toHaveLength(1)
  })

  it('never throws on malformed output — returns an error shape', () => {
    const parsed = parseEditDiff('not json')
    expect(parsed.ok).toBe(false)
    expect(parsed.files).toEqual([])
  })

  it('handles empty output', () => {
    const parsed = parseEditDiff('   ')
    expect(parsed.ok).toBe(false)
    expect(parsed.files).toEqual([])
  })
})

describe('diffToHtml (AE5 — added/removed/changed)', () => {
  it('names each changed file in a multi-file bundle', () => {
    const files: EditDiffFile[] = [
      { path: 'new.md', status: 'added' },
      { path: 'gone.md', status: 'removed' },
      { path: 'SKILL.md', status: 'changed' },
    ]
    const html = diffToHtml(files)
    // A bundle keeps a quiet filename per file (no +/−/~ git marks).
    expect(html).toContain('new.md')
    expect(html).toContain('gone.md')
    expect(html).toContain('SKILL.md')
    expect(html).toContain('vw-diff-head')
  })

  it('omits unchanged files from the view', () => {
    const html = diffToHtml([
      { path: 'same.md', status: 'unchanged' },
      { path: 'intro.md', status: 'changed' },
      { path: 'SKILL.md', status: 'changed' },
    ])
    expect(html).not.toContain('same.md')
    expect(html).toContain('intro.md')
    expect(html).toContain('SKILL.md')
  })

  it('renders line hunks (added/removed/context) when present', () => {
    const html = diffToHtml([
      {
        path: 'SKILL.md',
        status: 'changed',
        hunks: [
          { kind: 'ctx', text: 'intro' },
          { kind: 'del', text: 'old line' },
          { kind: 'add', text: 'new line' },
        ],
      },
    ])
    expect(html).toContain('vw-line-add')
    expect(html).toContain('vw-line-del')
    expect(html).toContain('vw-line-ctx')
    expect(html).toContain('new line')
    expect(html).toContain('old line')
    // A single-file skill is the common case — show just the changes, no filename.
    expect(html).not.toContain('SKILL.md')
  })

  it('escapes hostile file paths and hunk text', () => {
    const html = diffToHtml([
      { path: '<img src=x onerror=1>.md', status: 'changed', hunks: [{ kind: 'add', text: '<b>x</b>' }] },
      { path: 'SKILL.md', status: 'changed' },
    ])
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;img')
  })

  it('handles a binary/non-text file entry', () => {
    const html = diffToHtml([
      { path: 'logo.png', status: 'changed', binary: true },
      { path: 'SKILL.md', status: 'changed' },
    ])
    expect(html).toContain('logo.png')
    expect(html.toLowerCase()).toContain('binary')
  })

  it('renders an empty diff cleanly (nothing to reconcile)', () => {
    expect(diffToHtml([])).toContain('vw-diff-empty')
    expect(diffToHtml([{ path: 'a.md', status: 'unchanged' }])).toContain('vw-diff-empty')
  })
})

describe('changedFiles', () => {
  it('filters out unchanged files', () => {
    expect(
      changedFiles([
        { path: 'a', status: 'unchanged' },
        { path: 'b', status: 'changed' },
      ]),
    ).toEqual([{ path: 'b', status: 'changed' }])
  })
})

describe('fileIsMarkdown', () => {
  it('matches markdown extensions case-insensitively', () => {
    expect(fileIsMarkdown('SKILL.md')).toBe(true)
    expect(fileIsMarkdown('resources/GUIDE.MARKDOWN')).toBe(true)
    expect(fileIsMarkdown('notes.mdx')).toBe(true)
  })
  it('rejects non-markdown files', () => {
    expect(fileIsMarkdown('resources/deploy.sh')).toBe(false)
    expect(fileIsMarkdown('Archive.zip')).toBe(false)
    expect(fileIsMarkdown('README')).toBe(false)
  })
})

describe('humanSize', () => {
  it('formats bytes across units', () => {
    expect(humanSize(512)).toBe('512 B')
    expect(humanSize(1024)).toBe('1.0 KB')
    expect(humanSize(1536)).toBe('1.5 KB')
    expect(humanSize(48_000)).toBe('47 KB')
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('rounds to a whole number past 10 units', () => {
    expect(humanSize(15 * 1024)).toBe('15 KB')
  })
  it('guards bad input', () => {
    expect(humanSize(-1)).toBe('')
    expect(humanSize(NaN)).toBe('')
  })
})

describe('buildFileTree', () => {
  const files = [
    { rel: 'lib/auth.mjs', size: 100, binary: false },
    { rel: 'SKILL.md', size: 300, binary: false },
    { rel: 'lib/gates/cold.mjs', size: 50, binary: false },
    { rel: 'AGENTS.md', size: 80, binary: false },
    { rel: 'Archive.zip', size: 9000, binary: true },
  ]

  it('nests files into folders', () => {
    const tree = buildFileTree(files)
    const lib = tree.find((n) => n.kind === 'dir' && n.name === 'lib')
    expect(lib && lib.kind === 'dir').toBe(true)
    if (lib && lib.kind === 'dir') {
      const gates = lib.children.find((n) => n.kind === 'dir' && n.name === 'gates')
      expect(gates && gates.kind === 'dir').toBe(true)
      if (gates && gates.kind === 'dir') {
        expect(gates.children.map((c) => c.kind === 'file' && c.name)).toContain('cold.mjs')
      }
    }
  })

  it('orders SKILL.md first, then folders, then files', () => {
    const tree = buildFileTree(files)
    expect(tree[0].kind === 'file' && tree[0].rel).toBe('SKILL.md')
    // After SKILL.md: the lib folder (dir) precedes root files AGENTS.md / Archive.zip.
    const kinds = tree.map((n) => n.kind)
    const firstDir = kinds.indexOf('dir')
    const firstNonSkillFile = tree.findIndex(
      (n, i) => i > 0 && n.kind === 'file',
    )
    expect(firstDir).toBeLessThan(firstNonSkillFile)
  })

  it('keeps a flat single-level bundle intact', () => {
    const tree = buildFileTree([
      { rel: 'SKILL.md', size: 1, binary: false },
      { rel: 'notes.md', size: 1, binary: false },
    ])
    expect(tree.map((n) => n.kind === 'file' && n.name)).toEqual(['SKILL.md', 'notes.md'])
  })
})

describe('parseFrontmatter', () => {
  const raw = [
    '---',
    'name: vercel-react-best-practices',
    'description: React and Next.js performance guidelines.',
    'license: MIT',
    'metadata:',
    '  author: vercel',
    '  version: 1.0.0',
    '---',
    '# Body',
    '',
    'text',
  ].join('\n')

  it('pulls out description, drops name, flattens nested maps', () => {
    const fm = parseFrontmatter(raw)
    expect(fm.description).toBe('React and Next.js performance guidelines.')
    expect(fm.fields).toEqual([
      { key: 'license', value: 'MIT' },
      { key: 'metadata.author', value: 'vercel' },
      { key: 'metadata.version', value: '1.0.0' },
    ])
    expect(fm.body.startsWith('# Body')).toBe(true)
  })

  it('returns the body untouched when there is no frontmatter', () => {
    const fm = parseFrontmatter('# Just a body\n\nno frontmatter')
    expect(fm.description).toBeNull()
    expect(fm.fields).toEqual([])
    expect(fm.body).toBe('# Just a body\n\nno frontmatter')
  })

  it('strips surrounding quotes from values', () => {
    const fm = parseFrontmatter('---\ndescription: "quoted desc"\n---\nbody')
    expect(fm.description).toBe('quoted desc')
  })

  it('folds block-scalar descriptions instead of rendering the indicator', () => {
    const fm = parseFrontmatter(
      [
        '---',
        'name: analyzing-dotnet-performance',
        'description: >-',
        '  Scans .NET code for ~50 performance anti-patterns across async, memory,',
        '  strings, collections, LINQ, regex, serialization, and I/O.',
        'license: MIT',
        '---',
        'body',
      ].join('\n'),
    )
    expect(fm.description).toBe(
      'Scans .NET code for ~50 performance anti-patterns across async, memory, strings, collections, LINQ, regex, serialization, and I/O.',
    )
    expect(fm.fields).toEqual([{ key: 'license', value: 'MIT' }])
  })

  it('folds literal block scalars on nested keys too', () => {
    const fm = parseFrontmatter(
      '---\nmetadata:\n  notes: |\n    line one\n    line two\nlicense: MIT\n---\nbody',
    )
    expect(fm.fields).toEqual([
      { key: 'metadata.notes', value: 'line one line two' },
      { key: 'license', value: 'MIT' },
    ])
  })
})

describe('frontmatterCardHtml', () => {
  it('renders a description paragraph and an escaped field table', () => {
    const html = frontmatterCardHtml({
      description: 'A <b>desc</b>',
      fields: [{ key: 'author', value: '<script>x</script>' }],
      body: '',
    })
    expect(html).toContain('vw-fm-desc')
    expect(html).toContain('&lt;b&gt;desc')
    expect(html).toContain('author')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('is empty when there is nothing to show', () => {
    expect(frontmatterCardHtml({ description: null, fields: [], body: 'x' })).toBe('')
  })
})
