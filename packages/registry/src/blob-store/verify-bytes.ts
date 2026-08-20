import { blobHash } from '../db/index.js';

/** True when bytes match the content-addressed blob key. */
export function verifyBlobBytes(storedHash: string, bytes: Uint8Array): boolean {
  return blobHash(bytes) === storedHash;
}
