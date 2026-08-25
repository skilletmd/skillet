import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { FollowKind } from '../db/index.js';
import { canAccessOrgAuthorPrisma } from '../lib/org-access.js';
import {
  followedCurationsPrisma,
  listFollowedAuthorIdsPrisma,
  listOrgMemberHandlesPrisma,
  profileFollowEventRowsPrisma,
  secondDegreeViaFollowsPrisma,
  skillEventRowsPrisma,
  subscribeEventRowsPrisma,
} from '../lib/feed-events.js';
import { attachActorAvatarsPrisma } from '../lib/notification-events.js';
import { clampInt, MAX_PAGE_OFFSET } from '../lib/pagination.js';
import { requireSession } from '../auth/middleware.js';
import { bumpAttentionForHandlePrisma } from '../lib/attention.js';
import {
  enrichHandlePrisma,
  followSubjectPrisma,
  getFollowerCountPrisma,
  getUserIdByHandlePrisma,
  listFollowersPrisma,
  listFollowingHandlesPrisma,
  listFollowingPrisma,
  subjectExistsPrisma,
  unfollowSubjectPrisma,
} from '../lib/follow-graph.js';
import { listSkillAdoptersPrisma } from '../lib/profile-payload.js';
import { listFollowSuggestionsPrisma } from '../lib/follow-suggestions.js';
import { formatVersionLabel } from '../semver-classify.js';

export interface SkillRow {
  version_hash: string;
  at: number;
  metadata_json: string;
  major: number;
  minor: number;
  patch: number;
  author: string;
  slug: string;
  description: string | null;
  category: string | null;
  installs: number;
  scan_status: string | null;
  actor_followers: number | null;
  first_at: number;
}

export const SKILL_EVENT_SELECT = `
  SELECT sv.hash          AS version_hash,
         sv.published_at   AS at,
         sv.metadata_json  AS metadata_json,
         sv.major          AS major,
         sv.minor          AS minor,
         sv.patch          AS patch,
         s.author_id       AS author,
         s.slug            AS slug,
         s.description     AS description,
         s.category        AS category,
         s.install_count   AS installs,
         svs.status        AS scan_status,
         fc.followers      AS actor_followers,
         (SELECT MIN(sv2.published_at) FROM skill_versions sv2 WHERE sv2.skill_id = s.id) AS first_at
  FROM skill_versions sv
  JOIN skills s ON s.id = sv.skill_id
  LEFT JOIN skill_version_scans svs ON svs.skill_version_id = sv.hash
  LEFT JOIN follow_counts fc ON fc.subject_kind = 'author' AND fc.subject_id = s.author_id
`;

export interface SubscribeEvent {
  kind: 'subscribe';
  actor: string;
  at: number;
  subscribe: {
    target_kind: 'kit' | 'author';
    name: string;
    owner: string;
    /** The owner's avatar, so a card rendered for this event draws the real
     *  identity instead of the default face (the actor's avatar is a different
     *  person — the subscriber, not the owner). */
    owner_avatar_url?: string | null;
    href: string;
    skill_count: number;
    /** Kit-only — enable a rich hover preview (id for actions, blurb, reach). */
    kit_id?: string;
    description?: string | null;
    subscriber_count?: number;
    /** Kit-only — the public members' categories, in member order. The cover is a
     *  function of (seed, categories): without these the card falls back to
     *  seed-fabricated categories and paints different art than the kit page for
     *  the same kit. Public members only, matching skill_count (#461). */
    skill_categories?: (string | null)[];
  };
}

/**
 * "actor subscribed to a kit / author" feed events. Only PUBLIC curated kits and
 * author-kits surface — a subscription to a private kit (members only) must never
 * leak. `actorHandles` scopes the stream: an array filters to those subscribers
 * (following / team / one author's activity), null means everyone (discover).
 */
export function subscribeEventRows(
  _db: DatabaseSync,
  _actorHandles: string[] | null,
  _limit: number,
): never[] {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: subscribeEventRowsPrisma')
}

