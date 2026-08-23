// Platform-admin routes. Gated by requireAdmin (is_admin flag or
// SKILLET_ADMIN_HANDLES). All paths hardcode `/api/v1/...` like the other
// account routes.
//
//   POST /api/v1/admin/mirrors/:handle/grant — hand a seeded mirror handle to
//        its real brand owner: promote the mirror author into an org owned by
//        the named user and freeze the auto-sync.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import { requireAdmin } from '../auth/middleware.js';
import { lastCleanHashPrisma } from '../lib/sync-manifest.js';
import { BrandGrantError, grantBrandOrgPrisma } from '../lib/brand-grant.js'
import { userIdByVerifiedEmailPrisma } from '../auth/identities.js'
import {
  suspendAuthorPrisma,
  unsuspendAuthorPrisma,
  quarantineSkillPrisma,
  unlistSkillPrisma,
  unquarantineSkillPrisma,
  relistSkillPrisma,
  applyModerationActionPrisma,
  hideKitPrisma,
  unhideKitPrisma,
} from '../lib/enforcement.js'
import {
  summonLeaderboardPrisma,
  topSummonedSkillsPrisma,
  searchSourceTotalsPrisma,
} from '../lib/summon-events.js'

const MAX_PUBLIC_REASON_LEN = 500

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}
/** The account-bound user id behind an admin principal (session or device).
 *  `requireAdmin` has already guaranteed one of these before the handler runs. */
