// U4 + U5 — account-scoped update decisions.
//
// `update_decisions` is the server-side source of truth for whether a subscriber
// has approved or rejected a specific published version of a skill. Decisions are
// keyed by the version's CANONICAL CONTENT HASH (`skill_versions.hash` =
// canonicalContentHash(bundle)); the server resolves/validates that hash itself,
// so a client never supplies a free-form content hash (no substitution surface).
// `source` is set from the token class, never the request body.
//
// Pending is computed live (subscribed + readable skills whose effective target
// hash has no decision); recently-applied = state='approved' rows. Reads never
// write — auto-stamping is a write-path helper exported for the mode-flip
// and the device sync path, and is never invoked from a GET.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import { toSkillId, type SkillId } from '@skillet/protocol/skill-id';
import { newId } from '../db/index.js';
import { bumpUserAttention } from '../lib/attention.js';
import { requireUser, type Principal } from '../auth/middleware.js';
import { formatVersionLabel } from '../semver-classify.js';
import { editedHeldUpdatesPrisma, type EditedHeldUpdate } from '../lib/edited-held-updates.js';
import { pendingTargetsPrisma, subscribedSkillIdsPrisma } from '../lib/pending-update-targets.js';
import { versionOrdinalPrisma } from '../lib/version-ordinal.js';
import { accountUpdateModePrisma, bumpUserAttentionPrisma, decideAllPendingPrisma, listDecisionsPrisma, priorVersionLabelPrisma, resolveVersionHashPrisma, upsertDecisionPrisma, versionLabelOfPrisma, } from '../lib/update-decisions.js';
import { pendingRemovalsPrisma, decideRemovalPrisma } from '../lib/pending-removals.js';
export type { EditedHeldUpdate };
type DecisionSource = 'web' | 'desktop' | 'cli' | 'auto';
/** The authenticated account id; safe to read after a `requireUser` preHandler
 *  (which guarantees a session or an account-bound device principal). */
function accountUserId(p: Principal): string {
    if (p.class === 'session')
        return p.user_id;
    if (p.class === 'device')
        return p.user_id ?? '';
    return '';
}
/** A manual decision's source is inferred from the token class — never trusted
 *  from the request body. Desktop shells out to the CLI, so it reads as 'cli'. */
function sourceFromPrincipal(p: Principal): Exclude<DecisionSource, 'auto'> {
    return p.class === 'session' ? 'web' : 'cli';
}
/** The kit a pending skill arrived through (owned/member kit or kit
 *  subscription), for grouping the Updates page. null when the skill came via a
 *  non-kit source (an author subscription). Metadata only: the pending queue
 *  stays one row per skill, so consent coverage is unaffected. */
export interface PendingSourceKit {
    id: string;
    name: string;
    owner: string;
    slug: string | null;
    avatar_url: string | null;
}
export interface PendingTarget {
    skill_id: SkillId;
    author_id: string;
    slug: string;
    to_hash: string;
    source_kit?: PendingSourceKit | null;
}
/** The caller's currently-pending update targets. Sqlite path retired. */
export function pendingTargets(_db: DatabaseSync, _userId: string): PendingTarget[] {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: pendingTargetsPrisma");
}
/** Record an approved/auto baseline for a skill's current version. Sqlite path retired. */
export function baselineSkillDecision(_db: DatabaseSync, _userId: string, _skillId: SkillId, _versionHash: string): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: baselineSkillDecisionPrisma");
}
/** Prisma async counterpart of {@link baselineSkillDecision}. */
export async function baselineSkillDecisionPrisma(prisma: import('../db/prisma-client.js').PrismaDb, userId: string, skillId: SkillId, versionHash: string): Promise<void> {
    await prisma.update_decisions.createMany({
        data: [
            {
                id: newId(),
                user_id: userId,
                skill_id: skillId,
                version_hash: versionHash,
                state: 'approved',
                source: 'auto',
            },
        ],
        skipDuplicates: true,
    });
}
export function pendingUpdatesCount(db: DatabaseSync, userId: string): number {
    return pendingTargets(db, userId).length;
}
/** The "Skills you've edited" section's rows. Sqlite path retired — use {@link editedHeldUpdatesPrisma}. */
export function editedHeldUpdates(_db: DatabaseSync, _userId: string): EditedHeldUpdate[] {
    throw new Error('sqlite registry store removed; use editedHeldUpdatesPrisma');
}
function upsertDecision(_db: DatabaseSync, _userId: string, _skillId: SkillId, _versionHash: string, _state: 'approved' | 'rejected', _source: DecisionSource): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: upsertDecisionPrisma");
}
/** Stamp every currently-pending target as approved/source:auto. Write-path only
 *  (mode flip to auto in U3, device auto-apply in U7) — never from a read. */
