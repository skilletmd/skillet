import type { KitState, SkillEntry } from './types.js';

/**
 * Collapse stale "published twin" duplicates in the kit state.
 *
 * Publishing a locally-imported skill flips its bare-key entry to
 * `source:'registry'`, and the next union-manifest pull re-keys the same skill
 * under its promoted `@owner/slug` key. That pull's alias-dedup
 * (`promoteAliasToCanonical`) only runs when the manifest returns 200 — on a
 * stable manifest the request 304s and the sweep never runs, so the bare twin
 * lingers indefinitely. A lingering twin:
 *   - inflates the tray's "only on this device" count (it isn't in a sync kit,
 *     so the loose-skill grouping counts it as un-synced), and
 *   - for a `source:'local'` twin, inflates the upload panel's capturable list
 *     (`source==='local' && !owner`), mislabeling an already-published skill as
 *     "not backed up".
 *
 * A bare `slug` entry is a stale twin when an OWNED promoted `@owner/slug`
 * entry with the SAME content hash exists. Requirements, each load-bearing:
 *   - hashes must match — a diverged local edit (a fork off the published
 *     version) is genuine un-backed-up work and must never be discarded;
 *   - the bare entry must be unowned — an owned bare entry is not a leftover;
 *   - pinned / customized / held-update entries carry user intent and are kept.
 *
 * Pure and I/O-free: it only rewrites `state.skills` and returns the removed
 * keys so the caller can best-effort drop the now-orphaned content dirs.
 */
export function collapsePublishedTwins(state: KitState): { removed: string[] } {
  const removed: string[] = [];
  const entries = state.skills;

  // Index owned, promoted (`@owner/slug`) entries by their bare slug tail.
  const promotedByTail = new Map<string, SkillEntry>();
  for (const [key, entry] of Object.entries(entries)) {
    if (!key.startsWith('@') || !entry.owner) continue;
    const slash = key.indexOf('/');
    const tail = slash >= 0 ? key.slice(slash + 1) : '';
    if (tail) promotedByTail.set(tail, entry);
  }

  for (const [key, entry] of Object.entries(entries)) {
    if (key.startsWith('@')) continue; // only bare keys can be stale twins
    if (entry.owner) continue; // an owned bare entry is not a publish leftover
    if (entry.pinned || entry.customized_from || entry.held_update) continue;
    const twin = promotedByTail.get(key);
    if (!twin) continue; // no canonical counterpart — a genuine local-only skill
    if (!entry.hash || entry.hash !== twin.hash) continue; // diverged edit — keep
    delete entries[key];
    removed.push(key);
  }

  return { removed };
}
