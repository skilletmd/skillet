/** True for the `/lab` tree — internal tooling that is reachable but unlisted.
 *
 *  `/lab` used to carry a `SHOW_LAB` env gate whose layout called `notFound()`
 *  to 404 the tree in production. It never worked: under `cacheComponents` a
 *  layout's `notFound()` does not stop its children rendering, so production
 *  served `/lab/design` at 200 with the whole design system regardless. Rather
 *  than move that gate somewhere it would hold, the tools are now public on
 *  purpose and kept out of every discovery surface instead — nothing links to
 *  them, they are absent from the sitemap and `llms.txt`, robots.txt disallows
 *  them, and every response carries `noindex` twice (meta tag + `X-Robots-Tag`).
 */
export function isLabPath(pathname: string): boolean {
  return pathname === '/lab' || pathname.startsWith('/lab/')
}
