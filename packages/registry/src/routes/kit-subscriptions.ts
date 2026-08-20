// Kit + author subscriptions. Session-backed — no Ed25519 signing.
//
// Subscribing means "keep these skills in my sync manifest":
//   - kit: all skills in a public kit (or a private kit we are a member of)
//   - author: all public skills by that author (presented as a virtual kit on web)

import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaClient } from '@prisma/client';
import { ensureSessionPrincipal } from '../auth/middleware.js';
import { getOrgBySlugPrisma } from '../lib/org-access.js';
import { listCallerOrgsPrisma } from '../lib/org-mutations.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { newId } from '../db/index.js';
import { bumpAttentionForHandlePrisma } from '../lib/attention.js';
import { bumpUserDeviceSyncPrisma } from '../lib/device-sync-stream.js';
import {
  baselineAuthorSubscriptionSkillsPrisma,
  baselineKitSubscriptionSkillsPrisma,
  canSubscribeToKitPrisma,
} from '../lib/kit-mutations.js';
import {
  getKitPayloadPrisma,
  getOrCreateSavedKitPrisma,
} from '../lib/kit-payload.js';

type AuthorKitSkill = {
  skill_id: string;
  pinned_hash: null;
  current_hash: string | null;
  added_at: number;
  category: string | null;
};

async function authorSkillsPrisma(
  prisma: PrismaDb,
  authorId: string,
  { includePrivate = false }: { includePrivate?: boolean } = {},
): Promise<AuthorKitSkill[]> {
  const rows = await prisma.skills.findMany({
    where: {
      author_id: authorId,
      latest_hash: { not: null },
      ...(includePrivate ? {} : { visibility: 'public' }),
    },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      latest_hash: true,
      created_at: true,
      category: true,
    },
  });
  return rows.map((r) => ({
    skill_id: r.id,
    pinned_hash: null,
    current_hash: r.latest_hash,
    added_at: r.created_at,
    category: r.category ?? null,
  }));
}

async function authorLastUpdatedPrisma(prisma: PrismaDb, authorId: string): Promise<number | null> {
  const agg = await prisma.skill_versions.aggregate({
    where: {
      skills: { author_id: authorId, visibility: 'public' },
    },
    _max: { published_at: true },
  });
  return agg._max.published_at ?? null;
}


