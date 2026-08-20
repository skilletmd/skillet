import type { FastifyReply } from 'fastify';

/** Shared Cache-Control for anonymous public catalog list responses (~1 min). */
export const PUBLIC_CATALOG_LIST_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';

/** Authenticated / principal-varying list responses must not be shared at the edge. */
export const PRIVATE_CATALOG_LIST_CACHE_CONTROL = 'private, no-store';

export function setPublicCatalogListCacheHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', PUBLIC_CATALOG_LIST_CACHE_CONTROL);
}

export function setPrivateCatalogListCacheHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', PRIVATE_CATALOG_LIST_CACHE_CONTROL);
}
