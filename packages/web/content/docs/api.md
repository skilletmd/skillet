---
title: API
searchTitle: "Skillet API reference"
description: "The Skillet HTTP API: anonymous reads, token scopes, the error contract, caching, rate-limit headers, and what /api/v1 promises."
order: 0
section: Reference
---

Skillet's registry is a JSON HTTP API. Every read is anonymous: no key, no signup, no rate-limit form. Writes need a bearer token whose class fixes its scopes.

```bash
curl -s "https://skillet.md/api/v1/search?q=code+review"
```

That works right now, from anywhere, with no setup.

## Reference

Per-endpoint parameters, sample responses, and status codes, generated from the OpenAPI document so they cannot drift from the API:

| Resource | Covers |
| --- | --- |
| [Skills](/docs/api/skills) | Catalog, detail, versions, file contents, scan verdicts |
| [Discovery](/docs/api/discovery) | Cross-catalog search, public activity feed |
| [People](/docs/api/people) | Profiles and the follow graph |
| [Kits](/docs/api/kits) | Public kits and their members |
| [Registry](/docs/api/registry) | Token identity, sync manifest, stats, moderation, MCP |

Machine-readable description of every endpoint, with operation IDs and typed schemas:

```
https://skillet.md/openapi.json
```

It is OpenAPI 3.1 and is built from the same source the registry serves at `https://registry.skillet.md/openapi.json`, so the two can never disagree. Point a function-calling client straight at it.

## Two origins

| Origin | Serves | Methods | CORS |
| --- | --- | --- | --- |
| `https://skillet.md/api/v1` | Anonymous reads | `GET`, `HEAD`, `OPTIONS` | `Access-Control-Allow-Origin: *` |
| `https://registry.skillet.md/api/v1` | Everything, including writes | All | Allowlisted origins, credentialed |

**Call the apex from a browser.** It forwards no cookie and no `Authorization` header, which is exactly why it can answer `*`. The registry origin allows credentials, so it answers only allowlisted origins and a cross-site `fetch` from your page will fail there.

Send writes to the registry origin. The apex answers `405` with `code: read_only_mirror`.

## Auth

A token's prefix determines what it may do. Scopes are fixed at mint; a token cannot widen its own grant.

| Prefix | Class | Scopes | Get one |
| --- | --- | --- | --- |
| `skillet_s_` | User session | `read`, `sync`, `publish`, `claim` | Sign in on the web |
| `skillet_d_` | Paired device | `read`, `sync` | `skillet connect <code>` |
| `skillet_k_` | Kit key | `read`, `sync` (one kit) | Settings → Kits |
| `skillet_m_` | Hosted MCP link | `read` | Settings → Account |

| Scope | Grants |
| --- | --- |
| `read` | Public and self-owned skills, kits, and profiles |
| `sync` | The sync manifest and approved skill content for a paired device |
| `publish` | New skill versions and visibility changes |
| `claim` | Handle claim and author key binding |

Request the narrowest class that does the job. An integration that reads one kit should hold a kit key, not a session token.

Every token is self-serve. Sign in, and the class you need is one page away: a device token from `skillet connect <code>`, a kit key from Settings → Kits, an MCP link from Settings → Account. There is no application to fill in and no sales step.

The same scope list is published machine-readably as [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) protected-resource metadata, which is what a `401` points at in its `WWW-Authenticate` header:

```
https://skillet.md/.well-known/oauth-protected-resource
```

Skillet is an OAuth 2.0 *resource server*: it accepts RFC 6750 bearer tokens and publishes its scopes at the well-known path above. It does not run an authorization server, so there is no `/authorize` or `/token` endpoint and no `/.well-known/oauth-authorization-server` document. Tokens come from the site and the CLI.

```bash
curl -s https://registry.skillet.md/api/v1/whoami \
  -H "Authorization: Bearer $SKILLET_TOKEN"
```

`whoami` answers `{"authenticated": false}` for an anonymous caller rather than `401`, so it doubles as a credential check.

## Pagination

List endpoints take `limit` and `offset`.

| | |
| --- | --- |
| `limit` | Default 50 (24 on `discover/*`). Clamped to 1-100. |
| `offset` | Zero-based. Clamped server-side; deep offsets are refused, not served slowly. |
| `total` | Total matches ignoring pagination, in the response body. |

Out-of-range values are clamped, never rejected, so a bad `limit` returns a page rather than a `400`.

## Caching

Two different contracts, depending on what you asked for.

| Response | Headers | Why |
| --- | --- | --- |
| Catalog and discovery reads | `Cache-Control: public, max-age=60, s-maxage=60` | Content changes on publish; a minute is the staleness budget. |
| Version-scoped reads (`/manifest`, `/versions/{hash}/*`) | Strong `ETag`, `Cache-Control: no-cache` | Addressed by content hash, so the body for a given hash is immutable. Revalidate, don't re-download. |

```bash
curl -s "https://skillet.md/api/v1/skills/shadcn/shadcn/manifest" \
  -H 'If-None-Match: "sha256:c57e3cc…"'
# HTTP/2 304
```

There is no webhook surface. To track new publishes, poll `GET /discover/feed` and page on `offset`.

## Errors

Every failure is JSON. Never an HTML page, on any status.

```json
{
  "error": "Skill not found",
  "code": "skill_not_found",
  "message": "Skill not found",
  "statusCode": 404,
  "docs": "https://skillet.md/docs/api#errors"
}
```

| Field | Use |
| --- | --- |
| `code` | Stable and machine-readable. Branch on this. |
| `error` | Short reason phrase. Kept for older clients. |
| `message` | For humans and logs. Wording may change. |
| `docs` | The page that explains how to resolve it. |
| `request_id` | Present on `5xx`. Quote it in a bug report. |

