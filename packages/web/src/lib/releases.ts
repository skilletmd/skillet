import { GITHUB_RELEASES_REPO } from './urls'

// Resolves the latest desktop-release assets from GitHub Releases so skillet.md
// can front the download + auto-update funnel on a domain we control. The app
// and the download buttons only ever know the stable skillet.md URLs; the repo
// slug lives in one place (GITHUB_RELEASES_REPO), so a rename never touches
// shipped artifacts — you repoint the env, not re-release.

export type DesktopAsset = 'mac' | 'windows' | 'updater'

interface GitHubAsset {
  name: string
  browser_download_url: string
}

// Tauri names installers with the version, so match by shape, not exact name.
const PATTERNS: Record<DesktopAsset, RegExp> = {
  updater: /^latest\.json$/i,
  mac: /\.dmg$/i,
  windows: /(-setup\.exe|\.msi|\.exe)$/i,
}

/**
 * The download URL of the latest release asset of a given kind, or null when
 * there is no published release / matching asset yet (callers 503 so a missing
 * release reads as "not ready", never a broken redirect). The GitHub response
 * is cached for 5 minutes so the API isn't hit per request; an optional token
 * (SKILLET_RELEASES_TOKEN / GITHUB_TOKEN) raises the rate limit and lets this
 * resolve while the repo is still private, pre-launch.
 */
export async function latestReleaseAsset(kind: DesktopAsset): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'skillet-web',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.SKILLET_RELEASES_TOKEN ?? process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_RELEASES_REPO}/releases/latest`,
    { headers, next: { revalidate: 300 } },
  )
  if (!res.ok) return null

  const release = (await res.json()) as { assets?: GitHubAsset[] }
  const asset = release.assets?.find((a) => PATTERNS[kind].test(a.name))
  return asset?.browser_download_url ?? null
}

/** Shared body for the download/updater route handlers: 302 to the resolved
 *  asset, or 503 when no release is published yet. */
export async function assetRedirect(kind: DesktopAsset): Promise<Response> {
  const url = await latestReleaseAsset(kind)
  if (!url) {
    return Response.json(
      { error: 'no_release', message: 'No published desktop release yet.', kind },
      { status: 503 },
    )
  }
  return Response.redirect(url, 302)
}
