// One JSON error shape across every route.
//
// Handlers grew their own bodies over time: `{ error: 'Skill not found' }` here,
// `{ error: 'invalid_slug', message: … }` there, Fastify's
// `{ statusCode, error, message }` for anything thrown. All JSON, none of it
// consistent, and none of it told a caller how to recover.
//
// Rather than rewrite ~175 handlers (and break every client that reads
// `body.error`), this normalizes on the way out. It is PURELY ADDITIVE: the
// fields a handler already sent survive verbatim, and we fill in the two an
// agent needs — a stable `code` it can branch on, and a `docs` URL that
// explains the failure. `statusCode` is added so the body is self-describing
// when it has been copied out of its response.

import type { FastifyInstance } from 'fastify';

const CODE_RE = /^[a-z][a-z0-9_]*$/;

/** Docs page that explains the API's error contract. */
export function errorDocsUrl(): string {
    const site = (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, '');
    return `${site}/docs/api#errors`;
}

/**
 * Derive a stable machine code from whatever the handler sent.
 *
 * Handlers already use snake_case codes for the errors clients branch on
 * (`invalid_slug`, `handle_not_claimed`); those pass through untouched. A prose
 * `error` string ("Skill not found") is slugified into one, which is stable as
 * long as the prose is. Anything else falls back to the status family.
 */
export function deriveErrorCode(body: Record<string, unknown>, status: number): string {
    const existing = body.code;
    if (typeof existing === 'string' && CODE_RE.test(existing)) return existing;
    const err = body.error;
    if (typeof err === 'string') {
        const slug = err
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (slug && CODE_RE.test(slug) && slug.length <= 64) return slug;
    }
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 409) return 'conflict';
    if (status === 422) return 'unprocessable_entity';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'internal_error';
    return 'bad_request';
}

/**
 * Fill in `code`, `docs`, and `statusCode` on an error body without disturbing
 * what is already there. Returns the same object when nothing needs adding, so
 * a compliant body is not re-serialized.
 */
export function withErrorEnvelope(
    body: Record<string, unknown>,
    status: number,
): Record<string, unknown> {
    const code = deriveErrorCode(body, status);
    const needsCode = body.code !== code;
    const needsDocs = typeof body.docs !== 'string';
    const needsStatus = typeof body.statusCode !== 'number';
    if (!needsCode && !needsDocs && !needsStatus) return body;
    return {
        ...body,
        ...(needsCode ? { code } : {}),
        ...(needsStatus ? { statusCode: status } : {}),
        ...(needsDocs ? { docs: errorDocsUrl() } : {}),
    };
}

/**
 * True when an outgoing payload is an error body this may rewrite: a 4xx/5xx,
 * declared JSON, and a plain object (never an array, never a stream, never the
 * pre-serialized string a handler chose to send itself).
 */
export function isEnvelopableError(
    status: number,
    contentType: string | undefined,
    payload: unknown,
): payload is Record<string, unknown> {
    if (status < 400) return false;
    if (!contentType || !contentType.includes('application/json')) return false;
    if (payload === null || typeof payload !== 'object') return false;
    if (Array.isArray(payload)) return false;
    // A Buffer/stream payload is already-serialized bytes; leave it alone.
    if (Buffer.isBuffer(payload)) return false;
    if (typeof (payload as { pipe?: unknown }).pipe === 'function') return false;
    return true;
}

/**
 * Wire the envelope into a Fastify instance: normalize every JSON error body
 * on the way out, and answer an unrouted path with the same shape.
 *
 * Exported as one call so `createServer` and the tests wire identical behavior
 * — a hook that only exists in production is a hook nothing checks.
 */
export function registerErrorEnvelope(app: FastifyInstance): void {
    // Runs BEFORE serialization, so a handler that sends a pre-rendered string,
    // a Buffer, or a stream is never touched.
    app.addHook('preSerialization', async (_request, reply, payload) => {
        const contentType = reply.getHeader('content-type');
        // Fastify sets the JSON content type during serialization, so an unset
        // header on an object payload still means JSON.
        const declared =
            contentType == null ? 'application/json' : String(contentType);
        if (!isEnvelopableError(reply.statusCode, declared, payload)) return payload;
        return withErrorEnvelope(payload, reply.statusCode);
    });

    // Without this, Fastify's built-in 404 skips the error handler and ships a
    // bare `{message,error,statusCode}` with no code and no way forward.
    app.setNotFoundHandler((request, reply) => {
        return reply.code(404).send({
            error: 'Not Found',
            code: 'route_not_found',
            message: `No route for ${request.method} ${request.url.split('?')[0]}. See the OpenAPI description at /openapi.json for the routes this API serves.`,
        });
    });
}
