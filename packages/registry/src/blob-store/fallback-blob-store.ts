import type { BlobStore } from './types.js';

/** Read primary then fallback; write to every store (migration / dual-host). */
export class FallbackBlobStore implements BlobStore {
  constructor(
    private readonly primary: BlobStore,
    private readonly fallback: BlobStore,
  ) {}

  async get(hash: string): Promise<Uint8Array | null> {
    const primary = await this.primary.get(hash);
    if (primary) return primary;
    return this.fallback.get(hash);
  }

  async put(hash: string, bytes: Uint8Array): Promise<void> {
    await Promise.all([this.primary.put(hash, bytes), this.fallback.put(hash, bytes)]);
  }

  async has(hash: string): Promise<boolean> {
    if (await this.primary.has(hash)) return true;
    return this.fallback.has(hash);
  }
}
