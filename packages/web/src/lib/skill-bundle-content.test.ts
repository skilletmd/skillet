import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getSkillBundleContent } from './skill-bundle-content'
import { versionBodyCache } from './version-body-cache'

const HASH = 'sha256:abc123'
const SKILL_MD = '---\nname: demo\n---\nhello body text'
const VERSION_BODY = {
  hash: HASH,
  files: { 'SKILL.md': { enc: 'utf8', data: SKILL_MD } },
}

// The version endpoint's simulated authorization state, flipped mid-test to
// model a moderator quarantine / yank / privatize landing between two views.
type VersionMode = 'ok' | 'quarantined' | 'yanked' | 'down'
let versionMode: VersionMode
let latestHash: string
let bodyDownloads: number // count of full-body (200) version responses served

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(): void {
  bodyDownloads = 0
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const headers = (init?.headers ?? {}) as Record<string, string>
    if (u.includes('/manifest')) {
      return jsonRes({ latest_hash: latestHash })
    }
    if (u.includes('/versions/')) {
      if (versionMode === 'down') return jsonRes({ error: 'boom' }, 500)
      if (versionMode === 'quarantined') return jsonRes({ error: 'scan_quarantined' }, 409)
      if (versionMode === 'yanked') return jsonRes({ error: 'Version not found' }, 404)
      // Authorized. A conditional request (If-None-Match) revalidates without a
      // body; a plain GET returns the full body.
      const conditional = 'if-none-match' in headers || 'If-None-Match' in headers
      if (conditional) return new Response(null, { status: 304 })
      bodyDownloads++
      return jsonRes(VERSION_BODY)
    }
    return jsonRes({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_REGISTRY_URL = 'http://reg.test'
  versionMode = 'ok'
  latestHash = HASH
  versionBodyCache.clear()
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  versionBodyCache.clear()
  delete process.env.NEXT_PUBLIC_REGISTRY_URL
})

describe('getSkillBundleSummary (skill page SSR)', () => {
  const INDEX = {
    hash: HASH,
    files: [
      { path: 'SKILL.md', kind: 'text' as const, size: 40, executable: false },
      { path: 'references/notes.md', kind: 'text' as const, size: 12, executable: false },
    ],
  }
  const SKILL_FILE = {
    path: 'SKILL.md',
    kind: 'text' as const,
    size: 40,
    executable: false,
    text: SKILL_MD,
  }

  function installSummaryFetch(): void {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes('/manifest')) return jsonRes({ latest_hash: latestHash })
      if (u.includes('/files') && !u.includes('/file?')) return jsonRes(INDEX)
      if (u.includes('/file?')) return jsonRes(SKILL_FILE)
      return jsonRes({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  beforeEach(() => {
    installSummaryFetch()
  })

  it('returns metadata without supporting-file text and does not use versionBodyCache', async () => {
    const { getSkillBundleSummary } = await import('./skill-bundle-content')
    const summary = await getSkillBundleSummary('a', 's')
    expect(summary?.skillMdBody).toContain('hello body text')
    expect(summary?.files).toHaveLength(2)
    expect(summary?.files.find((f) => f.path === 'references/notes.md')?.text).toBeUndefined()
    expect(versionBodyCache.size()).toBe(0)
  })

  it('drops .skillet-backup paths from the file index', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes('/manifest')) return jsonRes({ latest_hash: latestHash })
      if (u.includes('/files') && !u.includes('/file?')) {
        return jsonRes({
          hash: HASH,
          files: [
            { path: 'SKILL.md', kind: 'text', size: 40, executable: false },
            { path: 'SKILL.md.skillet-backup', kind: 'text', size: 20, executable: false },
          ],
        })
      }
      if (u.includes('/file?')) return jsonRes(SKILL_FILE)
      return jsonRes({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getSkillBundleSummary } = await import('./skill-bundle-content')
    const summary = await getSkillBundleSummary('a', 's')
    expect(summary?.files.map((f) => f.path)).toEqual(['SKILL.md'])
  })
})

describe('getSkillBundleContent version-body cache (U2)', () => {
  it('downloads the body once, then serves repeat authorized views from cache', async () => {
    const first = await getSkillBundleContent('a', 's')
    expect(first?.skillMdBody).toContain('hello body text')
    expect(bodyDownloads).toBe(1)

    const second = await getSkillBundleContent('a', 's')
    const third = await getSkillBundleContent('a', 's')
    // Both later views revalidated via a conditional 304 — no extra body download.
    expect(bodyDownloads).toBe(1)
    // Byte-identical rendered output across views.
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('moderation revocation between views returns null and does NOT serve cached bytes', async () => {
    const first = await getSkillBundleContent('a', 's')
    expect(first).not.toBeNull()
    expect(versionBodyCache.get(HASH)).toBeDefined()

    // A moderator quarantines the version between views.
    versionMode = 'quarantined'
    const second = await getSkillBundleContent('a', 's')
    expect(second).toBeNull()
    // The cached body was evicted, not served.
    expect(versionBodyCache.get(HASH)).toBeUndefined()
  })

  it('yank revocation between views returns null and evicts the cached body', async () => {
    await getSkillBundleContent('a', 's')
    expect(versionBodyCache.get(HASH)).toBeDefined()

    versionMode = 'yanked'
    const second = await getSkillBundleContent('a', 's')
    expect(second).toBeNull()
    expect(versionBodyCache.get(HASH)).toBeUndefined()
  })

  it('registry outage on a cache hit returns null (no stale-authorized cache fallback)', async () => {
    await getSkillBundleContent('a', 's')
    expect(versionBodyCache.get(HASH)).toBeDefined()

    versionMode = 'down'
    const second = await getSkillBundleContent('a', 's')
    expect(second).toBeNull()
    // The cached body is retained (the outage is transient, not a revocation),
    // but was NOT served during the outage.
    expect(versionBodyCache.get(HASH)).toBeDefined()
  })

  it('a cold-cache view of a quarantined version returns null (no bytes to leak)', async () => {
    versionMode = 'quarantined'
    const res = await getSkillBundleContent('a', 's')
    expect(res).toBeNull()
    expect(bodyDownloads).toBe(0)
  })

  it('a new latest_hash drives a fresh fetch for the new hash — no stale serve', async () => {
    await getSkillBundleContent('a', 's')
    expect(bodyDownloads).toBe(1)

    // The skill republishes → the manifest now points at a new hash the cache
    // has never seen → a cold miss → a fresh body download for the new hash.
    const NEW_HASH = 'sha256:def456'
    latestHash = NEW_HASH
    VERSION_BODY.hash = NEW_HASH
    const res = await getSkillBundleContent('a', 's')
    expect(res?.versionHash).toBe(NEW_HASH)
    expect(bodyDownloads).toBe(2)
    // Restore for other tests (module-level fixture object).
    VERSION_BODY.hash = HASH
  })

  it('returns null when the manifest has no latest_hash (empty skill)', async () => {
    latestHash = ''
    const res = await getSkillBundleContent('a', 's')
    expect(res).toBeNull()
  })
})
