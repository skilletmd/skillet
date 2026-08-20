import { describe, expect, it, vi } from 'vitest'
import {
  classifyDiscovery,
  discoverSkillsFromUrl,
  githubBlobUrlToRaw,
  githubRepoTarget,
  importDiscoveredSkill,
  importRepoAsUnifiedSkill,
  importSkillBundleFromUrl,
  importSkillMarkdownFromUrl,
  isExcludedDiscoveryPath,
  normalizeGithubSkillUrl,
} from '@/lib/skill-import'
import { decodeFile } from '@/lib/skill-bundle'

describe('normalizeGithubSkillUrl', () => {
  it('accepts a bare owner/repo', () => {
    expect(normalizeGithubSkillUrl('vercel-labs/agent-skills')).toBe(
      'https://github.com/vercel-labs/agent-skills',
    )
    expect(normalizeGithubSkillUrl('emilkowalski/skill')).toBe('https://github.com/emilkowalski/skill')
  })

  it('strips the npx / skills install command prefixes', () => {
    expect(normalizeGithubSkillUrl('npx skills add vercel-labs/agent-skills')).toBe(
      'https://github.com/vercel-labs/agent-skills',
    )
    expect(normalizeGithubSkillUrl('skills add emilkowalski/skill')).toBe(
      'https://github.com/emilkowalski/skill',
    )
    expect(normalizeGithubSkillUrl('npx skills install acme/kit')).toBe('https://github.com/acme/kit')
  })

  it('maps a skills.sh link to its GitHub repo (skills.sh only indexes GitHub)', () => {
    expect(normalizeGithubSkillUrl('https://skills.sh/emilkowalski/skill')).toBe(
      'https://github.com/emilkowalski/skill',
    )
    expect(normalizeGithubSkillUrl('https://www.skills.sh/emilkowalski/skill/skill.md')).toBe(
      'https://github.com/emilkowalski/skill',
    )
  })

  it('passes through github.com and raw URLs unchanged', () => {
    expect(normalizeGithubSkillUrl('https://github.com/acme/skills/tree/main/team')).toBe(
      'https://github.com/acme/skills/tree/main/team',
    )
    expect(normalizeGithubSkillUrl('https://raw.githubusercontent.com/acme/skills/main/SKILL.md')).toBe(
      'https://raw.githubusercontent.com/acme/skills/main/SKILL.md',
    )
  })

  it('adds https:// to a scheme-less known host instead of mangling it', () => {
    expect(
      normalizeGithubSkillUrl('github.com/netresearch/skill-repo-skill/tree/main/skills/skill-repo'),
    ).toBe('https://github.com/netresearch/skill-repo-skill/tree/main/skills/skill-repo')
    expect(normalizeGithubSkillUrl('raw.githubusercontent.com/acme/skills/main/SKILL.md')).toBe(
      'https://raw.githubusercontent.com/acme/skills/main/SKILL.md',
    )
    expect(normalizeGithubSkillUrl('skills.sh/emilkowalski/skill')).toBe(
      'https://github.com/emilkowalski/skill',
    )
  })

  it('keeps a bare sub-path as a tree target and strips quotes/.git', () => {
    expect(normalizeGithubSkillUrl('acme/skills/team/seo')).toBe(
      'https://github.com/acme/skills/tree/HEAD/team/seo',
    )
    expect(normalizeGithubSkillUrl('`acme/skills`')).toBe('https://github.com/acme/skills')
    expect(normalizeGithubSkillUrl('acme/skills.git')).toBe('https://github.com/acme/skills')
  })

  it('returns null for unrecognized input', () => {
    expect(normalizeGithubSkillUrl('')).toBeNull()
    expect(normalizeGithubSkillUrl('just-one-word')).toBeNull()
    expect(normalizeGithubSkillUrl('https://example.com/foo/bar')).toBeNull()
  })
})

