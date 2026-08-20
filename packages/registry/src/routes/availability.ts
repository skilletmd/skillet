// Cross-vendor distribution (availability) ingest + the viewer's own view.
// CURRENT-STATE upsert table — see migrations 016 + 058. Same privacy posture
// as the events stream: account-bound, opt-out via `activity_private`, metadata only.
//
//   POST /api/v1/sync/availability   — upsert (skill_ref × runtime) availability for the caller
//   GET  /api/v1/me/availability     — the viewer's own current availability (transparency)
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/middleware.js';
import { runPrismaTransaction } from '../db/prisma-client.js';
import { tryToSkillId } from '@skillet/protocol/skill-id';

/**
 * Keep only refs that resolve to a PUBLIC published skill (#463). A device sends
 * the ref of every materialized skill, private and never-published included.
 * Availability is a public-graph signal, so private names must not be stored:
 * we drop any ref whose skill is private or absent from `skills` (a
 * never-published local skill has no row). Visibility lives server-side (the
 * client can't authoritatively know it), so this is the single authoritative
 * gate — it also protects any future public availability surface, which reads
 * only already-filtered rows.
 */
async function filterToPublicRefs(db: PrismaClient, refs: string[]): Promise<string[]> {
  if (refs.length === 0) return refs;
  const refBySkillId = new Map<string, string>();
  for (const ref of refs) {
    const skillId = tryToSkillId(ref);
    // First writer wins; refs are already deduped, and distinct refs mapping to
    // the same skillId is not a real case (one canonical form per skill).
    if (skillId && !refBySkillId.has(skillId)) refBySkillId.set(skillId, ref);
  }
  if (refBySkillId.size === 0) return [];
  const rows = await db.skills.findMany({
    where: { id: { in: [...refBySkillId.keys()] }, visibility: 'public' },
    select: { id: true },
  });
  return rows.map((r) => refBySkillId.get(r.id)!).filter((ref): ref is string => ref != null);
}

const MAX_REFS = 1000;
const MAX_RUNTIMES = 16;
const MAX_LEN = 200;
// Hard per-user storage ceiling. A real account has at most a few hundred
// (skill × runtime) pairs; this bounds an authenticated client that rotates
// ref/runtime values to bloat the table. Well above any legitimate usage.
const MAX_AVAILABILITY_PER_USER = 5000;
// Skill refs are `@author/slug`; runtimes are short adapter names. Reject control
// chars / NUL / anything off-grammar so nothing hostile flows into the graph.
const REF_RE = /^@?[a-z0-9][a-z0-9._/-]{0,200}$/i;
const RUNTIME_RE = /^[a-z0-9][a-z0-9._-]{0,64}$/i;

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
  }
  return prisma;
}

/** Dedup + grammar/length/count-cap a string list. */
function sanitizeList(v: unknown, max: number, grammar: RegExp): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v.filter(
        (x): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_LEN && grammar.test(x),
      ),
    ),
  ].slice(0, max);
}

export function registerAvailabilityRoutes(
  app: FastifyInstance,
  prisma?: PrismaClient,
): void {
  // POST /api/v1/sync/availability — record which skills are available in which runtimes.
  app.post<{ Body: { skill_refs?: unknown; runtimes?: unknown } }>(
    '/api/v1/sync/availability',
    { preHandler: requireUser() },
    async (req, reply) => {
      const db = requirePrisma(prisma);
      const userId = (req.principal as { user_id?: string }).user_id;
      if (!userId) return reply.code(403).send({ error: 'user_token_required' });

      const refs = sanitizeList(req.body?.skill_refs, MAX_REFS, REF_RE);
      const runtimes = sanitizeList(req.body?.runtimes, MAX_RUNTIMES, RUNTIME_RE);

      // Opt-out gate (same as events ingest): private mode records nothing.
      const user = await db.users.findUnique({
        where: { id: userId },
        select: { activity_private: true },
      });
      if (user?.activity_private === 1) return reply.send({ stored: 0, reason: 'private' });

      const count = await db.skill_runtime_availability.count({
        where: { user_id: userId },
      });
      if (count >= MAX_AVAILABILITY_PER_USER)
        return reply.send({ stored: 0, reason: 'availability_full' });

      // #463: never store private / never-published skill names.
      const publicRefs = await filterToPublicRefs(db, refs);
      if (publicRefs.length === 0 || runtimes.length === 0) return reply.send({ stored: 0 });

      const lastSeen = Math.floor(Date.now() / 1000);
      let stored = 0;
      await runPrismaTransaction(db, async (tx) => {
        const current = await tx.skill_runtime_availability.count({
          where: { user_id: userId },
        });
        if (current >= MAX_AVAILABILITY_PER_USER) return;

        const headroom = MAX_AVAILABILITY_PER_USER - current;
        outer: for (const ref of publicRefs) {
          for (const runtime of runtimes) {
            if (stored >= headroom) break outer;
            await tx.skill_runtime_availability.upsert({
              where: {
                user_id_skill_ref_runtime: {
                  user_id: userId,
                  skill_ref: ref,
                  runtime,
                },
              },
              create: {
                user_id: userId,
                skill_ref: ref,
                runtime,
                last_seen: lastSeen,
              },
              update: { last_seen: lastSeen },
            });
            stored++;
          }
        }
      });
      return reply.send({ stored });
    },
  );

  // GET /api/v1/me/availability — the viewer's current availability (transparency).
  app.get('/api/v1/me/availability', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma);
    const userId = (req.principal as { user_id?: string }).user_id;
    if (!userId) return reply.code(403).send({ error: 'user_token_required' });

    const rows = await db.skill_runtime_availability.findMany({
      where: { user_id: userId },
      orderBy: [{ skill_ref: 'asc' }, { runtime: 'asc' }],
      select: { skill_ref: true, runtime: true, last_seen: true },
    });
    return reply.send({ availability: rows });
  });

  // DELETE /api/v1/me/availability — purge the viewer's availability (user-owned
  // data, parity with DELETE /me/events). Opt-out stops new rows; this forgets old ones.
  app.delete('/api/v1/me/availability', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma);
    const userId = (req.principal as { user_id?: string }).user_id;
    if (!userId) return reply.code(403).send({ error: 'user_token_required' });

    const result = await db.skill_runtime_availability.deleteMany({
      where: { user_id: userId },
    });
    return reply.send({ deleted: result.count });
  });
}
