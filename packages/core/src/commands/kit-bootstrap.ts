/**
 * Publish unpublished local kit skills, create a named registry kit, and link
 * every published skill into it so device sync can route the group as `kit:<id>`.
 */
import { readState } from '../kit/store.js';
import { loadSessionToken } from '../session-token.js';
import { publish, type PublishOptions } from './publish.js';
import { createKit, addSkillToKit } from './kit.js';

export interface BootstrapLocalKitOptions {
  name: string;
  visibility?: 'private' | 'public';
  /** When omitted, every local skill with no owner in the kit store is included. */
  slugs?: string[];
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  sessionAuth?: boolean;
}

export type BootstrapFailureStage = 'publish' | 'kit_create' | 'kit_add';

export interface BootstrapLocalKitResult {
  ok: boolean;
  kit: { id: string; owner: string; name: string } | null;
  owner: string;
  published: Array<{ slug: string; alreadyExists: boolean }>;
  kitLinked: string[];
  failed: Array<{ slug: string; stage: BootstrapFailureStage; error: string }>;
  empty: boolean;
}

async function localUnpublishedSlugs(): Promise<string[]> {
  const state = await readState();
  return Object.values(state.skills)
    .filter((s) => s.source === 'local' && !s.owner)
    .map((s) => s.slug)
    .sort((a, b) => a.localeCompare(b));
}

export async function bootstrapLocalKit(
  opts: BootstrapLocalKitOptions,
): Promise<BootstrapLocalKitResult> {
  const state = await readState();
  const slugs = (opts.slugs ?? (await localUnpublishedSlugs())).filter((slug) => {
    const entry = state.skills[slug];
    return entry?.source === 'local' && !entry.owner;
  });

  if (slugs.length === 0) {
    return {
      ok: false,
      kit: null,
      owner: '',
      published: [],
      kitLinked: [],
      failed: [],
      empty: true,
    };
  }

  const token = await loadSessionToken(opts.token);
  const publishOpts: PublishOptions = {
    ...(opts.registryUrl ? { registryUrl: opts.registryUrl } : {}),
    token,
    visibility: opts.visibility ?? 'private',
    sessionAuth: opts.sessionAuth ?? true,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  };

  const published: Array<{ slug: string; alreadyExists: boolean }> = [];
  const failed: BootstrapLocalKitResult['failed'] = [];

  for (const slug of slugs) {
    try {
      const result = await publish(slug, publishOpts);
      published.push({ slug, alreadyExists: result.alreadyExists });
    } catch (err) {
      failed.push({ slug, stage: 'publish', error: (err as Error).message });
    }
  }

  if (published.length === 0) {
    return {
      ok: false,
      kit: null,
      owner: '',
      published,
      kitLinked: [],
      failed,
      empty: false,
    };
  }

  let kit: BootstrapLocalKitResult['kit'] = null;
  let owner = '';
  try {
    kit = await createKit({
      name: opts.name,
      ...(opts.registryUrl ? { registryUrl: opts.registryUrl } : {}),
      token,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    owner = kit.owner;
  } catch (err) {
    failed.push({ slug: '*', stage: 'kit_create', error: (err as Error).message });
    return {
      ok: false,
      kit: null,
      owner,
      published,
      kitLinked: [],
      failed,
      empty: false,
    };
  }

  const kitLinked: string[] = [];
  for (const { slug } of published) {
    try {
      await addSkillToKit({
        kitRef: opts.name,
        skillRef: `@${owner}/${slug}`,
        ...(opts.registryUrl ? { registryUrl: opts.registryUrl } : {}),
        token,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      kitLinked.push(slug);
    } catch (err) {
      failed.push({ slug, stage: 'kit_add', error: (err as Error).message });
    }
  }

  return {
    ok: kitLinked.length > 0,
    kit,
    owner,
    published,
    kitLinked,
    failed,
    empty: false,
  };
}