describe('skill import helpers', () => {
  it('converts GitHub blob URLs to raw content URLs', () => {
    expect(githubBlobUrlToRaw('https://github.com/acme/skills/blob/main/SKILL.md')).toBe(
      'https://raw.githubusercontent.com/acme/skills/main/SKILL.md',
    )
  })

  it('parses GitHub repo and tree URLs', () => {
    expect(githubRepoTarget('https://github.com/acme/skills')).toEqual({
      owner: 'acme',
      repo: 'skills',
    })
    expect(githubRepoTarget('https://github.com/acme/skills/tree/main/team')).toEqual({
      owner: 'acme',
      repo: 'skills',
      ref: 'main',
      prefix: 'team',
    })
  })

  it('imports raw SKILL.md URLs', async () => {
    const fetchMock = vi.fn(async () => new Response('# Imported skill'))

    await expect(
      importSkillMarkdownFromUrl(
        'https://raw.githubusercontent.com/acme/skills/main/SKILL.md',
        fetchMock as typeof fetch,
      ),
    ).resolves.toEqual({
      markdown: '# Imported skill',
      source: 'https://raw.githubusercontent.com/acme/skills/main/SKILL.md',
    })
  })

  it('finds SKILL.md inside a GitHub repository', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/git/trees/HEAD')) {
        return Response.json({
          sha: 'abc123',
          tree: [
            { path: 'README.md', type: 'blob' },
            { path: 'nested/SKILL.md', type: 'blob' },
          ],
        })
      }
      return new Response('# Nested skill')
    })

    await expect(
      importSkillMarkdownFromUrl('https://github.com/acme/skills', fetchMock as typeof fetch),
    ).resolves.toEqual({
      markdown: '# Nested skill',
      source: 'https://raw.githubusercontent.com/acme/skills/abc123/nested/SKILL.md',
    })
  })
})

describe('importSkillBundleFromUrl', () => {
  it('imports a single SKILL.md from a raw URL', async () => {
    const fetchMock = vi.fn(async () => new Response('# Imported'))
    const result = await importSkillBundleFromUrl(
      'https://raw.githubusercontent.com/acme/skills/main/SKILL.md',
      fetchMock as typeof fetch,
    )
    expect(Object.keys(result.files)).toEqual(['SKILL.md'])
    expect(decodeFile(result.files['SKILL.md']).text).toBe('# Imported')
  })

  it('pulls the whole skill folder and strips the entrypoint directory', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/git/trees/HEAD')) {
        return Response.json({
          sha: 'abc123',
          tree: [
            { path: 'README.md', type: 'blob' },
            { path: 'pack/SKILL.md', type: 'blob' },
            { path: 'pack/references/runbook.md', type: 'blob' },
            { path: 'pack/.git/HEAD', type: 'blob' },
          ],
        })
      }
      if (url.endsWith('/pack/SKILL.md')) return new Response('# Pack')
      if (url.endsWith('/pack/references/runbook.md')) return new Response('runbook')
      return new Response('nope', { status: 404 })
    })

    const result = await importSkillBundleFromUrl(
      'https://github.com/acme/skills',
      fetchMock as typeof fetch,
    )

    // Paths are relative to the skill dir; README outside it and .git are dropped.
    expect(Object.keys(result.files).sort()).toEqual(['SKILL.md', 'references/runbook.md'])
    expect(decodeFile(result.files['references/runbook.md']).text).toBe('runbook')
    expect(result.source).toBe('github.com/acme/skills/pack')
  })
})

