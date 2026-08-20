import type { SyncManifestItem } from '@skillet/protocol';
import { parseRef } from '@skillet/protocol/skill-id';
import { parseSkillRef } from '../registry/identifier.js';
import type { KitState, SkillEntry } from './types.js';

/**
 * Registry-served version labels are unsigned, attacker-influenced strings
 * rendered straight into terminals and persisted to local state. The server
 * only ever emits "X.Y.Z", so anything else is dropped rather than trusted.
 */
export function sanitizeVersionLabel(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : undefined;
}

/** Whether a local kit entry refers to the same skill as a manifest row. */
export function localMatchesManifest(entry: SkillEntry, item: SyncManifestItem): boolean {
  if (entry.slug === item.ref) return true;
  if (entry.hash && item.content_hash && entry.hash === item.content_hash) return true;
  try {
    const { author, slug } = parseSkillRef(item.ref);
    if (entry.slug === slug) return true;
    // Canonical owner+slug comparison, sourced from the shared tolerant
    // parser rather than a hand-rolled `/`-only join — so a local slug
    // persisted as `@owner/slug`, `owner/slug`, or `owner:slug` all match
    // the same manifest row instead of silently re-materializing.
    try {
      const local = parseRef(entry.slug);
      if (local.owner === author && local.slug === slug) return true;
    } catch {
      // entry.slug isn't a parseable owner+slug ref (e.g. a bare slug) —
      // already covered by the exact-slug check above.
    }
    if (entry.owner === author && entry.name === slug) return true;
  } catch {
    // Non-canonical manifest ref — hash/exact slug only.
  }
  return false;
}

/** All local slugs that refer to the same manifest row (for deduped list UIs). */
export function findAllLocalsForManifestItem(
  state: KitState,
  item: SyncManifestItem,
): Array<{ slug: string; entry: SkillEntry }> {
  const matches: Array<{ slug: string; entry: SkillEntry }> = [];
  for (const [slug, entry] of Object.entries(state.skills)) {
    if (localMatchesManifest(entry, item)) {
      matches.push({ slug, entry });
    }
  }
  matches.sort((a, b) => {
    if (a.slug === item.ref) return -1;
    if (b.slug === item.ref) return 1;
    return a.slug.localeCompare(b.slug);
  });
  return matches;
}

/** Find the local state row for a manifest item, including import aliases. */
export function findLocalForManifestItem(
  state: KitState,
  item: SyncManifestItem,
  skipSlugs: ReadonlySet<string> = new Set(),
): { slug: string; entry: SkillEntry } | undefined {
  for (const match of findAllLocalsForManifestItem(state, item)) {
    if (!skipSlugs.has(match.slug)) return match;
  }
  return undefined;
}

/** Prefer the registry canonical ref when presenting a matched skill. */
export function alignEntryToManifest(
  entry: SkillEntry,
  item: SyncManifestItem,
): SkillEntry {
  const label = sanitizeVersionLabel(item.version_label);
  return {
    ...entry,
    slug: item.ref,
    owner: entry.owner ?? parseSkillRef(item.ref).author,
    sourceKit: item.source_kit ?? entry.sourceKit ?? null,
    sourceClass: entry.sourceClass ?? (item.external_author ? 'external' : 'own-kit'),
    category: item.category ?? entry.category ?? null,
    // Carry token weight and the display label only when the manifest row
    // describes the same version the local entry holds — a slug-only match may
    // be behind it, and showing the served version's weight next to older
    // installed content would misreport the local cost.
    ...(entry.hash === item.content_hash
      ? {
          tokenCount: item.token_count ?? entry.tokenCount,
          tokenAmbient: item.token_ambient ?? entry.tokenAmbient,
          tokenMethod: item.token_method ?? entry.tokenMethod,
        }
      : {}),
    ...(label && entry.hash === item.content_hash
      ? { versionLabel: label }
      : {}),
  };
}