export function stampAutoApprovals(db: DatabaseSync, userId: string): number {
    const targets = pendingTargets(db, userId);
    for (const t of targets)
        upsertDecision(db, userId, t.skill_id, t.to_hash, 'approved', 'auto');
    if (targets.length > 0)
        bumpUserAttention(db, userId);
    return targets.length;
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerApprovalRoutes(app: FastifyInstance, db: DatabaseSync, prismaArg?: PrismaClient): void {
    const prisma = requirePrisma(
        prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
    );
    // POST /approvals { skill_id, version_hash } — record an approval (canonical,
    // subscription-scoped). Source derives from the token class.
    app.post<{
        Body: {
            skill_id?: string;
            version_hash?: string;
        };
    }>('/approvals', { preHandler: requireUser() }, async (req, reply) => {
        return decide(req, reply, 'approved');
    });
    app.post<{
        Body: {
            skill_id?: string;
            version_hash?: string;
        };
    }>('/rejections', { preHandler: requireUser() }, async (req, reply) => {
        return decide(req, reply, 'rejected');
    });
    async function decide(req: FastifyRequest<{
        Body: {
            skill_id?: string;
            version_hash?: string;
        };
    }>, reply: FastifyReply, state: 'approved' | 'rejected') {
        const userId = accountUserId(req.principal as Principal);
        const rawSkillId = (req.body?.skill_id ?? '').trim();
        const versionHash = (req.body?.version_hash ?? '').trim();
        if (!rawSkillId || !versionHash) {
            return reply.status(400).send({ error: 'skill_id and version_hash are required' });
        }
        // The request body is an untrusted external string — the sanctioned mint
        // point. A ref that can't canonicalize could never be in the subscribed set,
        // so it takes the same not_subscribed path as a canonical-but-unsubscribed id.
        let skillId: SkillId;
        try {
            skillId = toSkillId(rawSkillId);
        }
        catch {
            return reply.status(403).send({ error: 'not_subscribed' });
        }
        if (!(await subscribedSkillIdsPrisma(prisma, userId)).has(skillId)) {
            return reply.status(403).send({ error: 'not_subscribed' });
        }
        const canonical = await resolveVersionHashPrisma(prisma, skillId, versionHash);
        if (!canonical)
            return reply.status(404).send({ error: 'version_not_found' });
        const source = sourceFromPrincipal(req.principal as Principal);
        await upsertDecisionPrisma(prisma, userId, skillId, canonical, state, source);
        await bumpUserAttentionPrisma(prisma, userId);
        return reply.send({ ok: true, skill_id: skillId, version_hash: canonical, state });
    }
    // POST /approvals/all — approve every currently-pending target in one shot.
    app.post('/approvals/all', { preHandler: requireUser() }, async (req, reply) => {
        return decideAll(req, reply, 'approved');
    });
    // POST /rejections/all — skip every currently-pending target in one shot.
    app.post('/rejections/all', { preHandler: requireUser() }, async (req, reply) => {
        return decideAll(req, reply, 'rejected');
    });
    // Bulk counterpart to decide(): stamp the same decision over all pending
    // targets. Subscription/canonical scoping is already enforced by
    // pendingTargets() (it only returns the user's subscribed, readable,
    // non-quarantined, undecided versions), so no per-item guard is needed.
    async function decideAll(req: FastifyRequest, reply: FastifyReply, state: 'approved' | 'rejected') {
        const userId = accountUserId(req.principal as Principal);
        const source = sourceFromPrincipal(req.principal as Principal);
        const n = await decideAllPendingPrisma(prisma, userId, state, source);
        return reply.send({ ok: true, [state]: n });
    }
    // GET /me/decisions — the device's reconciliation feed (account-scoped).
    // `pending_removals` rides along so devices HOLD (not prune) skills whose
    // kit-removal is still undecided on the web (R5).
    app.get('/me/decisions', { preHandler: requireUser() }, async (req, reply) => {
        const userId = accountUserId(req.principal as Principal);
        return reply.send({
            update_mode: await accountUpdateModePrisma(prisma, userId),
            decisions: await listDecisionsPrisma(prisma, userId),
            pending_removals: (await pendingRemovalsPrisma(prisma, userId)).map((r) => r.skill_id),
        });
    });
    // GET /me/removals — the web Updates tab's removal rows (R5).
    app.get('/me/removals', { preHandler: requireUser() }, async (req, reply) => {
        const userId = accountUserId(req.principal as Principal);
        return reply.send({ pending: await pendingRemovalsPrisma(prisma, userId) });
    });
    // POST /removals — decide a pending kit removal. Scope guard: the (skill,
    // kit) pair must be currently pending for this user, mirroring /approvals.
    app.post<{
        Body: {
            skill_id?: string;
            kit_id?: string;
            action?: string;
        };
    }>('/removals', { preHandler: requireUser() }, async (req, reply) => {
        const userId = accountUserId(req.principal as Principal);
        const skillId = (req.body?.skill_id ?? '').trim();
        const kitId = (req.body?.kit_id ?? '').trim();
        const action = (req.body?.action ?? '').trim();
        if (!skillId || !kitId || (action !== 'remove' && action !== 'keep')) {
            return reply.status(400).send({ error: 'skill_id, kit_id, and action (remove|keep) are required' });
        }
        const result = await decideRemovalPrisma(prisma, userId, skillId, kitId, action);
        if (result === 'not_pending')
            return reply.status(403).send({ error: 'not_pending' });
        if (result === 'not_keepable')
            return reply.status(422).send({ error: 'not_keepable', message: 'This skill is no longer published, so it can\'t be kept from the library.' });
        return reply.send({ ok: true, skill_id: skillId, kit_id: kitId, action });
    });
    // GET /me/updates — the web Updates tab data. Pure read (no auto-stamp here).
    app.get('/me/updates', { preHandler: requireUser() }, async (req, reply) => {
        const userId = accountUserId(req.principal as Principal);
        const targets = await pendingTargetsPrisma(prisma, userId);
        const pending = [];
        for (const t of targets) {
            const toVersion = await versionOrdinalPrisma(prisma, t.skill_id, t.to_hash);
            const skill = await prisma.skills.findUnique({
                where: { id: t.skill_id },
                select: { category: true, description: true },
            });
            const author = await prisma.authors.findUnique({
                where: { id: t.author_id },
                select: { name: true, avatar_url: true },
            });
            const vm = await prisma.skill_versions.findFirst({
                where: { skill_id: t.skill_id, hash: t.to_hash },
                select: { metadata_json: true, major: true, minor: true, patch: true },
            });
            let releaseNote: string | null = null;
            if (vm) {
                try {
                    const meta = JSON.parse(vm.metadata_json) as {
                        changelog?: unknown;
                    };
                    if (typeof meta.changelog === 'string')
                        releaseNote = meta.changelog;
                }
                catch {
                }
            }
            const scan = await prisma.skill_version_scans.findFirst({
                where: { skill_version_id: t.to_hash },
                select: { status: true, findings_json: true },
            });
            let scanFindings = 0;
            if (scan) {
                try {
                    scanFindings = (JSON.parse(scan.findings_json) as unknown[]).length;
                }
                catch {
                }
            }
            pending.push({
                ref: `${t.author_id}/${t.slug}`,
                skill_id: t.skill_id,
                from_version: toVersion > 1 ? toVersion - 1 : null,
                // Populate the from-side semver label so the "vX → vY" range
                // reads as semver on both sides instead of mixing a bare
                // ordinal (v1) with a label (v1.1.0).
                from_version_label:
                    toVersion > 1
                        ? await priorVersionLabelPrisma(prisma, t.skill_id, t.to_hash)
                        : null,
                to_version: toVersion,
                to_version_label: vm
                    ? formatVersionLabel(vm)
                    : await versionLabelOfPrisma(prisma, t.skill_id, t.to_hash),
                to_hash: t.to_hash,
                release_note: releaseNote,
                category: skill?.category ?? null,
                description: skill?.description ?? null,
                author_name: author?.name ?? null,
                author_avatar_url: author?.avatar_url ?? null,
                scan_status: scan?.status ?? null,
                scan_findings: scanFindings,
                source_kit: t.source_kit ?? null,
            });
        }
        // Group per-skill cards: one card lists every device that reported the edit.
        const editedBySkill = new Map<
            string,
            {
                ref: string;
                skill_id: string;
                from_version_label: string | null;
                to_version: number;
                to_version_label: string | null;
                to_hash: string;
                baseline_hash: string;
                has_upstream: boolean;
                category: string | null;
                author_name: string | null;
                author_avatar_url: string | null;
                devices: Array<{
                    device_id: string;
                    label: string | null;
                    last_seen_at: number | null;
                    edited_at: number;
                }>;
            }
        >();
        for (const e of await editedHeldUpdatesPrisma(prisma, userId)) {
            let card = editedBySkill.get(e.skill_id);
            if (!card) {
                const toVersion = await versionOrdinalPrisma(prisma, e.skill_id, e.to_hash);
                const skill = await prisma.skills.findUnique({
                    where: { id: e.skill_id },
                    select: { category: true },
                });
                const author = await prisma.authors.findUnique({
                    where: { id: e.author_id },
                    select: { name: true, avatar_url: true },
                });
                card = {
                    ref: `${e.author_id}/${e.slug}`,
                    skill_id: e.skill_id,
                    from_version_label:
                        e.baseline_version ?? (await versionLabelOfPrisma(prisma, e.skill_id, e.baseline_hash)),
                    to_version: toVersion,
                    to_version_label: await versionLabelOfPrisma(prisma, e.skill_id, e.to_hash),
                    to_hash: e.to_hash,
                    baseline_hash: e.baseline_hash,
                    has_upstream: e.has_upstream,
                    category: skill?.category ?? null,
                    author_name: author?.name ?? null,
                    author_avatar_url: author?.avatar_url ?? null,
                    devices: [],
                };
                editedBySkill.set(e.skill_id, card);
            }
            card.devices.push({
                device_id: e.device_id,
                label: e.device_label,
                last_seen_at: e.device_last_seen_at,
                edited_at: e.edited_at,
            });
        }

        return reply.send({
            update_mode: await accountUpdateModePrisma(prisma, userId),
            pending,
            recently_applied: [],
            editedSkills: [...editedBySkill.values()],
        });
    });
}
