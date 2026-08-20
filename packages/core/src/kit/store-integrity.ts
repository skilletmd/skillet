import { access } from 'node:fs/promises';
import { canonicalContentHash, skillContentHash } from '@skillet/protocol';
import { readBundleFromDir } from '../bundle/read.js';
import { skillContentDir } from './store.js';

/**
 * Hash the skill store bundle for `slug`, or null when the store is missing
 * or unreadable as a bundle.
 */
export async function readSkillStoreContentHash(slug: string): Promise<string | null> {
  try {
    await access(skillContentDir(slug));
    const bundle = await readBundleFromDir(skillContentDir(slug));
    return skillContentHash(bundle);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** True when our skill store directory exists (ENOENT returns false). */
export async function skillStoreDirExists(slug: string): Promise<boolean> {
  try {
    await access(skillContentDir(slug));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** True when on-disk bundle hash equals the expected canonical `sha256:` hash. */
export async function skillStoreMatchesExpectedHash(
  slug: string,
  expectedHash: string,
): Promise<boolean> {
  const storeHash = await readSkillStoreContentHash(slug);
  if (!storeHash) return false;
  if (storeHash === expectedHash) return true;
  // Legacy polluted publish: entry.hash counted `.skillet-backup` paths.
  try {
    const bundle = await readBundleFromDir(skillContentDir(slug), { includeSkilletBackups: true });
    return canonicalContentHash(bundle) === expectedHash;
  } catch {
    return false;
  }
}

/** True when store skill bytes match `entryHash`, including legacy polluted hashes. */
export function storeBundleMatchesEntryHash(
  storeBundle: Map<string, Uint8Array>,
  entryHash: string,
  storeBundleWithBackups?: Map<string, Uint8Array>,
): boolean {
  const skillHash = skillContentHash(storeBundle);
  if (skillHash === entryHash) return true;
  if (storeBundleWithBackups) {
    return canonicalContentHash(storeBundleWithBackups) === entryHash;
  }
  return false;
}
