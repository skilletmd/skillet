import {
  decodeFile,
  isLikelyExecutable,
  isSkilletBackupPath,
  SKILL_ENTRYPOINT,
  type BundleFileEntry,
  type BundleFiles,
} from './skill-bundle'
import { splitSkillMdFrontmatter } from './skill-md-body'
import { REGISTRY_API } from './registry-prefix'
import { versionBodyCache } from './version-body-cache'

export interface SkillBundleFileEntry {
  path: string
  kind: 'text' | 'binary'
  /** Decoded size in bytes. */
  size: number
  /** True when the file looks like a script or native executable. */
  executable: boolean
  /** Present for text files; omitted for binary blobs. */
  text?: string
}

/** File metadata without inlined body text (skill page SSR default). */
export type SkillBundleFileMeta = SkillBundleFileEntry

export interface SkillBundleContent {
  versionHash: string
  skillMdBody: string
  frontmatter: string | null
  files: SkillBundleFileEntry[]
}

/** Skill page shell: SKILL.md body + file tree metadata only. */
export type SkillBundleSummary = SkillBundleContent

interface ManifestResponse {
  latest_hash: string | null
}

interface VersionResponse {
  hash: string
  files: BundleFiles
}

interface FileIndexResponse {
  hash: string
  files: Array<{
    path: string
    kind: 'text' | 'binary'
    size: number
    executable: boolean
  }>
}

interface SingleFileResponse {
  path: string
  kind: 'text' | 'binary'
  size: number
  executable: boolean
  text?: string
}

function registryBase(): string | undefined {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL
}

async function registryFetch<T>(path: string, token?: string): Promise<T | undefined> {
  const base = registryBase()
  if (!base) return undefined

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      // Always no-store, even anonymously. Skill visibility/yank is revocable, so
      // a stale anonymous cache (previously revalidate: 60) could serve revoked
      // skill content for up to a minute. The
      // registry re-checks the ACL on every fetch, so a revoked skill 404s at once.
      cache: 'no-store' as const,
    })
    if (!res.ok) return undefined
    return (await res.json()) as T
  } catch {
    return undefined
  }
}

/**
 * Result of a conditional (`If-None-Match`) request to the version endpoint.
 * The existing {@link registryFetch} collapses every non-2xx to `undefined`, so
 * it cannot distinguish a `304` (authorized-and-unchanged → serve the cache)
 * from a `404`/`409` (revoked/blocked → evict + not-found) from a `5xx`/outage.
 */
type VersionFetchResult =
  | { kind: 'not-modified' }
  | { kind: 'ok'; files: BundleFiles }
  | { kind: 'gone' }
  | { kind: 'unavailable' }

/**
 * Issue a conditional `GET /versions/:hash` carrying `If-None-Match: "<hash>"`.
 * The registry runs ALL FOUR serve-gates (visibility, yank, moderation, scan)
 * BEFORE emitting a `304` (U1/KTD1), so a `304` provably means the viewer is
 * authorized AND the body is unchanged — the only condition under which the
 * caller may serve the hash-keyed cache. A `404`/`409` means the version was
 * revoked or blocked since it was cached.
 */
async function fetchVersionConditional(
  path: string,
  hash: string,
  token?: string,
): Promise<VersionFetchResult> {
  const base = registryBase()
  if (!base) return { kind: 'unavailable' }
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        // Exact ETag the version endpoint emits: `"<hash>"` (quotes included).
        'if-none-match': `"${hash}"`,
      },
      cache: 'no-store' as const,
    })
    if (res.status === 304) return { kind: 'not-modified' }
    // Existence-hiding 404 or a serve-block 409 (moderation/scan quarantine, yank).
    if (res.status === 404 || res.status === 409) return { kind: 'gone' }
    if (!res.ok) return { kind: 'unavailable' }
    const body = (await res.json()) as VersionResponse
    if (!body?.files) return { kind: 'unavailable' }
    return { kind: 'ok', files: body.files }
  } catch {
    return { kind: 'unavailable' }
  }
}

function mapBundleFiles(files: BundleFiles): SkillBundleFileEntry[] {
  return Object.keys(files)
    .filter((path) => !isSkilletBackupPath(path))
    .sort()
    .map((path) => {
      const decoded = decodeFile(files[path] as BundleFileEntry)
      const common = {
        path,
        size: decoded.bytes.length,
        executable: isLikelyExecutable(path, decoded.bytes),
      }
      if (decoded.binary || decoded.text == null) {
        return { ...common, kind: 'binary' as const }
      }
      return { ...common, kind: 'text' as const, text: decoded.text }
    })
}

function skillPaths(author: string, slug: string, hash: string): {
  manifest: string
  version: string
  fileIndex: string
  fileBody: (path: string) => string
} {
  const base = `${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`
  const versionBase = `${base}/versions/${encodeURIComponent(hash)}`
  return {
    manifest: `${base}/manifest`,
    version: versionBase,
    fileIndex: `${versionBase}/files`,
    fileBody: (path: string) =>
      `${versionBase}/file?path=${encodeURIComponent(path)}`,
  }
}

