import { REGISTRY_API } from '@/lib/registry-prefix'
import type { SkillBundleFileEntry } from '@/lib/skill-bundle-content'

interface FileBodyResponse {
  path: string
  kind: 'text' | 'binary'
  size: number
  executable: boolean
  text?: string
}

export interface SkillBundleFileIndexEntry {
  path: string
  kind: 'text' | 'binary'
  size: number
  executable: boolean
}

/** Client-side fetch of a version's file listing (metadata only, no bodies). */
export async function fetchSkillBundleFileIndexClient(
  author: string,
  slug: string,
  versionHash: string,
): Promise<SkillBundleFileIndexEntry[] | null> {
  const url = `/api/registry${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionHash)}/files`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { files?: SkillBundleFileIndexEntry[] }
    if (!Array.isArray(body?.files)) return null
    return body.files.map((f) => ({
      path: f.path,
      kind: f.kind,
      size: f.size,
      executable: f.executable,
    }))
  } catch {
    return null
  }
}

/** Client-side fetch of one supporting file via the web BFF. */
export async function fetchSkillBundleFileClient(
  author: string,
  slug: string,
  versionHash: string,
  path: string,
): Promise<SkillBundleFileEntry | null> {
  const url = `/api/registry${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionHash)}/file?path=${encodeURIComponent(path)}`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as FileBodyResponse
    if (!body?.path) return null
    return {
      path: body.path,
      kind: body.kind,
      size: body.size,
      executable: body.executable,
      ...(body.text != null ? { text: body.text } : {}),
    }
  } catch {
    return null
  }
}
