// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
//
// The registry accepts RFC 6750 bearer tokens and enforces a fixed scope set
// per token class, which made it an OAuth 2.0 resource server that had never
// said so anywhere a machine could read. An agent that hit a 401 got a JSON
// body written for a human and no way to discover what credential would have
// worked, or what the narrowest useful one would be.
//
// These two documents are that answer, at the paths RFC 9728 §3 derives:
//
//   /.well-known/oauth-protected-resource                 → the whole API
//   /.well-known/oauth-protected-resource/api/v1/mcp      → the MCP endpoint
//
// The MCP one is not optional decoration: MCP's authorization spec has clients
// read the `resource_metadata` parameter off the `WWW-Authenticate` header of a
// 401 and fetch exactly that URL. See `bearerChallenge` in
// `@skillet/protocol/protected-resource`, which builds the header these serve.
//
// The document body lives in @skillet/protocol so the web app can mirror it at
// https://skillet.md/.well-known/oauth-protected-resource byte-for-byte.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  buildProtectedResourceMetadata,
  PROTECTED_RESOURCE_WELL_KNOWN,
  type ProtectedResourceId,
} from '@skillet/protocol/protected-resource';

/**
 * Public base of THIS registry. Same fallback as routes/openapi.ts and
 * routes/mcp.ts: the configured public URL, else the request's own origin.
 * The `resource` member has to match the URL the caller actually presented a
 * token to, or a conforming client rejects the document.
 */
function registryOrigin(req: FastifyRequest): string {
  const configured = process.env.SKILLET_REGISTRY_PUBLIC_URL;
  const base = configured ?? `${req.protocol}://${req.headers.host ?? 'localhost'}`;
  return base.replace(/\/+$/, '');
}

function siteOrigin(): string {
  return (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, '');
}

export function registerOAuthMetadataRoutes(app: FastifyInstance): void {
  const handler = (resource: ProtectedResourceId) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const doc = buildProtectedResourceMetadata(resource, {
        siteUrl: siteOrigin(),
        registryUrl: registryOrigin(req),
      });
      reply.header('content-type', 'application/json; charset=utf-8');
      reply.header('cache-control', 'public, max-age=3600');
      // Metadata about how to authenticate is public by definition, and a
      // browser-based agent has to be able to read it cross-origin — the CORS
      // allowlist governs credentialed calls, not this.
      reply.header('access-control-allow-origin', '*');
      return reply.send(doc);
    };

  for (const [resource, path] of Object.entries(PROTECTED_RESOURCE_WELL_KNOWN)) {
    app.get(path, handler(resource as ProtectedResourceId));
  }
}
