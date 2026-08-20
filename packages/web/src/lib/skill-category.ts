import { registryAuthApi } from './registry-proxy'
import type { CategoryKey } from './categories'

/** Thrown when the registry rejects a category change (carries status + code). */
export class SkillCategoryError extends Error {
  code?: string
  status?: number
  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'SkillCategoryError'
    this.code = code
    this.status = status
  }
}

/**
 * Set (or clear, with null) a skill's category. Owner-only — the registry
 * re-authorizes on every call. Returns the persisted category. Called from the
 * browser (credentials: 'include') via the web BFF proxy, mirroring the
 * deprecation lifecycle actions.
 */
export async function setSkillCategory(
  author: string,
  slug: string,
  category: CategoryKey | null,
): Promise<CategoryKey | null> {
  let res: Response
  try {
    res = await fetch(registryAuthApi(`skills/${author}/${slug}/category`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ category }),
    })
  } catch {
    throw new SkillCategoryError('Could not reach the registry.', 'network')
  }

  if (!res.ok) {
    let message =
      res.status === 401 || res.status === 403
        ? 'You don’t have permission to change this skill.'
        : `The registry responded ${res.status}.`
    let code: string | undefined
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      code = body.error
      message = body.message ?? body.error ?? message
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new SkillCategoryError(message, code, res.status)
  }

  try {
    const body = (await res.json()) as { category?: CategoryKey | null }
    return body.category ?? null
  } catch {
    return category
  }
}
