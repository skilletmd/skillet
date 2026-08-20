import { access } from 'node:fs/promises';
import {
  discoverGitHubSkills,
  looksLikeGitHubSpec,
  parseSkillRef,
  SkillRefError,
  type GitHubDiscovery,
} from '@skillet/core';

export type AddSourceKind = 'github' | 'registry_skill' | 'local_path' | 'missing';

export interface ResolvedAddSource {
  kind: AddSourceKind;
  /** Original user input. */
  raw: string;
  /** Display label for stepped output. */
  display: string;
  githubRef?: string;
  registryRef?: string;
  localPath?: string;
}

export function isRegistrySkillRef(source: string): boolean {
  if (!source.startsWith('@')) return false;
  try {
    parseSkillRef(source);
    return true;
  } catch (err) {
    if (err instanceof SkillRefError) return false;
    throw err;
  }
}

export function normalizeRegistryRef(source: string): string {
  const ref = source.startsWith('@') ? source : `@${source}`;
  return parseSkillRef(ref).canonical;
}

export async function resolveAddSource(source: string | undefined): Promise<ResolvedAddSource> {
  const raw = (source ?? '').trim();
  if (!raw) {
    return { kind: 'missing', raw: '', display: '' };
  }

  if (raw.startsWith('@')) {
    const registryRef = normalizeRegistryRef(raw);
    return { kind: 'registry_skill', raw, display: registryRef, registryRef };
  }

  if (looksLikeGitHubSpec(raw)) {
    return {
      kind: 'github',
      raw,
      display: raw.includes('github.com') ? raw : `https://github.com/${raw.replace(/^\/+/, '')}`,
      githubRef: raw,
    };
  }

  try {
    await access(raw);
    return { kind: 'local_path', raw, display: raw, localPath: raw };
  } catch {
    // Not a readable local path — may still be a bundle path the importer resolves.
  }

  if (raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('~')) {
    return { kind: 'local_path', raw, display: raw, localPath: raw };
  }

  return { kind: 'missing', raw, display: raw };
}

export async function discoverGithubForAdd(
  source: ResolvedAddSource,
  opts: { ref?: string },
): Promise<GitHubDiscovery> {
  if (source.kind !== 'github' || !source.githubRef) {
    throw new Error('Not a GitHub source');
  }
  return discoverGitHubSkills(source.githubRef, opts.ref ? { ref: opts.ref } : {});
}