export function mapSkillRow(r: SkillRow) {
  let version: string | null = null;
  try {
    const meta = JSON.parse(r.metadata_json) as { version?: unknown };
    if (typeof meta.version === 'string') version = meta.version;
  } catch {
    /* ignore */
  }
  return {
    kind: 'skill' as const,
    type: r.at === r.first_at ? 'published' : 'updated',
    actor: r.author,
    actor_followers: r.actor_followers ?? 0,
    at: r.at,
    skill: {
      author: r.author,
      slug: r.slug,
      description: r.description,
      category: r.category ?? null,
      installs: r.installs ?? 0,
      scan: r.scan_status,
      version,
      version_label: formatVersionLabel(r),
      followed_by_you: [] as string[],
      followed_by_you_count: 0,
    },
  };
}

/**
 * Attach each event's actor avatar in one batch query, so the feed and any
 * actor row render a real avatar (e.g. a synced brand's GitHub logo) instead of
 * only the colored initials identicon. Mutates and returns the events.
 */
export function attachActorAvatars<T extends { actor: string }>(
  _db: DatabaseSync,
  _events: T[],
): T[] {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: attachActorAvatarsPrisma')
}

export interface FollowTargetAuthor {
  handle: string;
  name: string;
  avatar_url: string | null;
  public_skills: number;
  followers: number;
  total_installs: number;
  /** Up to 3 category keys they publish in — the same "what they do" row as Browse. */
  categories: string[];
  top_skills: Array<{ slug: string; installs: number }>;
}

/**
 * Enrich each "X followed Y" event with a snapshot of Y (avatar, skill/follower
 * counts, total installs, top skills) so a follow event reads as a discovery
 * card, not a bare line. Two batched queries (authors, then their top skills);
 * mutates the follow events to carry `target_author` and returns them.
 */
export function attachFollowTargets<T extends { kind: string; target?: string }>(
  _db: DatabaseSync,
  _events: T[],
): T[] {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: attachFollowTargets removed')
}

interface FollowBody {
  kind?: FollowKind;
  id?: string;
}

const VALID_KINDS: readonly FollowKind[] = ['author', 'org', 'skill'];

function sessionUserId(req: { principal?: unknown }): string | null {
  const p = req.principal as { class?: string; user_id?: string } | undefined;
  return p && p.class === 'session' ? (p.user_id ?? null) : null;
}


