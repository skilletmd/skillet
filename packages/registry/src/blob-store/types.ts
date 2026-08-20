/** Content-addressed blob I/O — bytes keyed by `sha256:<hex>` or bare hex. */
export interface BlobStore {
  /** Fetch blob bytes. Returns null when the hash is unknown. */
  get(hash: string): Promise<Uint8Array | null>;
  /** Store bytes at `hash`. Idempotent when the same hash already exists. */
  put(hash: string, bytes: Uint8Array): Promise<void>;
  /** True when this store can serve the hash (may still return null for corrupt refs). */
  has(hash: string): Promise<boolean>;
}

export type BlobStoreMode = 'r2' | 'dual' | 'memory';

export interface R2BlobStoreConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Optional prefix inside the bucket, e.g. `registry-blobs`. */
  keyPrefix?: string;
}
