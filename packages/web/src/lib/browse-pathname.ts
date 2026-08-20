/**
 * True for Browse document paths (/browse, /browse/..., not unrelated routes).
 * Used to skip membership bootstrap + SSR follow overlays on the Browse
 * critical path (shell-first / personalize-after).
 */
export function isBrowsePathname(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? ''
  return path === '/browse' || path.startsWith('/browse/')
}