| Status | Means |
| --- | --- |
| `400` | Malformed request: bad parameter, missing field |
| `401` | Missing, expired, or revoked token |
| `403` | Valid token, insufficient scope |
| `404` | No such resource, or not readable by this caller |
| `405` | Write sent to the read-only apex mirror |
| `410` | The skill is deprecated |
| `422` | Well-formed but invalid, e.g. a slug that breaks the grammar |
| `429` | Rate limited |

A private skill and a nonexistent one both answer `404`. That is deliberate: a `403` would confirm the skill exists.

A deprecated skill answers `410` with its sunset notice rather than disappearing, so a client that pinned it can say why it stopped:

```json
{ "deprecated": true, "deprecation_message": "Superseded by shadcn/shadcn-v2." }
```

## Rate limits

Three per-IP buckets, each a 60-second window. Roughly 2,000 ambient reads, 300 writes, and 60 heavy reads (bundle downloads, version diffs, MCP tool calls) per minute.

Read the budget off the response instead of hardcoding those numbers. Metered responses carry the IETF RateLimit header fields, in both the spelling the current draft defines and the one older clients parse:

| Header | Example | Means | Always sent |
| --- | --- | --- | --- |
| `RateLimit-Limit` | `2000` | Requests permitted in the window | Yes |
| `RateLimit-Policy` | `"ambient"; q=2000; w=60` | The bucket this request was charged to, and its quota | Yes |
| `RateLimit-Remaining` | `1993` | Requests left in this window | Uncached only |
| `RateLimit-Reset` | `47` | Seconds until the window resets | Uncached only |
| `RateLimit` | `"ambient"; r=1993; t=47` | The same live state as a structured field | Uncached only |
| `Retry-After` | `47` | Seconds to wait | On `429` |

The last three describe *your* bucket, so they are sent only when the response is not shared-cacheable. Catalog and search answer `public, s-maxage=60` and sit in a CDN edge cache, where one caller's remaining count would be served to every other caller for the next minute. A wrong number is worse than none, so it is withheld rather than guessed.

What that means in practice: pace against `RateLimit-Policy`, which is the same for everyone and always present. When you need your exact position in the window, read `RateLimit-Remaining` from any uncached response, or from the `429` itself, which is always sent `no-store`.

```bash
curl -sI "https://skillet.md/api/v1/skills?limit=1" | grep -i ratelimit
```

Exceeding a bucket returns `429` with `Retry-After`. There is no key to apply for and no per-key quota; if a legitimate integration needs more, [open an issue](https://github.com/skilletmd/skillet/issues).

## What `/api/v1` promises

| | |
| --- | --- |
| **Additive changes ship without notice** | New fields appear on existing responses. Ignore what you don't recognize. |
| **`code` values are stable** | Once an error code is published it keeps its meaning. |
| **Enums can gain members** | Treat an unknown `scanStatus` or `category` as unrecognized, not as an error. |
| **Breaking changes get a new prefix** | `/api/v2`. `/api/v1` is not rewritten under you. |
| **Removal is announced in headers first** | `Deprecation`, then `Sunset` at least 90 days out. See [Versioning](/docs/versioning). |
| **Undocumented routes are not API** | The registry serves ~175 routes; the ones in `/openapi.json` are the supported surface. The rest are internal and may change or vanish. |

## Markdown instead of JSON

If you want the prose rather than the record, skip the API. Every page serves Markdown at its own URL:

```bash
curl -s -H 'Accept: text/markdown' https://skillet.md/shadcn/shadcn
curl -s https://skillet.md/docs/api.md
```

For a skill, that returns the published `SKILL.md` verbatim — the artifact an agent actually loads.

## MCP

The hosted MCP server exposes a user's own kit as tools over Streamable HTTP. Discovery manifest:

```
https://skillet.md/.well-known/mcp.json
```

MCP is off until the user enables it in Settings → Account, which mints a read-only `skillet_m_` link. See [MCP](/docs/mcp) for per-client setup.

## Discovery files

| File | Contains |
| --- | --- |
| [`/openapi.json`](https://skillet.md/openapi.json) | OpenAPI 3.1 description of the public API |
| [`/llms.txt`](https://skillet.md/llms.txt) | Orientation for agents: what this site is for and when to call it |
| [`/.well-known/mcp.json`](https://skillet.md/.well-known/mcp.json) | MCP server card: endpoint, transport, auth |
| [`/.well-known/agent-skills/index.json`](https://skillet.md/.well-known/agent-skills/index.json) | The skills Skillet itself publishes, with SHA-256 digests |
| [`/.well-known/oauth-protected-resource`](https://skillet.md/.well-known/oauth-protected-resource) | RFC 9728: the scopes this API accepts, and where to get a token |
| [`/.well-known/oauth-protected-resource/api/v1/mcp`](https://skillet.md/.well-known/oauth-protected-resource/api/v1/mcp) | RFC 9728 for the MCP endpoint alone: `read` and nothing else |
| [`/sitemap.xml`](https://skillet.md/sitemap.xml) | Every indexable URL |

## Limitations

- Writes are not available on the apex mirror. Use the registry origin.
- No webhooks. Poll `GET /discover/feed`.
- Private skills are invisible to anonymous callers, including their existence.
- No per-key quotas. Limits are per IP, and reported in the `RateLimit-*` headers above.
- No OAuth authorization server. Bearer tokens are accepted and their scopes published (RFC 6750 + RFC 9728), but there is no authorization-code flow to integrate against.
- The OpenAPI document describes the public surface, not every internal route. Device sync internals, moderation queues, and account routes are deliberately absent.