async function fetchSkillMdBody(
  author: string,
  slug: string,
  hash: string,
  token?: string,
): Promise<{ body: string; frontmatter: string | null } | null> {
  const paths = skillPaths(author, slug, hash)
  const file = await registryFetch<SingleFileResponse>(paths.fileBody(SKILL_ENTRYPOINT), token)
  if (!file?.path || file.kind !== 'text') return null
  const raw = file.text ?? ''
  const { frontmatter, body } = splitSkillMdFrontmatter(raw)
  return { body, frontmatter }
}

/**
 * Load the published skill bundle for the public detail page: SKILL.md body +
 * full file tree (a skill is a folder, not just frontmatter fields).
 */
export interface SkillBundleFetchOptions {
  /** Attach the viewer session from cookies. Only safe on force-dynamic routes. */
  withSession?: boolean
}

export async function getSkillBundleSummary(
  author: string,
  slug: string,
  options: SkillBundleFetchOptions = {},
): Promise<SkillBundleSummary | null> {
  let sessionToken: string | undefined
  if (options.withSession) {
    try {
      const { cookies } = await import('next/headers')
      const { readSessionCookie } = await import('./session-cookie')
      const jar = await cookies()
      sessionToken = readSessionCookie(jar)
    } catch {
      sessionToken = undefined
    }
  }

  const manifest = await registryFetch<ManifestResponse>(
    `${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/manifest`,
    sessionToken,
  )
  const hash = manifest?.latest_hash
  if (!hash) return null

  const paths = skillPaths(author, slug, hash)
  const index = await registryFetch<FileIndexResponse>(paths.fileIndex, sessionToken)
  if (!index?.files?.length) return null

  const skillMd = await fetchSkillMdBody(author, slug, hash, sessionToken)
  if (!skillMd) return null

  return {
    versionHash: hash,
    skillMdBody: skillMd.body,
    frontmatter: skillMd.frontmatter,
    files: index.files.filter((f) => !isSkilletBackupPath(f.path)).map((f) => ({ ...f })),
  }
}

/** Server-side read of one bundle file (trust evidence, targeted fetches). */
export async function fetchSkillBundleFile(
  author: string,
  slug: string,
  hash: string,
  path: string,
  options: SkillBundleFetchOptions = {},
): Promise<SingleFileResponse | null> {
  let sessionToken: string | undefined
  if (options.withSession) {
    try {
      const { cookies } = await import('next/headers')
      const { readSessionCookie } = await import('./session-cookie')
      const jar = await cookies()
      sessionToken = readSessionCookie(jar)
    } catch {
      sessionToken = undefined
    }
  }
  const paths = skillPaths(author, slug, hash)
  return (await registryFetch<SingleFileResponse>(paths.fileBody(path), sessionToken)) ?? null
}

export async function getSkillBundleContent(
  author: string,
  slug: string,
  options: SkillBundleFetchOptions = {},
): Promise<SkillBundleContent | null> {
  let sessionToken: string | undefined
  if (options.withSession) {
    try {
      const { cookies } = await import('next/headers')
      const { readSessionCookie } = await import('./session-cookie')
      const jar = await cookies()
      sessionToken = readSessionCookie(jar)
    } catch {
      sessionToken = undefined
    }
  }

  // The manifest is used ONLY to discover the current `latest_hash` — it is NOT
  // the authorization gate for the cached body (it checks visibility alone, not
  // yank/moderation/scan; KTD1). The version-endpoint conditional request below
  // is the gate.
  const manifest = await registryFetch<ManifestResponse>(
    `${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/manifest`,
    sessionToken,
  )
  const hash = manifest?.latest_hash
  if (!hash) return null

  const versionPath = `${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(hash)}`

  // The body is immutable by content hash, so the LRU can only go stale on
  // AUTHORIZATION, never on content (KTD2). The gate (KTD1):
  //   • cache HIT  → revalidate with a conditional request. `304` = still
  //     authorized → serve the cached body; `404`/`409` = revoked/blocked →
  //     evict + not-found. Never serve the cached bytes on a non-304.
  //   • cache MISS → a plain GET fetches the body (`200`) and populates; a
  //     revoked/blocked version `404`/`409`s here → not-found (no bytes to leak).
  // Either way the version endpoint runs all four serve-gates before returning.
  let files: SkillBundleFileEntry[]
  const cached = versionBodyCache.get(hash)
  if (cached) {
    const result = await fetchVersionConditional(versionPath, hash, sessionToken)
    if (result.kind === 'not-modified') {
      files = cached
    } else if (result.kind === 'gone') {
      versionBodyCache.delete(hash)
      return null
    } else if (result.kind === 'ok') {
      // Unusual for a fixed hash, but honor a fresh body if the registry sends one.
      files = mapBundleFiles(result.files)
      versionBodyCache.set(hash, files)
    } else {
      // Registry down — do NOT fall back to the cached bytes (they may be
      // stale-authorized); surface the outage as not-found, same as today.
      return null
    }
  } else {
    const full = await registryFetch<VersionResponse>(versionPath, sessionToken)
    if (!full?.files) return null
    files = mapBundleFiles(full.files)
    versionBodyCache.set(hash, files)
  }

  const skillEntry = files.find((f) => f.path === SKILL_ENTRYPOINT)
  const skillMdRaw = skillEntry?.kind === 'text' ? (skillEntry.text ?? '') : ''
  const { frontmatter, body } = splitSkillMdFrontmatter(skillMdRaw)

  return {
    versionHash: hash,
    skillMdBody: body,
    frontmatter,
    files,
  }
}
