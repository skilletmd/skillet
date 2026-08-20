// Universal search: GET /v1/search across skills, kits, authors, teams.
//
// One `q` queries four entity types and returns typed, grouped, ranked results.
// Visibility is NON-NEGOTIABLE: we never re-implement access logic here — we
// reuse the exact boundaries the rest of the surface enforces via Prisma helpers.
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  recordSearchSourcePrisma,
  recordDemandTokensPrisma,
  searchAuthorsPrisma,
  searchKitsPrisma,
  searchSkillsPrisma,
  searchTeamsPrisma,
} from '../lib/universal-search.js';
import { catalogListMemo, catalogListMemoKey } from '../lib/catalog-list-memo.js';
import {
  setPrivateCatalogListCacheHeaders,
  setPublicCatalogListCacheHeaders,
} from '../lib/catalog-list-cache-headers.js';

const ALL_TYPES = ['skills', 'kits', 'authors', 'teams'] as const;
type SearchType = (typeof ALL_TYPES)[number];
const TYPE_SET = new Set<string>(ALL_TYPES);

const DEFAULT_LIMIT = 8;
const MIN_LIMIT = 1;
const MAX_LIMIT = 25;

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
  }
  return prisma;
}

/** Parse a querystring int, falling back to `def`, clamped to [min, max]. */
function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined) return def;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

export function registerSearchRoutes(
  app: FastifyInstance,
  prisma?: PrismaClient,
): void {
  // GET /v1/search?q=&types=skills,kits,authors,teams&limit=<perType>
  app.get<{ Querystring: { q?: string; types?: string; limit?: string } }>(
    '/search',
    async (req, reply) => {
      const db = requirePrisma(prisma);
      const q = (typeof req.query.q === 'string' ? req.query.q : '').trim();
      const limit = clampInt(req.query.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
      const sharePublicly = !req.principal;

      // Content-free attribution: which known client drove this search. Counted
      // only for a real (non-empty) query, so a no-op typeahead ping can't
      // inflate the signal. Never stored alongside the query text.
      if (q !== '') {
        const searchSource = req.headers['x-skillet-search-source'];
        await recordSearchSourcePrisma(db, searchSource);
        // Keywords-only demand log: only the summon-fallback source feeds it.
        await recordDemandTokensPrisma(db, searchSource, q);
      }

      // `types` CSV — default all four, unknown tokens ignored. Dedup but
      // preserve the canonical group order.
      let requested: SearchType[];
      if (typeof req.query.types === 'string' && req.query.types.trim() !== '') {
        const wanted = new Set(
          req.query.types
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter((t) => TYPE_SET.has(t)),
        );
        requested = ALL_TYPES.filter((t) => wanted.has(t));
      } else {
        requested = [...ALL_TYPES];
      }

      // Empty/whitespace query → empty groups (friendlier for typeahead than 400).
      if (q === '') {
        const groups: Record<string, Record<string, unknown>[]> = {};
        for (const t of requested) groups[t] = [];
        if (sharePublicly) setPublicCatalogListCacheHeaders(reply);
        else setPrivateCatalogListCacheHeaders(reply);
        return reply.status(200).send({ query: q, groups });
      }

      const qLower = q.toLowerCase();
      const principal = req.principal;
      const typesKey = requested.join(',');

      const loadGroups = async () => {
        const groups: Record<string, Record<string, unknown>[]> = {};
        for (const t of requested) {
          switch (t) {
            case 'skills':
              groups.skills = await searchSkillsPrisma(db, qLower, principal, limit);
              break;
            case 'kits':
              groups.kits = await searchKitsPrisma(db, qLower, principal, limit);
              break;
            case 'authors':
              groups.authors = await searchAuthorsPrisma(db, qLower, limit);
              break;
            case 'teams':
              groups.teams = await searchTeamsPrisma(db, qLower, limit);
              break;
          }
        }
        return { query: q, groups };
      };

      // Only memo anonymous results — auth views must not share a public key.
      const body = sharePublicly
        ? await catalogListMemo.getOrLoad(
            catalogListMemoKey('search', { q: qLower, types: typesKey, limit }),
            loadGroups,
          )
        : await loadGroups();

      if (sharePublicly) setPublicCatalogListCacheHeaders(reply);
      else setPrivateCatalogListCacheHeaders(reply);
      return reply.status(200).send(body);
    },
  );
}
