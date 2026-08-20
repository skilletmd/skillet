import type { SyncManifestItem } from '@skillet/protocol';
import type { KitState, SkillEntry } from './types.js';
import { BUNDLED_ROUTE_SLUG } from '../commands/route.js';
import {
  alignEntryToManifest,
  findAllLocalsForManifestItem,
} from './manifest-match.js';
import { parseSkillRef } from '../registry/identifier.js';

/** Skills from a registry kit (`sourceKit` set) are eligible for `skillet sync`. */
export function isKitSyncedSkill(entry: SkillEntry): boolean {
  return typeof entry.sourceKit === 'string' && entry.sourceKit.length > 0;
}

/**
 * Skillet's own skills, shipped as plumbing rather than user content: the
 * bundled `/skillet` router today, plus any future Skillet-authored companion
 * (help, manage, reconcile). They materialize into every runtime regardless of
 * kit membership and are never counted or listed as the user's skills.
 */
const SKILLET_SYSTEM_SKILL_SLUGS = new Set<string>([BUNDLED_ROUTE_SLUG]);

export function isSkilletSystemSkill(entry: SkillEntry): boolean {
  return SKILLET_SYSTEM_SKILL_SLUGS.has(entry.slug);
}

export function kitSyncedSkillEntries(state: KitState): SkillEntry[] {
  return Object.values(state.skills).filter(isKitSyncedSkill);
}

export interface KitSkillGroup {
  /** `@owner/kit` when synced from a kit; null for skills not in any kit. */
  kitRef: string | null;
  skills: SkillEntry[];
}

function groupSkillsByKitFromState(state: KitState): KitSkillGroup[] {
  const byKit = new Map<string, SkillEntry[]>();
  const localOnly: SkillEntry[] = [];

  for (const entry of Object.values(state.skills)) {
    // The bundled `/skillet` router is Skillet's own plumbing — never a
    // user-visible kit skill. Hide it from every list surface.
    if (isSkilletSystemSkill(entry)) continue;
    if (isKitSyncedSkill(entry)) {
      const kit = entry.sourceKit as string;
      const list = byKit.get(kit) ?? [];
      list.push(entry);
      byKit.set(kit, list);
    } else {
      localOnly.push(entry);
    }
  }

  const groups: KitSkillGroup[] = [];
  for (const [kitRef, skills] of [...byKit.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    skills.sort((a, b) => a.slug.localeCompare(b.slug));
    groups.push({ kitRef, skills });
  }

  if (localOnly.length > 0) {
    localOnly.sort((a, b) => a.slug.localeCompare(b.slug));
    groups.push({ kitRef: null, skills: localOnly });
  }

  return groups;
}

export interface GroupSkillsByKitOptions {
  /**
   * When set (including `[]`), kit membership comes from the registry manifest.
   * Omit or pass `undefined` only when offline — local `sourceKit` tags apply.
   */
  manifestItems?: SyncManifestItem[] | undefined;
}

/** Build a display entry from a registry manifest row when nothing is local yet. */
export function entryFromManifestItem(item: SyncManifestItem): SkillEntry {
  let owner: string | null = null;
  let name = item.ref;
  try {
    const parsed = parseSkillRef(item.ref);
    owner = parsed.author;
    name = parsed.slug;
  } catch {
    // Non-canonical ref — show as-is.
  }
  const now = new Date().toISOString();
  return {
    slug: item.ref,
    owner,
    name,
    description: '',
    version: item.version,
    hash: item.content_hash,
    source: 'registry',
    sourceClass: item.external_author ? 'external' : 'own-kit',
    sourceKit: item.source_kit,
    subscriberTrust: item.subscriber_trust ?? null,
    importedAt: now,
    updatedAt: now,
  };
}

/**
 * Group skills for list UIs. With a sync manifest, kits win over local import
 * aliases (e.g. `skillet-sync` vs `@thiago/skillet-sync`).
 */
export function groupSkillsByKit(
  state: KitState,
  opts?: GroupSkillsByKitOptions,
): KitSkillGroup[] {
  const items = opts?.manifestItems;
  if (items === undefined) {
    return groupSkillsByKitFromState(state);
  }

  const consumed = new Set<string>();
  const byKit = new Map<string, SkillEntry[]>();

  const kitItems = items.filter(
    (item) => typeof item.source_kit === 'string' && item.source_kit.length > 0,
  );
  kitItems.sort((a, b) => {
    const kit = (a.source_kit ?? '').localeCompare(b.source_kit ?? '');
    if (kit !== 0) return kit;
    return a.ref.localeCompare(b.ref);
  });

  for (const item of kitItems) {
    const matches = findAllLocalsForManifestItem(state, item).filter(
      (m) => !consumed.has(m.slug),
    );
    const match = matches[0];
    for (const alias of matches) {
      consumed.add(alias.slug);
    }
    const display = match
      ? alignEntryToManifest(match.entry, item)
      : entryFromManifestItem(item);
    const kit = item.source_kit as string;
    const list = byKit.get(kit) ?? [];
    list.push(display);
    byKit.set(kit, list);
  }

  const notInKit: SkillEntry[] = [];
  for (const entry of Object.values(state.skills)) {
    if (consumed.has(entry.slug)) continue;
    // The bundled `/skillet` router is Skillet's own plumbing — never listed.
    if (isSkilletSystemSkill(entry)) continue;
    // Kit-synced locals missing from the device manifest are pending prune — hide
    // until `skillet sync` reconciles them off this machine.
    if (isKitSyncedSkill(entry)) continue;
    notInKit.push(entry);
  }

  const groups: KitSkillGroup[] = [];
  for (const [kitRef, skills] of [...byKit.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    skills.sort((a, b) => a.slug.localeCompare(b.slug));
    groups.push({ kitRef, skills });
  }

  if (notInKit.length > 0) {
    notInKit.sort((a, b) => a.slug.localeCompare(b.slug));
    groups.push({ kitRef: null, skills: notInKit });
  }

  return groups;
}

/** KitState slice containing only skills that sync to runtimes. */
export function kitSyncedState(state: KitState): KitState {
  const skills: KitState['skills'] = {};
  for (const [slug, entry] of Object.entries(state.skills)) {
    if (isKitSyncedSkill(entry)) {
      skills[slug] = entry;
    }
  }
  return { version: state.version, skills };
}
