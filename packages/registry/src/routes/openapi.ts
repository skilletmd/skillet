// GET /openapi.json — the machine-readable description of this API.
//
// Served at the ROOT of the registry (not under the /api/v1 prefix) because
// that is where a client looks first, and mirrored under the prefix so a caller
// that only knows the versioned base can still find it. The document itself
// lives in @skillet/protocol so the web app serves byte-identical bytes at
// https://skillet.md/openapi.json — one document, two origins.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { REGISTRY_VERSION_PREFIX } from '@skillet/protocol';
import { buildOpenApiDocument } from '@skillet/protocol/openapi';

/**
 * Public base of THIS registry. Deployments set SKILLET_REGISTRY_PUBLIC_URL;
 * otherwise fall back to the request's own scheme + Host, which is right for
 * direct exposure and for proxies that preserve Host. Mirrors registryBase()
 * in routes/mcp.ts — same fallback, same reason.
 */
function registryOrigin(req: FastifyRequest): string {
    const configured = process.env.SKILLET_REGISTRY_PUBLIC_URL;
    const base = configured ?? `${req.protocol}://${req.headers.host ?? 'localhost'}`;
    return base.replace(/\/+$/, '');
}

function siteOrigin(): string {
    return (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, '');
}

export function registerOpenApiRoutes(app: FastifyInstance): void {
    const handler = async (req: FastifyRequest, reply: {
        header: (k: string, v: string) => unknown;
        send: (b: unknown) => unknown;
    }) => {
        const doc = buildOpenApiDocument({
            siteUrl: siteOrigin(),
            registryUrl: registryOrigin(req),
        });
        // `application/openapi+json` is the registered type, but every tool in
        // the wild sniffs for `application/json`; the profile parameter keeps
        // both readers happy.
        reply.header('content-type', 'application/json; charset=utf-8');
        reply.header('cache-control', 'public, max-age=300');
        return reply.send(doc);
    };
    app.get('/openapi.json', handler);
    app.get(`${REGISTRY_VERSION_PREFIX}/openapi.json`, handler);
}
