/** Normalize registry blob hashes to R2/S3 object keys. */
export function blobObjectKey(hash: string, prefix = ''): string {
  const bare = hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
  const base = `blobs/sha256/${bare}`;
  if (!prefix) return base;
  const trimmed = prefix.replace(/^\/+|\/+$/g, '');
  return `${trimmed}/${base}`;
}