function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerFollowRoutes(
  app: FastifyInstance,
  prismaArg?: PrismaClient,
): void {
  const prisma = requirePrisma(
    prismaArg ??
      (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
  )

  // POST /follows { kind, id } — follow an author or org. Idempotent.
  app.post<{ Body: FollowBody }>(
    '/follows',
    { preHandler: requireSession },
    async (req, reply) => {
      const userId = sessionUserId(req);
      if (!userId) return reply.status(401).send({ error: 'unauthorized' });

      const { kind, id } = req.body ?? {};
      if (!kind || !VALID_KINDS.includes(kind) || kind === 'skill') {
        return reply.status(400).send({ error: "kind must be 'author' or 'org'" });
      }
      if (!id) return reply.status(400).send({ error: 'id is required' });
      
        if (!(await subjectExistsPrisma(prisma, kind, id))) {
          return reply.status(404).send({ error: `${kind} '${id}' not found` });
        }
        const created = await followSubjectPrisma(prisma, userId, kind, id);
        if (created && kind === 'author') {
          const targetUserId = await getUserIdByHandlePrisma(prisma, id);
          if (targetUserId && targetUserId !== userId) {
            const actorRow = await prisma.users.findUnique({
              where: { id: userId },
              select: { handle: true },
            })
            if (actorRow?.handle) {
              // Prisma attention twin advances seq only; social SSE fan-out
              // still waits on the attention snapshot port.
              await bumpAttentionForHandlePrisma(prisma, id)
            }
          }
        }
        return reply.status(201).send({
          following: true,
          followers: await getFollowerCountPrisma(prisma, kind, id),
        });

    },
  );

  // DELETE /follows { kind, id } — unfollow. Idempotent.
  app.delete<{ Body: FollowBody }>(
    '/follows',
    { preHandler: requireSession },
    async (req, reply) => {
      const userId = sessionUserId(req);
      if (!userId) return reply.status(401).send({ error: 'unauthorized' });

      const { kind, id } = req.body ?? {};
      if (!kind || !VALID_KINDS.includes(kind)) {
        return reply.status(400).send({ error: 'invalid kind' });
      }
      if (!id) return reply.status(400).send({ error: 'id is required' });

      
        await unfollowSubjectPrisma(prisma, userId, kind, id);
        return reply.send({
          following: false,
          followers: await getFollowerCountPrisma(prisma, kind, id),
        });

    },
  );

  // GET /me/following — subjects the caller follows.
  app.get('/me/following', { preHandler: requireSession }, async (req, reply) => {
    const userId = sessionUserId(req);
    if (!userId) return reply.status(401).send({ error: 'unauthorized' });
    
      return reply.send({ following: await listFollowingPrisma(prisma, userId) });

  });

  // GET /profiles/:author/followers — public follower list + count.
  app.get<{ Params: { author: string } }>(
    '/profiles/:author/followers',
    async (req, reply) => {
      const { author } = req.params;
      
        const followers = await listFollowersPrisma(prisma, 'author', author);
        const handles = followers
          .map((f) => f.handle)
          .filter((h): h is string => !!h)
        return reply.send({
          followers: await Promise.all(handles.map((h) => enrichHandlePrisma(prisma, h))),
          count: await getFollowerCountPrisma(prisma, 'author', author),
        });

    },
  );

  // GET /profiles/:author/following — who this author follows.
  app.get<{ Params: { author: string } }>(
    '/profiles/:author/following',
    async (req, reply) => {
      const { author } = req.params;
      
        const uid = await getUserIdByHandlePrisma(prisma, author);
        if (!uid) return reply.send({ following: [], count: 0 });
        const handles = await listFollowingHandlesPrisma(prisma, uid);
        return reply.send({
          following: await Promise.all(handles.map((h) => enrichHandlePrisma(prisma, h))),
          count: handles.length,
        });

    },
  );

  // GET /profiles/:author/adopters — identifiable people who have adopted this
  // author's work: installed a public skill while signed in, saved one into a
  // kit, or subscribed to one of the author's public kits. Anonymous CLI
  // installs carry no identity and are omitted, so `count` (distinct people) can
  // be fewer than the profile's install total.
  app.get<{ Params: { author: string } }>(
    '/profiles/:author/adopters',
    async (req, reply) => {
      const { author } = req.params;
      const adopters = await listSkillAdoptersPrisma(prisma, author);
      return reply.send({
        adopters: adopters.map((a) => ({
          handle: a.handle,
          name: a.name ?? a.handle,
          avatar_url: a.avatar_url ?? null,
          bio: a.bio ?? null,
        })),
        count: adopters.length,
      });
    },
  );

  // GET /me/suggestions — the "who to follow" rail. Primary signal is
  // second-degree: people followed by people the caller follows, that the caller
  // doesn't follow yet — ranked by how many of their follows already follow the
  // candidate (social proof), then recency of those follows. Falls back to
  // popular publishers (public-skill count, then followers) to top up to `limit`
  // when the caller's network is too small to fill the rail.
  app.get<{ Querystring: { limit?: string } }>(
    '/me/suggestions',
    { preHandler: requireSession },
    async (req, reply) => {
      const userId = sessionUserId(req);
      if (!userId) return reply.status(401).send({ error: 'unauthorized' });
      const p = req.principal as { handle?: string | null } | undefined;
      const selfHandle = p?.handle ?? '';
      const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);

        const suggestions = await listFollowSuggestionsPrisma(
          prisma,
          userId,
          selfHandle,
          limit,
        );
        return reply.send({
          suggestions: suggestions.map((s) => ({
            handle: s.handle,
            name: s.name,
            avatar_url: s.avatar_url,
            skills: s.skills,
            followers: s.followers,
          })),
        });

    },
  );

  // GET /me/feed?view=following|discover|team[&team=slug] — a dated activity
  // stream. Events are skill publishes/updates AND follow actions. `following`
  // (default) scopes to people you follow; `discover` is global; `team` scopes
  // to your org: teammates' public skills + the org's own skills.
  app.get<{ Querystring: { limit?: string; view?: string; team?: string; offset?: string } }>(
    '/me/feed',
    { preHandler: requireSession },
    async (req, reply) => {
      const userId = sessionUserId(req);
      if (!userId) return reply.status(401).send({ error: 'unauthorized' });

      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      // Offset pagination for infinite scroll. Offset (not a timestamp cursor) so
      // that bursts of events sharing one second can't be skipped across a page
      // boundary. Each event stream over-fetches `offset + limit`, then the merged
      // stream is sorted and the page sliced out.
      // Clamp the offset: it drives `fetchCount = offset + limit`, used directly
      // as the SQL LIMIT, so an unbounded offset materializes a huge result set.
      const offset = clampInt(req.query.offset, 0, 0, MAX_PAGE_OFFSET);
      const fetchCount = offset + limit;
      const teamSlug =
        req.query.view === 'team' && typeof req.query.team === 'string' ? req.query.team : null;
      const view = req.query.view === 'discover' ? 'discover' : teamSlug ? 'team' : 'following';

      
        const followed = await listFollowedAuthorIdsPrisma(prisma, userId);
        let actorHandles: string[] = [];
        if (view === 'team') {
          if (!teamSlug || !(await canAccessOrgAuthorPrisma(prisma, teamSlug, userId))) {
            return reply.status(403).send({ error: 'not a member of this team' });
          }
          actorHandles = await listOrgMemberHandlesPrisma(prisma, teamSlug);
        } else if (view === 'following') {
          actorHandles = followed;
          if (actorHandles.length === 0) {
            return reply.send({ events: [], following_count: 0, view });
          }
        }

        let skillRows: SkillRow[];
        if (view === 'discover') {
          skillRows = await skillEventRowsPrisma(
            prisma,
            { kind: 'discover' },
            fetchCount,
          );
        } else if (view === 'team' && teamSlug) {
          skillRows = await skillEventRowsPrisma(
            prisma,
            { kind: 'team', memberHandles: actorHandles, orgHandle: teamSlug },
            fetchCount,
          );
        } else {
          skillRows = await skillEventRowsPrisma(
            prisma,
            { kind: 'authors', handles: actorHandles },
            fetchCount,
          );
        }
        const skillEvents = skillRows.map(mapSkillRow);

        const targets = [...new Set(skillEvents.map((e) => e.skill.author))];
        const sd = await secondDegreeViaFollowsPrisma(prisma, userId, targets);
        for (const e of skillEvents) {
          const via = sd.get(e.skill.author) ?? [];
          e.skill.followed_by_you = via.slice(0, 3);
          e.skill.followed_by_you_count = via.length;
        }

        const subscribeScope = view === 'discover' ? null : actorHandles;
        const subscribeEvents = await subscribeEventRowsPrisma(prisma, subscribeScope, fetchCount);

        const merged = [...skillEvents, ...subscribeEvents].sort((a, b) => b.at - a.at);
        const events = merged.slice(offset, fetchCount);
        const nextOffset = merged.length > fetchCount ? fetchCount : null;

        return reply.send({
          events: await attachActorAvatarsPrisma(prisma, events),
          following_count: followed.length,
          view,
          team: teamSlug,
          next_offset: nextOffset,
        });

    },
  );

  // GET /profiles/:author/activity — public timeline for ONE author: their
  // public skill publishes/updates and public follows. No session required;
  // private skills and private follows never appear. Powers the profile's
  // "Recent activity" section.
  app.get<{ Params: { author: string }; Querystring: { limit?: string } }>(
    '/profiles/:author/activity',
    async (req, reply) => {
      const { author } = req.params;
      const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);

      
        const skillRows = await skillEventRowsPrisma(
          prisma,
          { kind: 'single_author', author },
          limit,
        );
        const skillEvents = skillRows.map(mapSkillRow);
        const followEvents = await profileFollowEventRowsPrisma(prisma, author, limit);
        const subscribeEvents = await subscribeEventRowsPrisma(prisma, [author], limit);
        const events = [...skillEvents, ...followEvents, ...subscribeEvents]
          .sort((a, b) => b.at - a.at)
          .slice(0, limit);
        return reply.send({ events });

    },
  );

  // GET /me/followed-curations — for the session viewer, a map of skill_id ->
  // handles of people they follow who curate that skill in a PUBLIC kit. Powers
  // the "used by people you follow" badge on catalog cards in one request
  // (instead of one per card). Public kits only.
  app.get(
    '/me/followed-curations',
    { preHandler: requireSession },
    async (req, reply) => {
      const userId = sessionUserId(req);
      if (!userId) return reply.status(401).send({ error: 'unauthorized' });

      
        const curations = await followedCurationsPrisma(prisma, userId);
        return reply.send({ curations });

    },
  );
}
