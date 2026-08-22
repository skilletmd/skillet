/**
 * The client IP to forward as `X-Forwarded-For`, or null to forward nothing.
 *
 * `cf-connecting-ip` is only trustworthy behind Cloudflare's edge; without the
 * explicit trust opt-in it is forgeable and must not key the registry's per-IP
 * rate limit — a forged header would let one caller drain another's budget, or
 * dodge their own.
 *
 * Lives in `lib/` because both proxies to the registry need it: the
 * credentialed BFF (`/api/registry/…`) and the anonymous apex API mirror
 * (`/api/v1/…`). A route module importing another route module works, but it
 * makes the ownership of a shared helper unreadable.
 */
export function forwardedClientIp(cfConnectingIp: string | null, trust: boolean): string | null {
  return trust && cfConnectingIp ? cfConnectingIp : null
}
