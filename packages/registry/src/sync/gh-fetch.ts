/**
 * Centralized GitHub fetch for the sync / mirror engine.
 *
 * Every server-side outbound fetch here is already host-locked to GitHub by
 * construction (callers interpolate only `owner`/`repo`/`ref`/`path` segments
 * into a hardcoded `https://api.github.com` / `https://raw.githubusercontent.com`
 * base), so there is no attacker-chosen host to pivot on. This wrapper closes
 * the two residual gaps in a bare `fetch`, as defense-in-depth:
 *
 *   1. Redirects. `fetch` follows 3xx by default, which is the one way a
 *      host-locked request could still be bounced off-GitHub. We follow
 *      redirects manually and re-check the host allowlist on every hop, so a
 *      Location header can never land the request on an internal address.
 *   2. Timeout. A slow or hung GitHub response must not stall a Fastify worker.
 *      Every request carries an `AbortSignal.timeout`.
 *
 * The Authorization header is dropped on any cross-host redirect hop, so a token
 * is never replayed to a host the caller did not address (GitHub's own
 * raw -> objects.githubusercontent.com signed-URL redirects reject it anyway).
 */

/** Hosts the sync/mirror engine is allowed to reach. */
const GH_HOSTS: ReadonlySet<string> = new Set([
    'api.github.com',
    'raw.githubusercontent.com',
    'github.com',
    'codeload.github.com',
    'objects.githubusercontent.com',
]);

export function isGitHubHost(host: string): boolean {
    return GH_HOSTS.has(host.toLowerCase());
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

export interface GhFetchOpts {
    /** Injectable for tests; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
    /** Per-request timeout. Defaults to 15s. */
    timeoutMs?: number;
}

/**
 * Fetch a GitHub URL with a host-pinned redirect chain and a timeout. Throws if
 * the URL (or any redirect target) is not https on an allowlisted GitHub host.
 */
export async function ghFetch(url: string, init: RequestInit = {}, opts: GhFetchOpts = {}): Promise<Response> {
    const f = opts.fetchImpl ?? globalThis.fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startHost = new URL(url).hostname.toLowerCase();
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const u = new URL(current);
        if (u.protocol !== 'https:') {
            throw new Error(`refusing non-https sync fetch: ${u.protocol}//${u.hostname}`);
        }
        if (!isGitHubHost(u.hostname)) {
            throw new Error(`refusing off-GitHub host in sync fetch: ${u.hostname}`);
        }
        const headers = new Headers(init.headers);
        // Never replay auth to a host the caller did not address.
        if (u.hostname.toLowerCase() !== startHost) {
            headers.delete('authorization');
        }
        const res = await f(current, {
            ...init,
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
            current = new URL(res.headers.get('location')!, current).toString();
            continue;
        }
        return res;
    }
    throw new Error(`too many redirects fetching ${url}`);
}