describe('multi-skill discovery', () => {
  const tree = {
    sha: 'def456',
    tree: [
      { path: 'README.md', type: 'blob' },
      { path: 'skills/seo/SKILL.md', type: 'blob' },
      { path: 'skills/seo/references/notes.md', type: 'blob' },
      { path: 'skills/ads/SKILL.md', type: 'blob' },
    ],
  }

  function makeFetch() {
    return vi.fn(async (url: string) => {
      if (url.includes('/git/trees/')) return Response.json(tree)
      if (url.endsWith('/skills/seo/SKILL.md'))
        return new Response('---\nname: seo-helper\ndescription: Improve SEO.\n---\n# SEO')
      if (url.endsWith('/skills/ads/SKILL.md'))
        return new Response('---\nname: ad-writer\ndescription: Write ads.\n---\n# Ads')
      if (url.endsWith('/skills/seo/references/notes.md')) return new Response('notes')
      return new Response('nope', { status: 404 })
    })
  }

  it('discovers every skill with parsed name/description', async () => {
    const result = await discoverSkillsFromUrl(
      'https://github.com/acme/marketing',
      makeFetch() as typeof fetch,
    )
    expect(result.skills.map((s) => s.name).sort()).toEqual(['ad-writer', 'seo-helper'])
    const seo = result.skills.find((s) => s.dir === 'skills/seo')!
    expect(seo.description).toBe('Improve SEO.')
    // The seo bucket has its own files but not the sibling ads skill.
    expect(seo.files.sort()).toEqual(['skills/seo/SKILL.md', 'skills/seo/references/notes.md'])
  })

  it('imports a chosen skill folder relative to its dir', async () => {
    const fetchMock = makeFetch()
    const discovery = await discoverSkillsFromUrl(
      'https://github.com/acme/marketing',
      fetchMock as typeof fetch,
    )
    const seo = discovery.skills.find((s) => s.dir === 'skills/seo')!
    const bundle = await importDiscoveredSkill(discovery, seo, fetchMock as typeof fetch)
    expect(Object.keys(bundle.files).sort()).toEqual(['SKILL.md', 'references/notes.md'])
    expect(bundle.source).toBe('github.com/acme/marketing/skills/seo')
  })

  it('scopes discovery to a tree subdir', async () => {
    const result = await discoverSkillsFromUrl(
      'https://github.com/acme/marketing/tree/main/skills/ads',
      makeFetch() as typeof fetch,
    )
    expect(result.skills.map((s) => s.dir)).toEqual(['skills/ads'])
  })

  it('marks self-contained skills (internal scripts/, no ../) as not coupled → kit', async () => {
    const result = await discoverSkillsFromUrl(
      'https://github.com/acme/marketing',
      makeFetch() as typeof fetch,
    )
    expect(result.skills.every((s) => s.coupled === false)).toBe(true)
    expect(classifyDiscovery(result).mode).toBe('kit')
  })
})

