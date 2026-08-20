import 'server-only'

/**
 * List the repos the connected GitHub token can publish from (push/admin), so the
 * connect UI can offer a picker instead of a typed owner/repo. A no-scope GitHub
 * token still returns the user's public repos across their own account and orgs
 * they belong to, each with its `permissions` object — enough to filter to repos
 * they can push to. Private repos would need the full `repo` scope (we
 * deliberately don't ask), so they won't appear — the manual field is the fallback.
 */
export interface OwnedRepo {
  full: string
  owner: string
  name: string
  private: boolean
  pushedAt: string | null
}

interface GhRepo {
  full_name?: string
  name?: string
  owner?: { login?: string }
  private?: boolean
  archived?: boolean
  pushed_at?: string | null
  permissions?: { push?: boolean; admin?: boolean }
}

export async function listOwnedRepos(token: string): Promise<OwnedRepo[]> {
  try {
    const res = await fetch(
      'https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,organization_member',
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'skillet-web',
          'x-github-api-version': '2022-11-28',
          authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      },
    )
    if (!res.ok) return []
    const body = (await res.json()) as GhRepo[]
    return body
      .filter((r) => (r.permissions?.push || r.permissions?.admin) && !r.archived && r.full_name)
      .map((r) => ({
        full: r.full_name as string,
        owner: r.owner?.login ?? r.full_name!.split('/')[0]!,
        name: r.name ?? r.full_name!.split('/')[1]!,
        private: r.private === true,
        pushedAt: r.pushed_at ?? null,
      }))
  } catch {
    return []
  }
}
