// Prisma-backed DiscoverySource for the hosted MCP endpoint (summon).
//
// Sibling of registry-source-prisma.ts, and its mirror image: that source is
// kit-scoped (what the caller already has), this one is public-scoped (what
// everyone else has published). Supplied only on the hosted transport — the
// local loopback server passes none, so `skillet mcp` advertises no summon
// tools and keeps no network dependency.
//
// Every method reuses the query the equivalent HTTP route already uses, rather
// than reimplementing it. Summon over MCP and summon over HTTP returning
// different answers for the same handle would be a bug nobody notices for
// months, so the composition rules live in one place: getHandleKitCandidatesPrisma
// for candidates, searchSkillsPrisma for the fallback.

import type {
  AuthorStanding,
  DiscoverySource,
  PublicReadOptions,
  PublicSkill,
  SummonCandidate,
  SummonResult,
} from '@skillet/mcp';
import type { BlobStore } from '../blob-store/types.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { getHandleKitCandidatesPrisma } from '../lib/handle-kit.js';
import { recordSearchSourcePrisma, searchSkillsPrisma } from '../lib/universal-search.js';
import { emitSummonEvent, summonCountsBySkillPrisma } from '../lib/summon-events.js';
import { countSkillAdoptersPrisma } from '../lib/profile-payload.js';
import { serveBlockForModerationPrisma, serveBlockForScanPrisma } from '../routes/serve-guards.js';
import { canReadSkillPrisma } from '../auth/skill-read-access.js';
import type { Principal } from '../auth/middleware.js';

/**
 * Discovery is public-scoped, so unlike RegistrySourceContext it needs no
 * userId and no handle — only a principal, and only to keep the read ACL
 * honest for a caller who happens to be able to see more than the public.
 * Null is the anonymous case and is entirely valid here.
 */
export interface DiscoveryContext {
  principal: Principal | null;
}

const stripPrefix = (h: string): string =>
  h.startsWith('sha256:') ? h.slice('sha256:'.length) : h;
const withPrefix = (h: string): string => (h.startsWith('sha256:') ? h : `sha256:${h}`);

/** Cap on fallback results: this list goes into a model's context, not a page. */
const SEARCH_LIMIT = 8;

/** `@owner/slug` and `owner/slug` both parse; anything else is not a ref. */
function parseRef(ref: string): { owner: string; slug: string } | null {
  const m = /^@?([^/@\s]+)\/([^/\s]+)$/.exec(ref.trim());
  return m ? { owner: m[1]!, slug: m[2]! } : null;
}

