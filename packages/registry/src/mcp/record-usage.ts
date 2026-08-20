// Record an MCP skill load as a `skill.route` usage event.
//
// When a hosted MCP client loads a skill (get_skill / fetch), the serve handler
// calls this so the load shows up in the owner's route-usage the same way a
// `/skillet` route does. It writes DIRECTLY to `events` because the ingest
// endpoint (POST /api/v1/events) rejects mcp principals — so it re-applies the
// three guards that endpoint would otherwise enforce: skill_ref grammar + size,
// the activity-private opt-out, and the per-user ring buffer. Deduped per
// (user, skill_ref) within a coarse window so a session that loads the same
// skill repeatedly (or loads its supporting files) counts once, comparable to a
// single CLI route.
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import { newId } from '../db/index.js';
import { runPrismaTransaction } from '../db/prisma-client.js';
import { isActivityPrivatePrisma, pruneUserEventsPrisma } from '../lib/user-events.js';
import { MAX_META_VALUE, REF_RE } from '../routes/events.js';
// Coarse "one session" proxy: repeat loads of a skill inside this window fold
// into the first event. The events table carries no link/session id, so dedup
// keys on the owning user — which also collapses the same skill loaded through
// two of a user's clients into one tick.
const DEDUP_WINDOW_SECONDS = 60 * 60;
export interface McpUsageContext {
    /** The MCP link the load came in on — resolves the vendor tag. */
    linkId: string;
    /** The link owner's user id — the account the usage is attributed to. */
    userId: string;
    /** Canonical `@owner/slug` reference for the loaded skill. */
    skillRef: string;
}
function parseMeta(raw: string | null): Record<string, unknown> | null {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    }
    catch {
        return null;
    }
}
export function recordMcpSkillUsage(_db: DatabaseSync, _ctx: McpUsageContext): void {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: recordMcpSkillUsagePrisma");
}
/** Prisma twin of recordMcpSkillUsage for the MySQL serve path. */
export async function recordMcpSkillUsagePrisma(prisma: PrismaClient, ctx: McpUsageContext): Promise<void> {
    const { linkId, userId, skillRef } = ctx;
    if (!REF_RE.test(skillRef) || skillRef.length > MAX_META_VALUE)
        return;
    await runPrismaTransaction(prisma, async (tx) => {
        if (await isActivityPrivatePrisma(tx, userId))
            return;
        const cutoff = Math.floor(Date.now() / 1000) - DEDUP_WINDOW_SECONDS;
        const recent = await tx.events.findMany({
            where: {
                user_id: userId,
                name: 'skill.route',
                ts: { gte: cutoff },
            },
            select: { meta: true },
        });
        const already = recent.some((r) => {
            const meta = parseMeta(r.meta);
            return meta?.['source'] === 'mcp' && meta?.['skill_ref'] === skillRef;
        });
        if (already)
            return;
        const vendorRow = await tx.mcp_link_clients.findFirst({
            where: { link_id: linkId },
            orderBy: { last_used_at: 'desc' },
            select: { client: true },
        });
        const meta: Record<string, string> = { skill_ref: skillRef, source: 'mcp' };
        if (vendorRow?.client)
            meta.client = vendorRow.client;
        const now = Math.floor(Date.now() / 1000);
        await tx.events.create({
            data: {
                id: newId(),
                name: 'skill.route',
                initiator: 'human',
                user_id: userId,
                device_id: null,
                meta: JSON.stringify(meta),
                ts: now,
            },
        });
        await pruneUserEventsPrisma(tx, userId);
    });
}
