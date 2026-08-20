import { fetchSkillBundleFile, type SkillBundleFetchOptions } from '@/lib/skill-bundle-content'

const MAX_CONCURRENCY = 4

/** Fetch decoded text for evidence paths (server-side, bounded parallelism). */
export async function fetchEvidenceFileTexts(
  author: string,
  slug: string,
  hash: string,
  paths: string[],
  options: SkillBundleFetchOptions = {},
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  const out = new Map<string, string>()
  if (unique.length === 0) return out

  let index = 0
  async function worker(): Promise<void> {
    while (index < unique.length) {
      const path = unique[index]
      index += 1
      const file = await fetchSkillBundleFile(author, slug, hash, path, options)
      if (file?.kind === 'text' && typeof file.text === 'string') {
        out.set(path, file.text)
      }
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, unique.length) }, () => worker())
  await Promise.all(workers)
  return out
}