export function createRegistryDiscoveryPrisma(
  prisma: PrismaDb,
  blobStore: BlobStore,
  ctx: DiscoveryContext,
): DiscoverySource {
  return {
    async summon(handle: string): Promise<SummonResult> {
      // Unknown handle and "exists but publishes nothing" are different answers
      // and the client acts on them differently, so check the author exists
      // rather than inferring absence from an empty candidate list.
      const author = await prisma.authors.findUnique({
        where: { id: handle },
        select: { id: true },
      });
      if (!author) return { kind: 'unknown-handle', handle };

      const rows = await getHandleKitCandidatesPrisma(prisma, handle);
      const candidates: SummonCandidate[] = rows
        .filter((r) => r.latest_hash != null)
        .map((r) => ({
          ref: r.ref,
          description: r.description,
          hash: r.latest_hash!,
          via: r.via,
        }));
      return { kind: 'ok', handle, candidates };
    },

    async searchPublic(keywords: string): Promise<SummonCandidate[]> {
      // Attributes the query to the router's cross-author fallback, the same
      // marker the HTTP header carries. The tally is capped and content-free;
      // the words themselves are never stored.
      // Swallows its own failures; a tally must never fail a search.
      await recordSearchSourcePrisma(prisma, 'summon-fallback');

      const items = (await searchSkillsPrisma(
        prisma,
        keywords,
        ctx.principal,
        SEARCH_LIMIT,
      )) as { author?: unknown; slug?: unknown; description?: unknown; skill_id?: unknown }[];

      // Search returns no hash, and a candidate without one cannot be loaded at
      // a pinned version. Resolve them in one query rather than per row.
      const ids = items.map((i) => String(i.skill_id)).filter(Boolean);
      const hashRows = ids.length
        ? await prisma.skills.findMany({
            where: { id: { in: ids } },
            select: { id: true, latest_hash: true },
          })
        : [];
      const hashById = new Map(hashRows.map((r) => [r.id, r.latest_hash]));

      const out: SummonCandidate[] = [];
      for (const i of items) {
        const hash = hashById.get(String(i.skill_id));
        if (!hash) continue;
        out.push({
          ref: `@${String(i.author)}/${String(i.slug)}`,
          description: typeof i.description === 'string' ? i.description : null,
          hash,
          via: null,
        });
      }
      return out;
    },

    async authorStanding(handle: string): Promise<AuthorStanding | null> {
      const row = await prisma.authors.findUnique({
        where: { id: handle },
        select: {
          id: true,
          name: true,
          bio: true,
          is_mirror: true,
          mirror_source_url: true,
        },
      });
      if (!row) return null;

      const skills = await prisma.skills.findMany({
        where: { author_id: handle, visibility: 'public' },
        select: { id: true },
      });
      // The SAME number the profile page shows. "N installs" on a profile means
      // distinct public adopters (kit saves + subscriptions), NOT summed
      // install_count — installer identity is private, and countSkillAdopters
      // is the single source of truth. Summing the raw column here would have
      // an agent quote a number the author's own page contradicts.
      const installs = await countSkillAdoptersPrisma(prisma, handle);
      const summonsBySkill = await summonCountsBySkillPrisma(
        prisma,
        skills.map((s) => s.id),
      );
      let summons = 0;
      for (const n of summonsBySkill.values()) summons += n;

      return {
        handle: row.id,
        name: row.name,
        bio: row.bio,
        // Zero is dropped rather than reported. A mirrored profile states its
        // source instead, which is a fact rather than a score.
        ...(installs > 0 ? { installs } : {}),
        ...(summons > 0 ? { summons } : {}),
        ...(row.is_mirror && row.mirror_source_url
          ? { mirrorSource: row.mirror_source_url }
          : {}),
      };
    },

    async readPublicSkill(ref: string, opts?: PublicReadOptions): Promise<PublicSkill | null> {
      const parsed = parseRef(ref);
      if (!parsed) return null;

      const skillRow = await prisma.skills.findFirst({
        where: { author_id: parsed.owner, slug: parsed.slug },
        select: { id: true, description: true, visibility: true, latest_hash: true },
      });
      if (!skillRow) return null;

      // The same gates sync content passes. A quarantined skill is exactly as
      // unavailable here as it is to a device, and a skill the caller cannot
      // read reports not-found rather than leaking that it exists.
      if (await serveBlockForModerationPrisma(prisma, skillRow.id)) return null;
      if (!(await canReadSkillPrisma(prisma, ctx.principal, skillRow.id, skillRow.visibility))) {
        return null;
      }

      const wanted = opts?.hash ?? skillRow.latest_hash;
      if (!wanted) return null;
      if (await serveBlockForScanPrisma(prisma, withPrefix(wanted))) return null;

      const versionRow = await prisma.skill_versions.findFirst({
        where: {
          skill_id: skillRow.id,
          OR: [{ hash: stripPrefix(wanted) }, { hash: withPrefix(wanted) }],
        },
        select: { hash: true, metadata_json: true, major: true, minor: true, patch: true },
      });
      if (!versionRow) return null;

      let name: string | null = null;
      try {
        const meta = JSON.parse(versionRow.metadata_json) as { name?: unknown };
        if (typeof meta.name === 'string' && meta.name.length > 0) name = meta.name;
      } catch {
        /* metadata is display-only; the slug stands in */
      }

      const fileRows = await prisma.skill_version_files.findMany({
        where: {
          skill_id: skillRow.id,
          OR: [
            { version_hash: stripPrefix(versionRow.hash) },
            { version_hash: withPrefix(versionRow.hash) },
          ],
        },
        orderBy: { path: 'asc' },
        select: { path: true, blob_hash: true },
      });
      const md = fileRows.find((f) => f.path === 'SKILL.md');
      let skillMd: string | null = null;
      if (md) {
        const bytes = await blobStore.get(md.blob_hash);
        if (bytes) skillMd = new TextDecoder().decode(bytes);
      }

      // Attribution. `via` present means this read came from a summon, which is
      // the server-side equivalent of the route skill's `?src=summon&via=`; a
      // plain fetch of a public ref counts nothing, exactly as over HTTP.
      // Fire-and-forget: a counter must never fail a read or delay a response.
      if (opts?.via && skillRow.visibility === 'public') {
        void emitSummonEvent({
          prisma,
          skillId: skillRow.id,
          viaHandle: opts.via,
        }).catch(() => {});
      }

      return {
        ref: `@${parsed.owner}/${parsed.slug}`,
        name,
        description: skillRow.description,
        hash: withPrefix(versionRow.hash),
        versionLabel: `${versionRow.major}.${versionRow.minor}.${versionRow.patch}`,
        skillMd,
        resources: fileRows.map((f) => f.path),
      };
    },
  };
}
