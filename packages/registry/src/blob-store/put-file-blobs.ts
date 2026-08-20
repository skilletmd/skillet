import type { BlobStore } from './types.js';

export interface FileBlob {
  path: string;
  hash: string;
  bytes: Uint8Array;
}

/** Store content-addressed blobs before metadata transactions commit. */
export async function putFileBlobs(blobStore: BlobStore, fileBlobs: FileBlob[]): Promise<void> {
  await Promise.all(fileBlobs.map((fb) => blobStore.put(fb.hash, fb.bytes)));
}
