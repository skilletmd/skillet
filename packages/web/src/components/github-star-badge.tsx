import { GITHUB_REPO_URL } from '@/lib/urls'

// github.com/owner/repo -> owner/repo
function repoSlug(url: string): string | null {
  const m = url.match(/github\.com\/([^/]+\/[^/#?]+)/)
  return m ? m[1].replace(/\.git$/, '') : null
}

function formatCount(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`.replace('.0k', 'k')
}

async function fetchStars(): Promise<number | null> {
  const slug = repoSlug(GITHUB_REPO_URL)
  if (!slug) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: { Accept: 'application/vnd.github+json' },
      // Fetched at build/request time on the server, refreshed hourly.
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { stargazers_count?: number }
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : null
  } catch {
    return null
  }
}

export async function GithubStarBadge() {
  const stars = await fetchStars()

  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center overflow-hidden rounded-md border border-(--line) text-xs font-medium text-(--ink)"
    >
      <span className="inline-flex items-center gap-1.5 px-2 py-1 transition-colors group-hover:bg-(--line)/40">
        <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        <span>Star</span>
      </span>
      <span className="inline-flex items-center gap-1 border-l border-(--line) px-2 py-1 text-(--ink-2)">
        <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 text-amber-500" fill="currentColor">
          <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
        </svg>
        <span className="tabular-nums">{stars === null ? '—' : formatCount(stars)}</span>
      </span>
    </a>
  )
}