function actingUserId(req: FastifyRequest): string | null {
    const p = req.principal;
    if (!p)
        return null;
    return p.class === 'session' || p.class === 'device' ? p.user_id : null;
}
interface GrantParams {
    handle: string;
}
interface GrantBody {
    /** Target account, resolved in priority order: user_id, then handle, then verified email. */
    user_id?: string;
    handle?: string;
    email?: string;
}
interface MirrorRow {
    name: string;
}
/** Resolve the grant target to a user id, or null if not found / ambiguous input. */
async function resolveTargetUserPrisma(prisma: PrismaClient, body: GrantBody): Promise<string | null> {
    if (typeof body.user_id === 'string' && body.user_id) {
        const row = await prisma.users.findUnique({
            where: { id: body.user_id },
            select: { id: true },
        });
        return row?.id ?? null;
    }
    if (typeof body.handle === 'string' && body.handle) {
        const row = await prisma.users.findFirst({
            where: { handle: body.handle.replace(/^@/, '') },
            select: { id: true },
        });
        return row?.id ?? null;
    }
    if (typeof body.email === 'string' && body.email) {
        return userIdByVerifiedEmailPrisma(prisma, body.email);
    }
    return null;
}
export function registerAdminRoutes(
  app: FastifyInstance,
  _db: DatabaseSync,
  prismaArg?: PrismaClient,
): void {
    const prisma = requirePrisma(
      prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
    )
    app.post<{
        Params: GrantParams;
        Body: GrantBody;
    }>('/api/v1/admin/mirrors/:handle/grant', { preHandler: requireAdmin() }, async (req, reply) => {
        const handle = req.params.handle.toLowerCase();
        const body = req.body ?? {};
        // Author-existence check stays in the route (returns author_not_found and
        // supplies the mirror's display name); the shared service owns the rest of
        // the mirror/org validation and the grant transaction.
        let mirror: MirrorRow | null = null;
        const row = await prisma.authors.findUnique({
            where: { id: handle },
            select: { name: true },
        });
        mirror = row ? { name: row.name } : null;
        if (!mirror) {
            return reply.code(404).send({ error: 'author_not_found' });
        }
        if (!body.user_id && !body.handle && !body.email) {
            return reply.code(400).send({ error: 'target_required' });
        }
        const ownerUserId = await resolveTargetUserPrisma(prisma, body);
        if (!ownerUserId) {
            return reply.code(404).send({ error: 'target_user_not_found' });
        }
        try {
            const result = await grantBrandOrgPrisma(prisma, { handle, ownerUserId, name: mirror.name });
            return reply.code(201).send(result);
        }
        catch (err) {
            if (err instanceof BrandGrantError) {
                // All four codes mapped to 409, matching the original handler.
                return reply.code(409).send({ error: err.code });
            }
            throw err;
        }
    });
    // GET /admin/reports — the moderation queue, grouped per skill so an admin
    // triages a skill rather than duplicate individual reports.
    app.get('/api/v1/admin/reports', { preHandler: requireAdmin() }, async (_req, reply) => {
        const openReports = await prisma.skill_reports.findMany({
            where: { status: 'open' },
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                skill_id: true,
                category: true,
                reason: true,
                claims_ownership: true,
                version_hash: true,
                created_at: true,
                skills: {
                    select: {
                        author_id: true,
                        slug: true,
                        moderation_status: true,
                    },
                },
            },
        });
        const bySkill = new Map<string, {
            skill_id: string;
            author: string;
            slug: string;
            moderation_status: string;
            latest_at: number;
            categories: Set<string>;
            reports: Array<{
                id: string;
                category: string;
                reason: string | null;
                claims_ownership: number | null;
                version_hash: string | null;
                created_at: number;
            }>;
        }>();
        for (const r of openReports) {
            let group = bySkill.get(r.skill_id);
            if (!group) {
                group = {
                    skill_id: r.skill_id,
                    author: r.skills.author_id,
                    slug: r.skills.slug,
                    moderation_status: r.skills.moderation_status,
                    latest_at: r.created_at,
                    categories: new Set<string>(),
                    reports: [],
                };
                bySkill.set(r.skill_id, group);
            }
            group.categories.add(r.category);
            if (r.created_at > group.latest_at)
                group.latest_at = r.created_at;
            group.reports.push({
                id: r.id,
                category: r.category,
                reason: r.reason,
                claims_ownership: r.claims_ownership,
                version_hash: r.version_hash,
                created_at: r.created_at,
            });
        }
        const result = [...bySkill.values()]
            .sort((a, b) => b.latest_at - a.latest_at)
            .map((g) => ({
            skill_id: g.skill_id,
            author: g.author,
            slug: g.slug,
            moderation_status: g.moderation_status,
            report_count: g.reports.length,
            latest_at: g.latest_at,
            categories: [...g.categories],
            reports: g.reports,
        }));
        return reply.send({ groups: result });
    });
    // POST /admin/reports/:id/resolve — dismiss (no enforcement, no public trace)
    // or enforce (quarantine / unlist). Enforcing resolves every open report on
    // the same skill in one sweep.
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            disposition?: string;
            public_reason?: string;
        };
    }>('/api/v1/admin/reports/:id/resolve', { preHandler: requireAdmin() }, async (req, reply) => {
        const adminId = actingUserId(req);
        if (!adminId)
            return reply.code(403).send({ error: 'admin_required' });
        const report = await prisma.skill_reports.findUnique({
            where: { id: req.params.id },
            select: { id: true, skill_id: true, status: true },
        });
        if (!report)
            return reply.code(404).send({ error: 'report_not_found' });
        const body = req.body ?? {};
        const disposition = body.disposition;
        if (disposition !== 'dismiss' && disposition !== 'quarantine' && disposition !== 'unlist') {
            return reply.code(400).send({ error: 'invalid_disposition' });
        }
        const publicReason = typeof body.public_reason === 'string' ? body.public_reason.trim() : '';
        if (publicReason.length > MAX_PUBLIC_REASON_LEN) {
            return reply.code(400).send({ error: 'public_reason_too_long' });
        }
        const now = Math.floor(Date.now() / 1000);
        if (disposition === 'dismiss') {
            await prisma.skill_reports.update({
                where: { id: report.id },
                data: { status: 'dismissed', resolved_at: now },
            });
            return reply.send({ disposition, report_id: report.id });
        }
        const enforce = disposition === 'quarantine' ? quarantineSkillPrisma : unlistSkillPrisma;
        const action = await enforce(prisma, report.skill_id, adminId, publicReason || null);
        if (!action)
            return reply.code(404).send({ error: 'skill_not_found' });
        const resolved = await prisma.skill_reports.updateMany({
            where: { skill_id: report.skill_id, status: 'open' },
            data: { status: 'resolved', resolved_at: now },
        });
        return reply.send({
            disposition,
            skill_id: report.skill_id,
            moderation_status: action.status,
            resolved_reports: resolved.count,
        });
    });
    // POST /admin/skills/:id/reverse — undo enforcement (unquarantine / relist).
    // The status flip drops the skill off the public log automatically.
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            action?: string;
            public_reason?: string;
        };
    }>('/api/v1/admin/skills/:id/reverse', { preHandler: requireAdmin() }, async (req, reply) => {
        const adminId = actingUserId(req);
        if (!adminId)
            return reply.code(403).send({ error: 'admin_required' });
        const body = req.body ?? {};
        const action = body.action;
        if (action !== 'unquarantine' && action !== 'relist') {
            return reply.code(400).send({ error: 'invalid_action' });
        }
        const publicReason = typeof body.public_reason === 'string' ? body.public_reason.trim() : '';
        if (publicReason.length > MAX_PUBLIC_REASON_LEN) {
            return reply.code(400).send({ error: 'public_reason_too_long' });
        }
        const reverse = action === 'unquarantine' ? unquarantineSkillPrisma : relistSkillPrisma;
        const result = await reverse(prisma, req.params.id, adminId, publicReason || null);
        if (!result)
            return reply.code(404).send({ error: 'skill_not_found' });
        return reply.send({ action, skill_id: req.params.id, moderation_status: result.status });
    });
    // GET /admin/moderation/recent — the enforcement ledger as a feed, newest
    // first, so an admin can see what they just did (and undo it) without leaving
    // the report queue. `moderation_status` is the skill's *current* state, which
    // is how the UI knows whether an action is still active (undoable) or already
    // reversed. Dismissals are not enforcement, so they never appear here.
    app.get('/api/v1/admin/moderation/recent', { preHandler: requireAdmin() }, async (_req, reply) => {
        const rows = await prisma.skill_moderation_actions.findMany({
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: 30,
            select: {
                id: true,
                skill_id: true,
                action: true,
                public_reason: true,
                created_at: true,
                skills: { select: { author_id: true, slug: true, moderation_status: true } },
                users: { select: { handle: true } },
            },
        });
        return reply.send({
            actions: rows.map((a) => ({
                id: a.id,
                skill_id: a.skill_id,
                author: a.skills.author_id,
                slug: a.skills.slug,
                action: a.action,
                public_reason: a.public_reason,
                acted_by_handle: a.users.handle,
                moderation_status: a.skills.moderation_status,
                created_at: a.created_at,
            })),
        });
    });
    // POST /admin/reports/:id/reopen — bring a dismissed report back to the queue.
    app.post<{
        Params: {
            id: string;
        };
    }>('/api/v1/admin/reports/:id/reopen', { preHandler: requireAdmin() }, async (req, reply) => {
        const report = await prisma.skill_reports.findUnique({
            where: { id: req.params.id },
            select: { id: true, status: true },
        });
        if (!report)
            return reply.code(404).send({ error: 'report_not_found' });
        if (report.status !== 'dismissed') {
            return reply.code(409).send({ error: 'not_dismissed', status: report.status });
        }
        await prisma.skill_reports.update({
            where: { id: report.id },
            data: { status: 'open', resolved_at: null },
        });
        return reply.send({ report_id: report.id, status: 'open' });
    });
    // GET /api/v1/admin/activity — one operational feed merging the most recent
    // account signups and skill creations, newest first. Each event carries the
    // actor's display name + avatar (from the authors row keyed by handle).
    // Private skills are attributed to their author (name + avatar) for abuse
    // monitoring, but the skill's own identity (slug) is stripped here on the
    // server so a non-public skill's contents never leak.
    // Launch-week read surface over the summon metrics. `?days=N` windows every
    // section (omit for all-time). The three tables underneath were write-only;
    // this is the only place they can be read together.
    app.get<{ Querystring: { days?: string; limit?: string } }>(
      '/api/v1/admin/summons',
      { preHandler: requireAdmin() },
      async (req, reply) => {
        const parse = (raw: string | undefined, max: number): number | undefined => {
          if (raw == null) return undefined
          const n = Number.parseInt(raw, 10)
          return Number.isFinite(n) && n > 0 ? Math.min(n, max) : undefined
        }
        const days = parse(req.query.days, 365)
        const limit = parse(req.query.limit, 500) ?? 50
        const [handles, skills, sources] = await Promise.all([
          summonLeaderboardPrisma(prisma, { days, limit }),
          topSummonedSkillsPrisma(prisma, { days, limit }),
          searchSourceTotalsPrisma(prisma, { days }),
        ])
        return reply.send({
          window_days: days ?? null,
          total_summons: handles.reduce((n, h) => n + h.summons, 0),
          // Ranked reach per handle: the claim-campaign outreach order.
          handles,
          // Which individual skills are actually being run.
          skills,
          // How many fallback searches ran, never what they searched for.
          search_sources: sources,
        })
      },
    );

    app.get('/api/v1/admin/activity', { preHandler: requireAdmin() }, async (_req, reply) => {
        // authors.id = users.handle, so a manual join on handle resolves name + avatar.
        const userRows = await prisma.users.findMany({
            orderBy: { created_at: 'desc' },
            take: 50,
            select: { handle: true, created_at: true },
        });
        const handles = [
            ...new Set(userRows.map((u) => u.handle).filter((h): h is string => h != null)),
        ];
        const authorByHandle = new Map((handles.length === 0
            ? []
            : await prisma.authors.findMany({
                where: { id: { in: handles } },
                select: { id: true, name: true, avatar_url: true },
            })).map((a) => [a.id, a] as const));
        const signups = userRows.map((u) => {
            const author = u.handle ? authorByHandle.get(u.handle) : undefined;
            return {
                handle: u.handle,
                name: author?.name ?? null,
                avatar_url: author?.avatar_url ?? null,
                created_at: u.created_at,
            };
        });
        const skillRowsRaw = await prisma.skills.findMany({
            orderBy: { created_at: 'desc' },
            take: 50,
            select: {
                author_id: true,
                slug: true,
                visibility: true,
                created_at: true,
            },
        });
        const authorIds = [...new Set(skillRowsRaw.map((s) => s.author_id))];
        const skillAuthorById = new Map((authorIds.length === 0
            ? []
            : await prisma.authors.findMany({
                where: { id: { in: authorIds } },
                select: { id: true, name: true, avatar_url: true },
            })).map((a) => [a.id, a] as const));
        const skillRows = skillRowsRaw.map((s) => {
            const author = skillAuthorById.get(s.author_id);
            return {
                author: s.author_id,
                slug: s.slug,
                visibility: s.visibility,
                name: author?.name ?? null,
                avatar_url: author?.avatar_url ?? null,
                created_at: s.created_at,
            };
        });
        const events = [
            ...signups.map((s) => ({
                type: 'signup' as const,
                created_at: s.created_at,
                handle: s.handle,
                name: s.name,
                avatar_url: s.avatar_url,
            })),
            ...skillRows.map((s) => s.visibility === 'public'
                ? {
                    type: 'skill' as const,
                    created_at: s.created_at,
                    visibility: 'public' as const,
                    author: s.author,
                    slug: s.slug,
                    name: s.name,
                    avatar_url: s.avatar_url,
                }
                : {
                    type: 'skill' as const,
                    created_at: s.created_at,
                    visibility: 'private' as const,
                    author: s.author,
                    slug: null,
                    name: s.name,
                    avatar_url: s.avatar_url,
                }),
        ]
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, 100);
        return reply.send({ events });
    });
    // --- Direct hide + feature controls ---------------------------------------
    //
    // The report-resolve flow (above) is one way to unlist a skill; these are the
    // direct admin triggers for hiding a skill / kit / whole user and for
    // featuring skills / kits. All behind requireAdmin().
    // POST /admin/skills/:id/moderate — hide (unlist) or unhide (relist) a skill.
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            action?: string;
        };
    }>('/api/v1/admin/skills/:id/moderate', { preHandler: requireAdmin() }, async (req, reply) => {
        const adminId = actingUserId(req);
        if (!adminId)
            return reply.code(403).send({ error: 'admin_required' });
        const action = req.body?.action;
        if (action !== 'unlist' && action !== 'relist') {
            return reply.code(400).send({ error: 'invalid_action' });
        }
        const result = await applyModerationActionPrisma(prisma, {
            skillId: req.params.id,
            action,
            actedBy: adminId,
        });
        if (!result)
            return reply.code(404).send({ error: 'skill_not_found' });
        return reply.send({ skill_id: req.params.id, moderation_status: result.status });
    });
    // POST /admin/kits/:id/moderate — hide or unhide a kit.
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            action?: string;
        };
    }>('/api/v1/admin/kits/:id/moderate', { preHandler: requireAdmin() }, async (req, reply) => {
        const adminId = actingUserId(req);
        if (!adminId)
            return reply.code(403).send({ error: 'admin_required' });
        const action = req.body?.action;
        if (action !== 'hide' && action !== 'unhide') {
            return reply.code(400).send({ error: 'invalid_action' });
        }
        const ok = action === 'hide'
            ? await hideKitPrisma(prisma, req.params.id, adminId)
            : await unhideKitPrisma(prisma, req.params.id, adminId);
        if (!ok)
            return reply.code(404).send({ error: 'kit_not_found' });
        return reply.send({
            kit_id: req.params.id,
            moderation_status: action === 'hide' ? 'hidden' : 'none',
        });
    });
    // POST /admin/users/:handle/suspend — suspend (bulk-hide) or unsuspend a user.
    app.post<{
        Params: {
            handle: string;
        };
        Body: {
            suspend?: boolean;
        };
    }>('/api/v1/admin/users/:handle/suspend', { preHandler: requireAdmin() }, async (req, reply) => {
        const adminId = actingUserId(req);
        if (!adminId)
            return reply.code(403).send({ error: 'admin_required' });
        const handle = req.params.handle.replace(/^@/, '');
        const suspend = req.body?.suspend === true;
        const ok = suspend
            ? await suspendAuthorPrisma(prisma, handle, adminId)
            : await unsuspendAuthorPrisma(prisma, handle, adminId);
        if (!ok)
            return reply.code(404).send({ error: 'user_not_found' });
        return reply.send({ handle, suspended: suspend });
    });
    // POST /admin/skills/:id/feature — set/clear the skill's featured flag.
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            featured?: boolean;
        };
    }>('/api/v1/admin/skills/:id/feature', { preHandler: requireAdmin() }, async (req, reply) => {
        const featured = req.body?.featured === true;
        const skill = await prisma.skills.findUnique({
            where: { id: req.params.id },
            select: { id: true },
        });
        if (!skill)
            return reply.code(404).send({ error: 'skill_not_found' });
        await prisma.skills.update({
            where: { id: req.params.id },
            data: { is_featured: featured ? 1 : 0 },
        });
        return reply.send({ skill_id: req.params.id, featured });
    });
    // POST /admin/kits/:id/feature — set/clear the kit's featured flag.
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            featured?: boolean;
        };
    }>('/api/v1/admin/kits/:id/feature', { preHandler: requireAdmin() }, async (req, reply) => {
        const featured = req.body?.featured === true;
        const kit = await prisma.kits.findUnique({
            where: { id: req.params.id },
            select: { id: true },
        });
        if (!kit)
            return reply.code(404).send({ error: 'kit_not_found' });
        await prisma.kits.update({
            where: { id: req.params.id },
            data: { is_featured: featured ? 1 : 0 },
        });
        return reply.send({ kit_id: req.params.id, featured });
    });
    // GET /admin/moderation — current hidden/unlisted skills, hidden kits, and
    // suspended users, for the admin moderation list.
    app.get('/api/v1/admin/moderation', { preHandler: requireAdmin() }, async (_req, reply) => {
        const skills = await prisma.skills.findMany({
            where: { moderation_status: { not: 'none' } },
            orderBy: [{ author_id: 'asc' }, { slug: 'asc' }],
            select: {
                id: true,
                author_id: true,
                slug: true,
                moderation_status: true,
            },
        });
        const kits = await prisma.kits.findMany({
            where: { moderation_status: 'hidden' },
            orderBy: [{ owner_id: 'asc' }, { slug: 'asc' }],
            select: { id: true, owner_id: true, slug: true, name: true },
        });
        const suspended = await prisma.users.findMany({
            where: { suspended_at: { not: null } },
            orderBy: { suspended_at: 'desc' },
            select: { handle: true, suspended_at: true },
        });
        return reply.send({
            skills: skills.map((s) => ({
                id: s.id,
                author: s.author_id,
                slug: s.slug,
                moderation_status: s.moderation_status,
            })),
            kits: kits.map((k) => ({
                id: k.id,
                owner: k.owner_id,
                slug: k.slug,
                name: k.name,
            })),
            suspended: suspended
                .filter((u): u is {
                handle: string;
                suspended_at: number;
            } => u.handle != null)
                .map((u) => ({ handle: u.handle, suspended_at: u.suspended_at! })),
        });
    });
    // GET /admin/featured — current featured skills + kits.
    app.get('/api/v1/admin/featured', { preHandler: requireAdmin() }, async (_req, reply) => {
        const skills = await prisma.skills.findMany({
            where: { is_featured: 1 },
            orderBy: [{ author_id: 'asc' }, { slug: 'asc' }],
            select: { id: true, author_id: true, slug: true },
        });
        const kits = await prisma.kits.findMany({
            where: { is_featured: 1 },
            orderBy: [{ owner_id: 'asc' }, { slug: 'asc' }],
            select: { id: true, owner_id: true, slug: true, name: true },
        });
        return reply.send({
            skills: skills.map((s) => ({ id: s.id, author: s.author_id, slug: s.slug })),
            kits: kits.map((k) => ({
                id: k.id,
                owner: k.owner_id,
                slug: k.slug,
                name: k.name,
            })),
        });
    });

    /**
     * POST /api/v1/admin/skills/:author/:slug/scan-override
     *
     * Record that an admin reviewed this skill's scanner quarantine and judged it
     * a false positive, so it becomes servable again. The security-tooling case:
     * a guard and a payload contain the same strings for opposite reasons, and no
     * path or filename rule can separate them because an attacker controls those
     * too. A human review is the only signal that is not spoofable.
     *
     * Findings are NOT cleared — they stay on the version and stay visible in the
     * trust panel. This only stops the quarantine from suppressing `latest_hash`.
     * Body: { reason } to set, or { clear: true } to revoke.
     */
    app.post<{
        Params: { author: string; slug: string };
        Body: { reason?: string; clear?: boolean };
    }>('/api/v1/admin/skills/:author/:slug/scan-override', { preHandler: requireAdmin() }, async (req, reply) => {
        const { author, slug } = req.params;
        const skill = await prisma.skills.findFirst({
            where: { author_id: author, slug },
            select: { id: true, scan_override_at: true },
        });
        if (!skill) return reply.code(404).send({ error: 'skill_not_found' });

        const principal = req.principal as { class?: string; user_id?: string } | undefined;
        const adminId = principal?.user_id ?? null;

        if (req.body?.clear) {
            await prisma.skills.update({
                where: { id: skill.id },
                data: { scan_override_at: null, scan_override_by: null, scan_override_reason: null },
            });
            // Recompute: with the override gone the quarantine suppresses the hash again.
            await prisma.skills.update({
                where: { id: skill.id },
                data: { latest_hash: await lastCleanHashPrisma(prisma, skill.id) },
            });
            return reply.send({ author, slug, override: null });
        }

        const reason = (req.body?.reason ?? '').trim();
        // A reason is required: the point of the record is that someone can read
        // back WHY a quarantine was waived, months later, without re-deriving it.
        if (reason.length < 10) {
            return reply.code(400).send({
                error: 'reason_required',
                message: 'Explain why this quarantine is a false positive (10 characters minimum).',
            });
        }
        const at = Math.floor(Date.now() / 1000);
        await prisma.skills.update({
            where: { id: skill.id },
            data: { scan_override_at: at, scan_override_by: adminId, scan_override_reason: reason },
        });
        // Resolve the hash now so the skill is installable without waiting for a sync.
        await prisma.skills.update({
            where: { id: skill.id },
            data: { latest_hash: await lastCleanHashPrisma(prisma, skill.id) },
        });
        req.log.warn({ author, slug, adminId, reason }, 'admin scan-override set: scanner quarantine waived');
        return reply.send({ author, slug, override: { at, by: adminId, reason } });
    });
}
