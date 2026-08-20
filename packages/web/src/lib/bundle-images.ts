import { isInlineImagePath, MAX_INLINE_IMAGE_BYTES } from '@skillet/protocol/inline-images'
import { skillFileUrl } from './registry-proxy'

/**
 * Client-side mirror of the registry's raw-file route policy: emit an image URL
 * only when the route would serve it (path exists in the bundle, allowlisted
 * raster extension, within the inline size cap), so the viewer never issues a
 * request destined for a 404/413. Anything that fails a check renders nothing —
 * a broken-image icon must not be reachable from a skill page.
 */

/** What the viewer needs to build raw-file URLs for one bundle. Plain data —
 *  it crosses the RSC boundary into the client viewer components. */
export interface SkillBundleAssets {
  author: string
  slug: string
  versionHash: string
  /** path → decoded size in bytes, for every file in the bundle. */
  sizes: Record<string, number>
}

/**
 * Resolve `./`, `../`, and bare segments against a base directory, staying
 * inside the bundle root. Dot-segments are resolved in the PATH (string
 * space), never via URL parsing. Null when the path escapes the root or
 * collapses to nothing.
 */
function resolveRelativePath(baseDir: string, src: string): string | null {
  const joined = baseDir ? `${baseDir}/${src}` : src
  const out: string[] = []
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.length > 0 ? out.join('/') : null
}

/**
 * Proxy URL for one bundle file, or null when the raw-file route would refuse
 * it. `%`, `#`, and `?` are legal in bundle paths but mangle through the
 * proxy's URL round-trip, so such files stay download-only.
 */
export function bundleImageUrl(assets: SkillBundleAssets, path: string): string | null {
  if (/[%#?]/.test(path)) return null
  if (!isInlineImagePath(path)) return null
  const size = assets.sizes[path]
  if (size === undefined || size > MAX_INLINE_IMAGE_BYTES) return null
  return skillFileUrl(assets.author, assets.slug, assets.versionHash, path)
}

/**
 * Build the `resolveImageSrc` for markdown rendered from `renderedPath`:
 * relative srcs resolve against that file's own directory (a `./img/x.png` in
 * `docs/GUIDE.md` means `docs/img/x.png`, not the bundle root).
 */
export function bundleImageResolver(
  assets: SkillBundleAssets,
  renderedPath: string,
): (src: string) => string | null {
  const baseDir = renderedPath.split('/').slice(0, -1).join('/')
  return (src) => {
    if (/[%#?]/.test(src)) return null
    const resolved = resolveRelativePath(baseDir, src)
    return resolved ? bundleImageUrl(assets, resolved) : null
  }
}
