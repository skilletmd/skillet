/**
 * Encode user-supplied path segments before interpolating into registry URLs.
 * Defense in depth alongside server-side param validation.
 */
export function encodeRegistrySegment(segment: string): string {
  return encodeURIComponent(segment)
}

export function registrySkillBasePath(author: string, slug: string): string {
  return `/skills/${encodeRegistrySegment(author)}/${encodeRegistrySegment(slug)}`
}

export function registrySkillSubPath(author: string, slug: string, suffix = ''): string {
  const base = registrySkillBasePath(author, slug)
  return suffix ? `${base}/${suffix}` : base
}
