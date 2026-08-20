import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildRegistryStatsPrisma } from '../lib/registry-stats.js';

// Public registry-wide aggregates (the web `/stats` page). Anonymous read — no
// principal required — so the page renders for logged-out visitors and crawlers.
// Everything sliceable (per author, per skill, per category) counts only public,
// published content — never a window into private skills or accounts. The one
// exception is the headline network total: a single aggregate integer that
// includes private skills, because it can't identify any of them.

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
  }
  return prisma;
}

export function registerStatsRoutes(
  app: FastifyInstance,
  prisma?: PrismaClient,
): void {
  // GET /v1/stats — totals, monthly growth, and a category breakdown.
  app.get('/stats', async (_req, reply) => {
    const db = requirePrisma(prisma);
    const payload = await buildRegistryStatsPrisma(db);
    return reply.status(200).send(payload);
  });
}