// Real-repo shapes from the import-classification survey.
describe('repo classification + cleanup', () => {
  function makeFetch(tree: object, bodies: Record<string, string>) {
    return vi.fn(async (url: string) => {
      if (url.includes('/git/trees/')) return Response.json(tree)
      for (const [suffix, body] of Object.entries(bodies)) {
        if (url.endsWith(suffix)) return new Response(body)
      }
      return new Response('nope', { status: 404 })
    })
  }

  it('isExcludedDiscoveryPath drops dot-dirs, build, and deps', () => {
    expect(isExcludedDiscoveryPath('.gemini/skills/x/SKILL.md')).toBe(true)
    expect(isExcludedDiscoveryPath('.claude/skills/x/SKILL.md')).toBe(true)
    expect(isExcludedDiscoveryPath('dist/x/SKILL.md')).toBe(true)
    expect(isExcludedDiscoveryPath('node_modules/x/SKILL.md')).toBe(true)
    expect(isExcludedDiscoveryPath('skills/x/SKILL.md')).toBe(false)
  })

  // alirezarezvani shape: the canonical skill plus per-tool generated mirrors in
  // dot-dirs. Only the canonical one should be discovered.
  it('excludes tool-mirror dot-dirs so a skill is not imported many times', async () => {
    const tree = {
      sha: 's1',
      tree: [
        { path: 'marketing/seo/SKILL.md', type: 'blob' },
        { path: '.gemini/skills/seo/SKILL.md', type: 'blob' },
        { path: '.claude/skills/seo/SKILL.md', type: 'blob' },
        { path: '.codex-plugin/skills/seo/SKILL.md', type: 'blob' },
      ],
    }
    const body = '---\nname: seo\ndescription: SEO.\n---\n# SEO'
    const result = await discoverSkillsFromUrl(
      'https://github.com/alirezarezvani/claude-skills',
      makeFetch(tree, { '/marketing/seo/SKILL.md': body }) as typeof fetch,
    )
    expect(result.skills.map((s) => s.dir)).toEqual(['marketing/seo'])
  })

  // caveman shape: skills/x mirrored into plugins/<tool>/skills/x with identical
  // content. Content-dedupe keeps the canonical skills/ dir.
  it('dedupes plugin mirror copies by identical SKILL.md, keeping the canonical dir', async () => {
    const body = '---\nname: cavecrew\ndescription: Crew.\n---\n# Crew'
    const tree = {
      sha: 's2',
      tree: [
        { path: 'skills/cavecrew/SKILL.md', type: 'blob' },
        { path: 'plugins/caveman/skills/cavecrew/SKILL.md', type: 'blob' },
      ],
    }
    const result = await discoverSkillsFromUrl(
      'https://github.com/JuliusBrussee/caveman',
      makeFetch(tree, {
        '/skills/cavecrew/SKILL.md': body,
        '/plugins/caveman/skills/cavecrew/SKILL.md': body,
      }) as typeof fetch,
    )
    expect(result.skills.map((s) => s.dir)).toEqual(['skills/cavecrew'])
  })

  // obra/superpowers shape: a skill references a sibling via ../, so the repo is
  // coupled and classifies as a single unified skill.
  it('detects ../ coupling and classifies the repo as unified', async () => {
    const tree = {
      sha: 's3',
      tree: [
        { path: 'skills/executing-plans/SKILL.md', type: 'blob' },
        { path: 'skills/using-superpowers/SKILL.md', type: 'blob' },
        { path: 'skills/using-superpowers/references/tools.md', type: 'blob' },
        { path: 'hooks/run.sh', type: 'blob' },
      ],
    }
    const result = await discoverSkillsFromUrl(
      'https://github.com/obra/superpowers',
      makeFetch(tree, {
        '/skills/executing-plans/SKILL.md':
          '---\nname: executing-plans\ndescription: Run a plan.\n---\nSee `../using-superpowers/references/`.',
        '/skills/using-superpowers/SKILL.md':
          '---\nname: using-superpowers\ndescription: Base.\n---\n# Base',
      }) as typeof fetch,
    )
    const coupled = result.skills.find((s) => s.dir === 'skills/executing-plans')!
    expect(coupled.coupled).toBe(true)
    const klass = classifyDiscovery(result)
    expect(klass.mode).toBe('unified')
    expect(klass.reason).toMatch(/share/)
  })

  it('importRepoAsUnifiedSkill bundles the whole repo, reroots, and synthesizes a root index', async () => {
    const tree = {
      sha: 's3',
      tree: [
        { path: 'skills/executing-plans/SKILL.md', type: 'blob' },
        { path: 'skills/using-superpowers/SKILL.md', type: 'blob' },
        { path: 'skills/using-superpowers/references/tools.md', type: 'blob' },
        { path: 'hooks/run.sh', type: 'blob' },
        { path: '.github/workflows/ci.yml', type: 'blob' },
      ],
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/git/trees/')) return Response.json(tree)
      if (url.endsWith('/skills/executing-plans/SKILL.md'))
        return new Response(
          '---\nname: executing-plans\ndescription: Run.\n---\nSee `../using-superpowers/`.',
        )
      if (url.endsWith('/skills/using-superpowers/SKILL.md'))
        return new Response('---\nname: using-superpowers\ndescription: Base.\n---\n# Base')
      if (url.endsWith('/references/tools.md')) return new Response('tool refs')
      if (url.endsWith('/hooks/run.sh')) return new Response('#!/bin/sh\necho hi')
      return new Response('nope', { status: 404 })
    })
    const discovery = await discoverSkillsFromUrl(
      'https://github.com/obra/superpowers',
      fetchMock as typeof fetch,
    )
    const bundle = await importRepoAsUnifiedSkill(discovery, fetchMock as typeof fetch)

    const paths = Object.keys(bundle.files).sort()
    // Whole repo, rerooted at the repo root; .github excluded; index synthesized.
    expect(paths).toEqual([
      'SKILL.md',
      'hooks/run.sh',
      'skills/executing-plans/SKILL.md',
      'skills/using-superpowers/SKILL.md',
      'skills/using-superpowers/references/tools.md',
    ])
    // The synthesized root entrypoint names the bundled skills.
    const index = decodeFile(bundle.files['SKILL.md']).text
    expect(index).toMatch(/name: superpowers/)
    expect(index).toMatch(/skills\/executing-plans\/SKILL\.md/)
  })

  it('classifies a single-skill repo as single', async () => {
    const tree = { sha: 's4', tree: [{ path: 'SKILL.md', type: 'blob' }] }
    const result = await discoverSkillsFromUrl(
      'https://github.com/acme/one',
      makeFetch(tree, {
        '/SKILL.md': '---\nname: one\ndescription: One.\n---\n# One',
      }) as typeof fetch,
    )
    expect(classifyDiscovery(result).mode).toBe('single')
  })
})