function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerKitSubscriptionRoutes(
  app: FastifyInstance,
  prismaArg?: PrismaClient,
): void {
  const prisma = requirePrisma(
    prismaArg ??
      (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
  )
  // GET /api/v1/kits/mine — owned, member, and subscribed kits
  app.get('/api/v1/kits/mine', async (req, reply) => {
    const p = await ensureSessionPrincipal(req, reply);
    if (!p) return;
    if (!p.handle) {
      return reply.code(403).send({ error: 'handle_required', message: 'Claim a handle before managing kits.' });
    }

    
      // Everyone has a Saved kit (their one-click "+" target). Provision it lazily.
      await getOrCreateSavedKitPrisma(prisma, p.handle);

      const owned = await prisma.kits.findMany({
        where: { owner_id: p.handle },
        orderBy: { created_at: 'asc' },
        select: { id: true, visibility: true },
      });

      // Team kits the caller can manage (org owner/admin) are editable
      // destinations too, so the "add to kit" menu can target them. Scope to
      // admin roles to match the add/remove mutation auth (canManageKitPrisma);
      // plain members would only get 403 on write.
      const adminOrgs = (await listCallerOrgsPrisma(prisma, p.user_id)).filter(
        (o) => o.role === 'owner' || o.role === 'admin',
      );
      const adminOrgSlugs = adminOrgs.map((o) => o.slug);
      // Each team gets its own Saved kit (parity with personal), provisioned
      // lazily the same way. Include every team kit (Saved + custom) so the menu
      // can render a per-team section.
      await Promise.all(adminOrgSlugs.map((slug) => getOrCreateSavedKitPrisma(prisma, slug)));
      const teamOwned =
        adminOrgSlugs.length > 0
          ? await prisma.kits.findMany({
              where: { owner_id: { in: adminOrgSlugs } },
              orderBy: { created_at: 'asc' },
              select: { id: true, visibility: true },
            })
          : [];

      const memberKitIds = await prisma.kit_members.findMany({
        where: {
          user_id: p.user_id,
          kits: { owner_id: { not: p.handle } },
        },
        select: { kit_id: true },
      });
      const member = (
        await Promise.all(memberKitIds.map((row) => getKitPayloadPrisma(prisma, row.kit_id)))
      ).filter((k): k is NonNullable<typeof k> => k !== null);

      const subscribedKits = await prisma.kit_subscriptions.findMany({
        where: { user_id: p.user_id, kind: 'kit', kit_id: { not: null } },
        select: { kit_id: true },
      });
      const subscribed = (
        await Promise.all(
          subscribedKits
            .filter((row): row is { kit_id: string } => row.kit_id != null)
            .map((row) => getKitPayloadPrisma(prisma, row.kit_id)),
        )
      ).filter((k): k is NonNullable<typeof k> => k !== null);

      const subscribedAuthors = await prisma.kit_subscriptions.findMany({
        where: { user_id: p.user_id, kind: 'author', author_id: { not: null } },
        select: { author_id: true },
      });

      const author_kits = [];
      for (const row of subscribedAuthors) {
        if (!row.author_id) continue;
        const profile = await prisma.authors.findUnique({
          where: { id: row.author_id },
          select: { name: true, avatar_url: true },
        });
        const skills = await authorSkillsPrisma(prisma, row.author_id);
        author_kits.push({
          kind: 'author' as const,
          ref: `@${row.author_id}`,
          owner: row.author_id,
          name: profile?.name ?? row.author_id,
          description: `All public skills by @${row.author_id}. New publishes sync automatically.`,
          visibility: 'public' as const,
          skills,
          avatar_url: profile?.avatar_url ?? null,
          self: false,
          last_updated: await authorLastUpdatedPrisma(prisma, row.author_id),
        });
      }

      const selfProfile = await prisma.authors.findUnique({
        where: { id: p.handle },
        select: { name: true, avatar_url: true },
      });
      const selfSkills = await authorSkillsPrisma(prisma, p.handle, { includePrivate: true });
      author_kits.unshift({
        kind: 'author' as const,
        ref: `@${p.handle}`,
        owner: p.handle,
        name: selfProfile?.name ?? p.handle,
        // This copy is the OWNER's view, and it is built with includePrivate,
        // so it counts unpublished work too. Saying "every skill you've
        // published" therefore overstated it, and hid that subscribers receive
        // only the public ones.
        description:
          selfSkills.length > 0
            ? `Every skill you make, synced to your devices. Subscribers get the public ones.`
            : `Your skills land here. Make your first to fill your kit.`,
        visibility: 'public' as const,
        skills: selfSkills,
        avatar_url: selfProfile?.avatar_url ?? null,
        self: true,
        last_updated: await authorLastUpdatedPrisma(prisma, p.handle),
      });

      const ownedPayloads = await Promise.all(
        [...owned, ...teamOwned].map(async (k) => {
          const payload = await getKitPayloadPrisma(prisma, k.id);
          return payload ? { ...payload, visibility: k.visibility } : null;
        }),
      );

      return reply.send({
        owned: ownedPayloads.filter((k): k is NonNullable<typeof k> => k !== null),
        member,
        subscribed,
        author_kits,
        // Slug -> display name for teams the caller admins, so the client can
        // label each team's section in the "add to kit" menu.
        teams: adminOrgs.map((o) => ({ slug: o.slug, name: o.name })),
      });

  });

  // GET /api/v1/authors/:author/kit — virtual kit for an author profile
  app.get<{ Params: { author: string } }>('/api/v1/authors/:author/kit', async (req, reply) => {
    const { author } = req.params;

    
      const profile = await prisma.authors.findUnique({
        where: { id: author },
        select: { name: true, avatar_url: true },
      });
      if (!profile) return reply.code(404).send({ error: 'author_not_found' });

      const skills = await authorSkillsPrisma(prisma, author);
      let subscribed = false;
      if (req.principal?.class === 'session') {
        const row = await prisma.kit_subscriptions.findFirst({
          where: {
            user_id: req.principal.user_id,
            kind: 'author',
            author_id: author,
          },
          select: { id: true },
        });
        subscribed = !!row;
      }

      const subscriberCount = await prisma.kit_subscriptions.count({
        where: { kind: 'author', author_id: author },
      });
      const lastUpdated = await authorLastUpdatedPrisma(prisma, author);
      const org = await getOrgBySlugPrisma(prisma, author);

      return reply.send({
        kind: 'author',
        ref: `@${author}`,
        owner: author,
        name: profile.name,
        description: `Subscribe to keep every public skill by @${author} synced — past and future publishes.`,
        visibility: 'public',
        skills,
        avatar_url: profile.avatar_url,
        is_team: org != null,
        subscribed,
        subscriber_count: subscriberCount,
        last_updated: lastUpdated,
      });

  });

  // GET /api/v1/subscriptions — flat list for UI badges
  app.get('/api/v1/subscriptions', async (req, reply) => {
    const p = await ensureSessionPrincipal(req, reply);
    if (!p) return;

    
      const rows = await prisma.kit_subscriptions.findMany({
        where: { user_id: p.user_id },
        orderBy: { created_at: 'asc' },
        select: { kind: true, kit_id: true, author_id: true, created_at: true },
      });
      return reply.send({
        subscriptions: rows.map((r) => ({
          kind: r.kind,
          kit_id: r.kit_id,
          author_id: r.author_id,
          ref: r.kind === 'author' && r.author_id ? `@${r.author_id}` : null,
          created_at: r.created_at,
        })),
      });

  });

  // POST /api/v1/kits/:kitId/subscribe
  app.post<{ Params: { kitId: string } }>('/api/v1/kits/:kitId/subscribe', async (req, reply) => {
    const p = await ensureSessionPrincipal(req, reply);
    if (!p) return;

    
      const kit = await prisma.kits.findUnique({
        where: { id: req.params.kitId },
        select: { id: true, owner_id: true, name: true, visibility: true },
      });
      if (!kit) return reply.code(404).send({ error: 'kit_not_found' });
      if (kit.owner_id === p.handle) {
        return reply.code(409).send({ error: 'own_kit', message: 'You already own this kit.' });
      }
      if (!(await canSubscribeToKitPrisma(prisma, kit, p.user_id))) {
        return reply.code(403).send({ error: 'not_subscribable', message: 'Kit is private.' });
      }
      const existing = await prisma.kit_subscriptions.findFirst({
        where: { user_id: p.user_id, kind: 'kit', kit_id: kit.id },
        select: { id: true },
      });
      if (!existing) {
        await prisma.kit_subscriptions.create({
          data: {
            id: newId(),
            user_id: p.user_id,
            kind: 'kit',
            kit_id: kit.id,
          },
        });
        const actor = await prisma.users.findUnique({
          where: { id: p.user_id },
          select: { handle: true },
        });
        if (actor?.handle) {
          await bumpAttentionForHandlePrisma(prisma, kit.owner_id);
        }
        await baselineKitSubscriptionSkillsPrisma(prisma, p.user_id, kit.id);
        await bumpUserDeviceSyncPrisma(prisma, p.user_id);
      } else {
        await baselineKitSubscriptionSkillsPrisma(prisma, p.user_id, kit.id);
      }
      return reply.code(201).send({ subscribed: true, kit_id: kit.id });

  });

  // DELETE /api/v1/kits/:kitId/subscribe
  app.delete<{ Params: { kitId: string } }>('/api/v1/kits/:kitId/subscribe', async (req, reply) => {
    const p = await ensureSessionPrincipal(req, reply);
    if (!p) return;

    
      const result = await prisma.kit_subscriptions.deleteMany({
        where: { user_id: p.user_id, kind: 'kit', kit_id: req.params.kitId },
      });
      if (result.count === 0) {
        return reply.code(404).send({ error: 'not_subscribed' });
      }
      await bumpUserDeviceSyncPrisma(prisma, p.user_id);
      return reply.send({ subscribed: false });

  });

  // PATCH /api/v1/kits/:kitId/subscribe — set this subscriber's update-trust
  // preference for the kit ('auto' = apply updates silently, 'gate' = review
  // each, null = clear and fall back to the client's local default).
  app.patch<{ Params: { kitId: string }; Body: { trust_mode?: unknown } }>(
    '/api/v1/kits/:kitId/subscribe',
    async (req, reply) => {
      const p = await ensureSessionPrincipal(req, reply);
      if (!p) return;
      const raw = (req.body ?? {}).trust_mode;
      if (raw !== 'auto' && raw !== 'gate' && raw !== null) {
        return reply
          .code(400)
          .send({ error: 'invalid_trust_mode', message: "trust_mode must be 'auto', 'gate', or null." });
      }

      
        const result = await prisma.kit_subscriptions.updateMany({
          where: { user_id: p.user_id, kind: 'kit', kit_id: req.params.kitId },
          data: { trust_mode: raw },
        });
        if (result.count === 0) {
          return reply.code(404).send({ error: 'not_subscribed' });
        }
        return reply.send({ kit_id: req.params.kitId, trust_mode: raw });

    },
  );

  // POST /api/v1/authors/:author/subscribe
  app.post<{ Params: { author: string } }>('/api/v1/authors/:author/subscribe', async (req, reply) => {
    const p = await ensureSessionPrincipal(req, reply);
    if (!p) return;
    const { author } = req.params;

    
      const authorRow = await prisma.authors.findUnique({
        where: { id: author },
        select: { id: true },
      });
      if (!authorRow) return reply.code(404).send({ error: 'author_not_found' });
      if (p.handle === author) {
        return reply.code(409).send({ error: 'own_author', message: 'Cannot subscribe to yourself.' });
      }
      const existing = await prisma.kit_subscriptions.findFirst({
        where: { user_id: p.user_id, kind: 'author', author_id: author },
        select: { id: true },
      });
      if (!existing) {
        await prisma.kit_subscriptions.create({
          data: {
            id: newId(),
            user_id: p.user_id,
            kind: 'author',
            author_id: author,
          },
        });
        if (p.handle) {
          await bumpAttentionForHandlePrisma(prisma, author, {
            kind: 'social',
            social: {
              kind: 'subscribed_author',
              actor: p.handle,
              at: Math.floor(Date.now() / 1000),
            },
          });
        }
        await bumpUserDeviceSyncPrisma(prisma, p.user_id);
      }
      await baselineAuthorSubscriptionSkillsPrisma(prisma, p.user_id, author);
      return reply.code(201).send({ subscribed: true, author });

  });

  // DELETE /api/v1/authors/:author/subscribe
  app.delete<{ Params: { author: string } }>('/api/v1/authors/:author/subscribe', async (req, reply) => {
    const p = await ensureSessionPrincipal(req, reply);
    if (!p) return;

    
      const result = await prisma.kit_subscriptions.deleteMany({
        where: {
          user_id: p.user_id,
          kind: 'author',
          author_id: req.params.author,
        },
      });
      if (result.count === 0) {
        return reply.code(404).send({ error: 'not_subscribed' });
      }
      await bumpUserDeviceSyncPrisma(prisma, p.user_id);
      return reply.send({ subscribed: false });

  });
}

/** Rows for sync manifest from kit + author subscriptions. */
export type SubscriptionSkillRow = {
  skill_id: string
  author_id: string
  slug: string
  category: string | null
  latest_hash: string | null
  pinned_hash: string | null
  kit_id: string
  kit_owner: string
  kit_name: string
  trust_mode: 'auto' | 'gate' | null
}

/** Fail-closed stand-in for residual dual-path callers outside U4 (approvals/sync). */
export function subscriptionSkillRows(
  _db: DatabaseSync,
  _userId: string,
): SubscriptionSkillRow[] {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: subscriptionSkillRowsPrisma')
}
