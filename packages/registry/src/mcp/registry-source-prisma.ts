// Prisma-backed SkillSource for the hosted MCP endpoint (list_skills / get_skill).
//
// Mirrors createRegistrySkillSource in source.ts: one source per request scoped to
// one user, synthesized from buildSessionManifestPrisma and filtered through the
// same serve guards and canReadSkillPrisma ACL as sync content.

import type { SkillEntry, SkillSource } from '@skillet/mcp';
import type { BlobStore } from '../blob-store/types.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { buildSessionManifestPrisma } from '../lib/sync-manifest.js';
import { serveBlockForModerationPrisma, serveBlockForScanPrisma } from '../routes/serve-guards.js';
import { canReadSkillPrisma } from '../auth/skill-read-access.js';
import type { RegistrySourceContext } from './source.js';

interface ResolvedSkill {
  entry: SkillEntry;
  skillId: string;
  storedHash: string;
  owner: string;
}

const stripPrefix = (h: string): string =>
  h.startsWith('sha256:') ? h.slice('sha256:'.length) : h;
const withPrefix = (h: string): string => (h.startsWith('sha256:') ? h : `sha256:${h}`);

async function resolveServableHashPrisma(
  prisma: PrismaDb,
  skillId: string,
  manifestHash: string,
): Promise<string | null> {
  if (!(await serveBlockForScanPrisma(prisma, withPrefix(manifestHash)))) {
    return withPrefix(manifestHash);
  }
  const candidates = await prisma.skill_versions.findMany({
    where: { skill_id: skillId, yanked_at: null },
    orderBy: { published_at: 'desc' },
    select: { hash: true },
  });
  for (const c of candidates) {
    if (!(await serveBlockForScanPrisma(prisma, withPrefix(c.hash)))) {
      return c.hash;
    }
  }
  return null;
}

async function buildResolvedSkillsPrisma(
  prisma: PrismaDb,
  ctx: RegistrySourceContext,
): Promise<Map<string, ResolvedSkill>> {
  const bySlug = new Map<string, ResolvedSkill>();
  const items = await buildSessionManifestPrisma(prisma, ctx.userId, ctx.handle);
  for (const item of items) {
    const match = /^@([^/]+)\/(.+)$/.exec(item.ref);
    if (!match) continue;
    const owner = match[1]!;
    const slug = match[2]!;
    const key = bySlug.has(slug) ? `${owner}/${slug}` : slug;
    if (bySlug.has(key)) continue;

    const skillRow = await prisma.skills.findFirst({
      where: { author_id: owner, slug },
      select: { id: true, description: true, visibility: true },
    });
    if (!skillRow) continue;
    if (await serveBlockForModerationPrisma(prisma, skillRow.id)) continue;
    if (!(await canReadSkillPrisma(prisma, ctx.principal, skillRow.id, skillRow.visibility))) {
      continue;
    }

    const servedHash = await resolveServableHashPrisma(prisma, skillRow.id, item.content_hash);
    if (!servedHash) continue;

    const versionRow = await prisma.skill_versions.findFirst({
      where: {
        skill_id: skillRow.id,
        OR: [{ hash: stripPrefix(servedHash) }, { hash: withPrefix(servedHash) }],
      },
      select: { metadata_json: true, published_at: true },
    });
    let name = slug;
    if (versionRow) {
      try {
        const meta = JSON.parse(versionRow.metadata_json) as { name?: unknown };
        if (typeof meta.name === 'string' && meta.name.length > 0) name = meta.name;
      } catch {
        /* metadata is display-only; fall back to the slug */
      }
    }

    const publishedIso = new Date((versionRow?.published_at ?? 0) * 1000).toISOString();
    const entry: SkillEntry = {
      slug: key,
      owner,
      name,
      description: skillRow.description ?? '',
      version: item.version,
      ...(item.version_label ? { versionLabel: item.version_label } : {}),
      hash: withPrefix(servedHash),
      source: 'registry',
      importedAt: publishedIso,
      updatedAt: publishedIso,
    };
    bySlug.set(key, { entry, skillId: skillRow.id, storedHash: servedHash, owner });
  }
  return bySlug;
}

/** Build a per-request SkillSource over Prisma registry storage for one user. */
export function createRegistrySkillSourcePrisma(
  prisma: PrismaDb,
  blobStore: BlobStore,
  ctx: RegistrySourceContext,
): SkillSource {
  let resolved: Map<string, ResolvedSkill> | null = null;
  const load = async (): Promise<Map<string, ResolvedSkill>> => {
    resolved ??= await buildResolvedSkillsPrisma(prisma, ctx);
    return resolved;
  };

  return {
    async listEntries(): Promise<SkillEntry[]> {
      return [...(await load()).values()].map((r) => r.entry);
    },

    async listFiles(slug: string): Promise<string[]> {
      const skill = (await load()).get(slug);
      if (!skill) return [];
      const rows = await prisma.skill_version_files.findMany({
        where: {
          skill_id: skill.skillId,
          OR: [
            { version_hash: stripPrefix(skill.storedHash) },
            { version_hash: withPrefix(skill.storedHash) },
          ],
        },
        orderBy: { path: 'asc' },
        select: { path: true },
      });
      return rows.map((r) => r.path);
    },

    async readFile(slug: string, path: string): Promise<Uint8Array | string | null> {
      const skill = (await load()).get(slug);
      if (!skill) return null;
      const row = await prisma.skill_version_files.findFirst({
        where: {
          skill_id: skill.skillId,
          OR: [
            { version_hash: stripPrefix(skill.storedHash) },
            { version_hash: withPrefix(skill.storedHash) },
          ],
          path,
        },
        select: { blob_hash: true },
      });
      if (!row) return null;
      const bytes = await blobStore.get(row.blob_hash);
      if (!bytes) {
        throw new Error(
          `Registry storage is missing "${path}" for @${skill.owner}/${slug}. ` +
            'Try again shortly; if it persists, the skill needs to be republished.',
        );
      }
      return bytes;
    },
  };
}
