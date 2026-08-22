---
title: API
description: "The public HTTP API: anonymous reads, token scopes, the error contract, caching, and what /api/v1 promises."
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

Per IP, per minute: roughly 2,000 ambient reads, 300 writes, and 60 heavy reads (bundle downloads, version diffs, MCP tool calls).

Exceeding a bucket returns `429` with `Retry-After` in seconds. **There are no `X-RateLimit-*` headers** — don't build a quota display against them. There is no key to apply for; if a legitimate integration needs more, [open an issue](https://github.com/skilletmd/skillet/issues).

## What `/api/v1` promises

| | |
| --- | --- |
| **Additive changes ship without notice** | New fields appear on existing responses. Ignore what you don't recognize. |
| **`code` values are stable** | Once an error code is published it keeps its meaning. |
| **Enums can gain members** | Treat an unknown `scanStatus` or `category` as unrecognized, not as an error. |
| **Breaking changes get a new prefix** | `/api/v2`. `/api/v1` is not rewritten under you. |
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
| [`/sitemap.xml`](https://skillet.md/sitemap.xml) | Every indexable URL |

## Limitations

- Writes are not available on the apex mirror. Use the registry origin.
- No webhooks. Poll `GET /discover/feed`.
- Private skills are invisible to anonymous callers, including their existence.
- No `X-RateLimit-*` headers, and no per-key quotas.
- The OpenAPI document describes the public surface, not every internal route. Device sync internals, moderation queues, and account routes are deliberately absent.
