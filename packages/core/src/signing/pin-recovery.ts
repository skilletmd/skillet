/**
 * TOFU pin recovery when an author's primary signing key changes on the registry.
 *
 * `forceRepinAuthorKey` lives in pin.ts; this module adds comparison, registry
 * fetch, and structured parsing for sync/CLI recovery flows.
 */

import { parseSkillRef } from '../registry/identifier.js';
import { RegistryClient, RegistryError } from '../registry/client.js';
import {
  defaultPinDir,
  forceRepinAuthorKey,
  loadPinnedKey,
  type PinnedAuthorKey,
} from './pin.js';

const AUTHOR_KEY_CHANGED_RE =
  /author_key_changed: handle (\S+) pinned to ([0-9a-f]{64}), registry served ([0-9a-f]{64})/;

export interface AuthorKeyMismatchInfo {
  handle: string;
  pinnedKeyId: string;
  servedKeyId: string;
}

export interface AuthorPinComparison {
  handle: string;
  pinned: PinnedAuthorKey | null;
  served: { key_id: string; pub: string } | null;
  mismatch: boolean;
}

/** Shorten a 64-char hex key id for terminal output. */
export function truncateKeyId(keyId: string, prefix = 8): string {
  if (keyId.length <= prefix * 2) return keyId;
  return `${keyId.slice(0, prefix)}…`;
}

/** Parse `author_key_changed` detail from a pull/sync failure reason string. */
export function parseAuthorKeyMismatch(reason: string): AuthorKeyMismatchInfo | null {
  const match = reason.match(AUTHOR_KEY_CHANGED_RE);
  if (!match) return null;
  return {
    handle: match[1]!,
    pinnedKeyId: match[2]!,
    servedKeyId: match[3]!,
  };
}

/** Compare the local TOFU pin with registry-served author key material. */
export async function compareAuthorPin(
  handle: string,
  pinDir: string = defaultPinDir(),
  served?: { key_id: string; pub: string } | null,
): Promise<AuthorPinComparison> {
  const normalized = handle.startsWith('@') ? handle.slice(1) : handle;
  const pinned = await loadPinnedKey(normalized, pinDir);
  const mismatch =
    pinned !== null &&
    served !== null &&
    served !== undefined &&
    pinned.key_id !== served.key_id;
  return {
    handle: normalized,
    pinned,
    served: served ?? null,
    mismatch,
  };
}

function assertManifestAuthor(
  handle: string,
  ref: string,
  authorKeyId: string | null | undefined,
  authorPublicKey: string | null | undefined,
): { key_id: string; pub: string } {
  const normalized = handle.startsWith('@') ? handle.slice(1) : handle;
  const { author } = parseSkillRef(ref);
  if (author !== normalized) {
    throw new RegistryError(
      'author_mismatch',
      `Skill ${ref} is owned by @${author}, not @${normalized}`,
    );
  }
  if (!authorKeyId || !authorPublicKey) {
    throw new RegistryError(
      'author_not_claimed',
      `@${normalized} has no claimed signing key on the registry`,
    );
  }
  return { key_id: authorKeyId, pub: authorPublicKey };
}

/**
 * Fetch the registry's current primary author key for a handle.
 * Uses an explicit skill ref when provided; otherwise scans the caller's sync manifest.
 */
export async function fetchServedAuthorKey(
  handle: string,
  client: RegistryClient,
  opts: { skillRef?: string } = {},
): Promise<{ key_id: string; pub: string; skillRef: string }> {
  const normalized = handle.startsWith('@') ? handle.slice(1) : handle;

  if (opts.skillRef) {
    const manifest = await client.getSkillManifest(opts.skillRef);
    if (!manifest.value) {
      throw new RegistryError('manifest_empty', `No manifest body for ${opts.skillRef}`);
    }
    const served = assertManifestAuthor(
      normalized,
      opts.skillRef,
      manifest.value.author_key_id,
      manifest.value.author_public_key,
    );
    return { ...served, skillRef: opts.skillRef };
  }

  const sync = await client.getSyncManifest();
  if (!sync.value?.items?.length) {
    throw new RegistryError(
      'no_skill_ref',
      `Cannot resolve @${normalized}'s signing key — no sync manifest items (pass a skill ref)`,
    );
  }

  const item = sync.value.items.find((entry) => {
    try {
      return parseSkillRef(entry.ref).author === normalized;
    } catch {
      return false;
    }
  });
  if (!item) {
    throw new RegistryError(
      'no_skill_ref',
      `Cannot resolve @${normalized}'s signing key — no subscribed skill from this author`,
    );
  }

  const manifest = await client.getSkillManifest(item.ref);
  if (!manifest.value) {
    throw new RegistryError('manifest_empty', `No manifest body for ${item.ref}`);
  }
  const served = assertManifestAuthor(
    normalized,
    item.ref,
    manifest.value.author_key_id ?? item.author_key_id,
    manifest.value.author_public_key,
  );
  return { ...served, skillRef: item.ref };
}

/** Human-approved overwrite of a stale TOFU pin. */
export async function acceptAuthorKeyRotation(
  handle: string,
  served: { key_id: string; pub: string },
  pinDir: string = defaultPinDir(),
  opts: { firstSeenVersion?: number } = {},
): Promise<PinnedAuthorKey> {
  return forceRepinAuthorKey(
    handle,
    {
      key_id: served.key_id,
      pub: served.pub,
      first_seen_version: opts.firstSeenVersion ?? 0,
    },
    pinDir,
  );
}

/** Recovery hint lines for terminal sync output. */
export function formatAuthorKeyMismatchHint(info: AuthorKeyMismatchInfo): string[] {
  return [
    `  author signing key changed for @${info.handle}`,
    `  pinned: ${truncateKeyId(info.pinnedKeyId)}`,
    `  registry: ${truncateKeyId(info.servedKeyId)}`,
    `  Run: skillet pin accept ${info.handle}`,
  ];
}
