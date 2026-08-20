// Mirror review queue.
//
//   Candidates are PROPOSED into this queue by the discovery job
//   (scripts/discover-mirror-candidates.ts) — from a GitHub search and from the
//   source_repo provenance of real imports. There is no public submit endpoint:
//   importing a repo is the nomination signal (a job screens + enqueues it),
//   which keeps GitHub screening off the hot publish path.
//
//   GET  /api/v1/admin/mirror-queue           (requireAdmin)
//        The pending-review drain list for admins.
//
//   POST /api/v1/admin/mirror-queue/:id/decide (requireAdmin)
//        approve → RE-SCREEN + re-verify the live source_owner_id still matches
//          the submission-time value (KTD9 approval-time re-bind). On any
//          divergence the promotion aborts with a fresh rejected_screen and no
//          mirror is published. Otherwise upsert the mirror author (and, for an
//          Organization owner, an UNCLAIMED org row — KTD6/U6 end-state), run
//          syncRepoSkills, and mark the row live. The mirror is reserved and
//          CLAIMABLE (mirror_claimed_at stays NULL): submission never confers
//          ownership.
//        reject → mark rejected; no author/org row is created.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import type { PrismaClient } from '@prisma/client';
import { newId } from '../db/index.js';
import { runPrismaTransaction } from '../db/prisma-client.js';
import { requireAdmin, type Principal } from '../auth/middleware.js';
import { ensureOrgAuthorRowPrisma } from '../lib/org-access.js';
import { RealAuthorCollisionError, upsertMirrorAuthorPrisma } from '../lib/mirror-authors.js';
import { screenCandidate, parseOwnerRepo } from '../lib/mirror-screen.js';
import { syncRepoSkillsPrisma } from '../sync/sync-repo.js';
import type { BlobStore } from '../blob-store/types.js';
/** States that occupy the in-flight unique-index slot for a normalized key. */
export const IN_FLIGHT = ['submitted', 'pending_review', 'approved', 'live'] as const;
interface QueueRow {
    id: string;
    source_repo: string;
    normalized_repo_key: string;
    source_owner_login: string | null;
    source_owner_id: number | null;
    derived_handle: string | null;
    owner_type: string | null;
    license: string | null;
    status: string;
    submitted_by: string | null;
    screen_notes: string | null;
    decided_by: string | null;
    decided_at: number | null;
    created_at: number;
}
function publicRow(r: QueueRow): Record<string, unknown> {
    return {
        id: r.id,
        source_repo: r.source_repo,
        derived_handle: r.derived_handle,
        owner_type: r.owner_type,
        license: r.license,
        status: r.status,
        screen_notes: r.screen_notes,
        decided_by: r.decided_by,
        decided_at: r.decided_at,
        created_at: r.created_at,
    };
}
function toQueueRow(r: {
    id: string;
    source_repo: string;
    normalized_repo_key: string;
    source_owner_login: string | null;
    source_owner_id: number | null;
    derived_handle: string | null;
    owner_type: string | null;
    license: string | null;
    status: string;
    submitted_by: string | null;
    screen_notes: string | null;
    decided_by: string | null;
    decided_at: number | null;
    created_at: number;
}): QueueRow {
    return {
        id: r.id,
        source_repo: r.source_repo,
        normalized_repo_key: r.normalized_repo_key,
        source_owner_login: r.source_owner_login,
        source_owner_id: r.source_owner_id,
        derived_handle: r.derived_handle,
        owner_type: r.owner_type,
        license: r.license,
        status: r.status,
        submitted_by: r.submitted_by,
        screen_notes: r.screen_notes,
        decided_by: r.decided_by,
        decided_at: r.decided_at,
        created_at: r.created_at,
    };
}
function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerMirrorQueueRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  prismaArg?: PrismaClient,
  blobStoreArg?: BlobStore,
): void {
    const prisma = requirePrisma(
      prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
    )
    if (!blobStoreArg) {
      throw new Error('registerMirrorQueueRoutes requires a BlobStore')
    }
    const blobStore = blobStoreArg
    // --------------------------------------------------------------------------
    // GET /api/v1/admin/mirror-queue
    //   pending → the drain list (awaiting a decision).
    //   recent  → the last 50 decided rows (live / rejected / rejected_screen),
    //             newest first, so an admin sees the OUTCOME of a decision (incl.
    //             the screen_notes reason) instead of a row silently vanishing.
    // --------------------------------------------------------------------------
    app.get('/api/v1/admin/mirror-queue', { preHandler: requireAdmin() }, async (_req, reply) => {
        const [pending, recent] = await Promise.all([
            prisma.mirror_review_queue.findMany({
                where: { status: 'pending_review' },
                orderBy: { created_at: 'asc' },
            }),
            prisma.mirror_review_queue.findMany({
                where: { status: { not: 'pending_review' } },
                orderBy: [{ decided_at: 'desc' }, { created_at: 'desc' }],
                take: 50,
            }),
        ]);
        return reply.code(200).send({
            pending: pending.map((r) => publicRow(toQueueRow(r))),
            recent: recent.map((r) => publicRow(toQueueRow(r))),
        });
    });
    // --------------------------------------------------------------------------
    // POST /api/v1/admin/mirror-queue/:id/decide
    // --------------------------------------------------------------------------
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            decision?: 'approve' | 'reject';
            note?: string;
        };
    }>('/api/v1/admin/mirror-queue/:id/decide', { preHandler: requireAdmin() }, async (req, reply) => {
        const { id } = req.params;
        const decision = req.body?.decision;
        const note = req.body?.note ?? null;
        if (decision !== 'approve' && decision !== 'reject') {
            return reply.code(400).send({
                error: 'invalid_decision',
                message: 'decision must be one of: approve, reject',
            });
        }
        const principal = req.principal as Principal;
        const adminId = principal.class === 'session' ? principal.user_id : principal.class === 'device' ? principal.user_id : null;
        return decideWithPrisma(prisma, req, reply, { id, decision, note, adminId, db, blobStore });
    });
}
async function decideWithPrisma(prisma: PrismaClient, req: FastifyRequest, reply: FastifyReply, args: {
    id: string;
    decision: 'approve' | 'reject';
    note: string | null;
    adminId: string | null;
    db: DatabaseSync;
    blobStore: BlobStore;
}): Promise<unknown> {
    const { id, decision, note, adminId, blobStore } = args;
    const rowRaw = await prisma.mirror_review_queue.findUnique({ where: { id } });
    if (!rowRaw) {
        return reply.code(404).send({ error: 'candidate_not_found' });
    }
    const row = toQueueRow(rowRaw);
    const decidedAt = Math.floor(Date.now() / 1000);
    if (decision === 'reject') {
        const claimed = await prisma.mirror_review_queue.updateMany({
            where: { id, status: 'pending_review' },
            data: {
                status: 'rejected',
                decided_by: adminId,
                decided_at: decidedAt,
                ...(note != null ? { screen_notes: note } : {}),
            },
        });
        if (claimed.count === 0) {
            return reply.code(409).send({
                error: 'already_decided',
                message: `Candidate is already in state '${row.status}'.`,
            });
        }
        return reply.code(200).send({ id, status: 'rejected', decided_by: adminId, decided_at: decidedAt });
    }
    // approve — claim the row before async re-screen so concurrent decides 409.
    const claimed = await prisma.mirror_review_queue.updateMany({
        where: { id, status: 'pending_review' },
        data: {
            status: 'approved',
            decided_by: adminId,
            decided_at: decidedAt,
        },
    });
    if (claimed.count === 0) {
        return reply.code(409).send({
            error: 'already_decided',
            message: `Candidate is already in state '${row.status}'.`,
        });
    }
    const parsed = parseOwnerRepo(row.source_repo);
    if (!parsed) {
        const notes = `source_repo "${row.source_repo}" is no longer parseable`;
        await prisma.mirror_review_queue.update({
            where: { id },
            data: {
                status: 'rejected_screen',
                decided_by: adminId,
                decided_at: decidedAt,
                screen_notes: notes,
            },
        });
        return reply.code(200).send({ id, status: 'rejected_screen', reason: notes });
    }
    // Re-screen against live GitHub; handle check uses Prisma helpers.
    const screen = await screenCandidate({
        db: args.db,
        prisma,
        owner: parsed.owner,
        repo: parsed.repo,
    });
    const ownerIdDiverged = row.source_owner_id != null && screen.ownerId != null && screen.ownerId !== row.source_owner_id;
    if (!screen.pass || ownerIdDiverged) {
        const notes = ownerIdDiverged
            ? `source owner changed since submission (was ${row.source_owner_id}, now ${screen.ownerId}); promotion aborted`
            : (screen.notes ?? 're-screen failed at approval');
        await prisma.mirror_review_queue.update({
            where: { id },
            data: {
                status: 'rejected_screen',
                decided_by: adminId,
                decided_at: decidedAt,
                screen_notes: notes,
            },
        });
        return reply.code(200).send({ id, status: 'rejected_screen', reason: notes });
    }
    const handle = screen.derivedHandle!;
    const ownerLogin = screen.ownerLogin!;
    const repoFull = `${parsed.owner}/${parsed.repo}`;
    try {
        await runPrismaTransaction(prisma, async (tx) => {
            await upsertMirrorAuthorPrisma(tx, handle, ownerLogin, repoFull, screen.ownerType ?? null);
            if (screen.ownerType === 'Organization') {
                const exists = await tx.organizations.findFirst({
                    where: { slug: handle },
                    select: { id: true },
                });
                if (!exists) {
                    await tx.organizations.create({
                        data: {
                            id: newId(),
                            slug: handle,
                            name: ownerLogin,
                            owner_user_id: null,
                            source_owner_id: screen.ownerId,
                        },
                    });
                }
                await ensureOrgAuthorRowPrisma(tx, handle, ownerLogin);
            }
        });
    }
    catch (err) {
        if (err instanceof RealAuthorCollisionError) {
            const notes = `@${handle} collides with an existing registered author; promotion aborted`;
            await prisma.mirror_review_queue.update({
                where: { id },
                data: {
                    status: 'rejected_screen',
                    decided_by: adminId,
                    decided_at: decidedAt,
                    screen_notes: notes,
                },
            });
            return reply.code(200).send({ id, status: 'rejected_screen', reason: notes });
        }
        throw err;
    }
    try {
        await syncRepoSkillsPrisma(prisma, parsed.owner, parsed.repo, {
            authorHandle: handle,
            repoFull,
            license: screen.license,
            blobStore,
        });
    }
    catch (err) {
        req.log.warn({ err, id, handle, repo: repoFull }, 'mirror-queue approve: syncRepoSkills failed after author/org commit; marking row live anyway (skills backfill on next sync)');
    }
    // COALESCE source_owner_id: keep stored value when present, else use live id.
    await prisma.mirror_review_queue.update({
        where: { id },
        data: {
            status: 'live',
            derived_handle: handle,
            owner_type: screen.ownerType,
            license: screen.license,
            source_owner_id: row.source_owner_id ?? screen.ownerId,
            source_owner_login: ownerLogin,
            decided_by: adminId,
            decided_at: decidedAt,
            screen_notes: null,
        },
    });
    return reply.code(200).send({
        id,
        status: 'live',
        handle,
        owner_type: screen.ownerType,
        decided_by: adminId,
        decided_at: decidedAt,
    });
}
