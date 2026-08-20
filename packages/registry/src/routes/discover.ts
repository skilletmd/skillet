import type { FastifyInstance } from 'fastify';
import { parseCategoryFilter } from '../categories.js';
import { clampInt, MAX_PAGE_OFFSET } from '../lib/pagination.js';
import {
  countDiscoverKitsPrisma,
  countDiscoverPeoplePrisma,
  discoverKitSubscriberFacesPrisma,
  listDiscoverKitsPrisma,
  listDiscoverPeoplePrisma,
  type DiscoverKitSort,
  type DiscoverPeopleSort,
} from '../lib/catalog-discover.js';
import type { PrismaDb } from '../db/prisma-client.js';
import {
  skillEventRowsPrisma,
  subscribeEventRowsPrisma,
} from '../lib/feed-events.js';
import { attachActorAvatarsPrisma } from '../lib/notification-events.js';
import { mapSkillRow } from './follows.js';
import { catalogListMemo, catalogListMemoKey } from '../lib/catalog-list-memo.js';
import { setPublicCatalogListCacheHeaders } from '../lib/catalog-list-cache-headers.js';

// Discover surfaces (the web `/skills` hub): public catalogs for kits and
// people that sit alongside the existing `GET /skills` skill catalog. Both are
// anonymous reads — no principal required — so the hub renders for logged-out
// visitors. Cards are navigational (link to a profile / kit), so we return
// counts for ranking and display but no per-viewer subscribe/follow state.

function requirePrisma(prisma: PrismaDb | undefined): PrismaDb {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
  }
  return prisma;
}

export function registerDiscoverRoutes(
  app: FastifyInstance,
  prisma?: PrismaDb,
): void {
  // GET /v1/discover/kits — public kit catalog, most-subscribed first.
  // Optional `q` matches kit name or description (case-insensitive).
  app.get<{
    Querystring: { limit?: string; offset?: string; q?: string; category?: string; sort?: string };
  }>(
    '/discover/kits',
    async (req, reply) => {
      const db = requirePrisma(prisma);
      const limit = clampInt(req.query.limit, 24, 1, 100);
      const offset = clampInt(req.query.offset, 0, 0, MAX_PAGE_OFFSET);

      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const categories = parseCategoryFilter(req.query.category);
      const sort: DiscoverKitSort | undefined =
        req.query.sort === 'new' || req.query.sort === 'alpha' ? req.query.sort : undefined;

      const memoKey = catalogListMemoKey('discover-kits', {
        limit,
        offset,
        q: q || undefined,
        category: categories?.slice().sort().join(',') || undefined,
        sort,
      });
      const body = await catalogListMemo.getOrLoad(memoKey, async () => {
        const [total, rows] = await Promise.all([
          countDiscoverKitsPrisma(db, { q: q || undefined, categories }),
          listDiscoverKitsPrisma(db, {
            limit,
            offset,
            q: q || undefined,
            categories,
            sort,
          }),
        ]);
        const usedByByKit = await discoverKitSubscriberFacesPrisma(
          db,
          rows.map((r) => r.id),
        );
        return {
          kits: rows.map((r) => {
            const faces = (usedByByKit.get(r.id) ?? []).filter((f) => f.handle !== r.owner_id);
            return {
              id: r.id,
              owner: r.owner_id,
              name: r.name,
              slug: r.slug,
              description: r.description,
              skill_count: r.skill_count,
              subscriber_count: r.subscriber_count,
              category: r.category,
              skill_ids: r.skill_ids,
              skill_categories: r.skill_categories,
              used_by: faces.slice(0, 3),
              used_by_count: faces.length,
              created_at: r.created_at,
            };
          }),
          total,
          limit,
          offset,
        };
      });
      setPublicCatalogListCacheHeaders(reply);
      return reply.status(200).send(body);
    },
  );

  // GET /v1/discover/people — authors worth discovering, most-downloaded first.
  // Limited to authors with at least one public skill OR one follower so the
  // list isn't padded with empty profiles. Optional `q` matches handle or name.
  app.get<{
    Querystring: { limit?: string; offset?: string; q?: string; category?: string; sort?: string };
  }>(
    '/discover/people',
    async (req, reply) => {
      const db = requirePrisma(prisma);
      const limit = clampInt(req.query.limit, 24, 1, 100);
      const offset = clampInt(req.query.offset, 0, 0, MAX_PAGE_OFFSET);

      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const categories = parseCategoryFilter(req.query.category);

      const sort: DiscoverPeopleSort | undefined =
        req.query.sort === 'followers' ||
        req.query.sort === 'new' ||
        req.query.sort === 'alpha'
          ? req.query.sort
          : undefined;
      const memoKey = catalogListMemoKey('discover-people', {
        limit,
        offset,
        q: q || undefined,
        category: categories?.slice().sort().join(',') || undefined,
        sort,
      });
      const body = await catalogListMemo.getOrLoad(memoKey, async () => {
        const [total, rows] = await Promise.all([
          countDiscoverPeoplePrisma(db, { q: q || undefined, categories }),
          listDiscoverPeoplePrisma(db, {
            limit,
            offset,
            q: q || undefined,
            categories,
            sort,
          }),
        ]);
        return {
          people: rows.map((r) => ({
            handle: r.id,
            name: r.name,
            avatar_url: r.avatar_url,
            bio: r.bio,
            followers: r.followers,
            following: r.following,
            public_skills: r.public_skills,
            kits: r.kits,
            total_installs: r.total_installs,
            category: r.category,
            categories: r.categories,
            created_at: r.created_at,
          })),
          total,
          limit,
          offset,
        };
      });
      setPublicCatalogListCacheHeaders(reply);
      return reply.status(200).send(body);
    },
  );

  // GET /discover/feed — the global activity stream (public skill publishes /
  // updates plus public follow actions), anonymous. This is the same data as
  // `GET /me/feed?view=discover` minus the per-viewer enrichment, so logged-out
  // visitors can see Discover. `following_count` is always 0 here.
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/discover/feed',
    async (req, reply) => {
      const db = requirePrisma(prisma);
      const limit = clampInt(req.query.limit, 50, 1, 100);
      // Offset pagination for infinite scroll — robust against bursts of events
      // sharing one second (a timestamp cursor would skip them across a boundary).
      // Clamp the offset: it feeds `offset + limit` as the SQL LIMIT on a public,
      // unauthenticated route.
      const offset = clampInt(req.query.offset, 0, 0, MAX_PAGE_OFFSET);
      const fetchCount = offset + limit;

      const memoKey = catalogListMemoKey('discover-feed', { limit, offset });
      const body = await catalogListMemo.getOrLoad(memoKey, async () => {
        const skillRows = await skillEventRowsPrisma(
          db,
          { kind: 'discover', excludeUnlisted: true },
          fetchCount,
        );
        const skillEvents = skillRows.map(mapSkillRow);
        const subscribeEvents = await subscribeEventRowsPrisma(db, null, fetchCount);
        const merged = [...skillEvents, ...subscribeEvents].sort((a, b) => b.at - a.at);
        const events = merged.slice(offset, fetchCount);
        const nextOffset = merged.length > fetchCount ? fetchCount : null;
        return {
          events: await attachActorAvatarsPrisma(db, events),
          following_count: 0,
          view: 'discover' as const,
          next_offset: nextOffset,
        };
      });
      setPublicCatalogListCacheHeaders(reply);
      return reply.send(body);
    },
  );
}
