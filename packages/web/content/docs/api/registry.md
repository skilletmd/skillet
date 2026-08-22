---
title: Registry API
description: "Registry-wide status and enforcement records."
order: 5
section: API reference
---

<!-- Generated from the OpenAPI document by `scripts/gen-api-docs.mjs`. Do not edit by hand. -->

Base URL: `https://skillet.md/api/v1`

Auth, errors, caching, pagination, and rate limits are in the [API overview](/docs/api). Every endpoint here is also described in [`/openapi.json`](https://skillet.md/openapi.json).

## Endpoints

- [`GET /stats`](#get-stats) — Get registry-wide totals
- [`GET /moderation`](#get-moderation) — Read the public moderation log
- [`GET /whoami`](#get-whoami) — Identify the calling token
- [`GET /sync/manifest`](#get-syncmanifest) — Get the sync manifest for a paired device
- [`POST /mcp`](#post-mcp) — Call the hosted MCP server

## GET /stats

Public aggregates: skill, kit, author, and device counts, plus recent publish volume. No identity is exposed.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `getRegistryStats`

```bash
curl -s "https://skillet.md/api/v1/stats"
```

Returns registry totals.

```json
{
  "skills": 0,
  "authors": 0,
  "kits": 0,
  "devices": 0
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /moderation

Currently-active enforcement against skills and accounts. Published so a downstream consumer can independently check whether something it cached has since been removed.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `listModerationActions`

```bash
curl -s "https://skillet.md/api/v1/moderation"
```

Returns active enforcement records.

```json
{
  "actions": [
    {
      "target": "…",
      "action": "…",
      "reason": "…",
      "created_at": 0
    }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /whoami

Resolves the bearer token to its principal and the scopes it carries. Anonymous callers get `{"authenticated": false}` rather than a 401, so it doubles as a cheap credential check.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `whoami`

```bash
curl -s "https://skillet.md/api/v1/whoami"
```

Returns the caller identity and granted scopes.

```json
{
  "authenticated": false,
  "handle": "…",
  "user_id": "…",
  "token_class": "session",
  "scopes": [
    "read"
  ]
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /sync/manifest

Everything a device is entitled to hold: each skill's approved version and content hash. Requires a device or session token with the `sync` scope. Send `If-None-Match` with the previous ETag to poll cheaply.

**Auth** — bearer token with the `sync` scope.

**Operation ID** — `getSyncManifest`

```bash
curl -s "https://skillet.md/api/v1/sync/manifest" \
  -H "Authorization: Bearer $SKILLET_TOKEN"
```

Returns the manifest of approved skill versions for this device.

```json
{
  "skills": [
    {
      "skill_id": "…",
      "hash": "…",
      "version_label": "…",
      "source": "…"
    }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `304` | Nothing changed since the ETag the caller sent. |
| `400` | The request was malformed (bad parameter, missing field). |
| `401` | Missing, expired, or revoked token. |
| `403` | The token is valid but lacks the `sync` scope. |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## POST /mcp

JSON-RPC 2.0 over Streamable HTTP. Exposes the caller's kit as MCP tools (`list_skills`, `get_skill`, plus `search`/`fetch` aliases for deep-research clients). Read-only: an MCP token can never publish or sync-write. Enable the link at Settings → Account on the site, then point a client at it.

**Auth** — bearer token with the `read` scope.

**Operation ID** — `callMcp`

```bash
# POST \
curl -s "https://skillet.md/api/v1/mcp" \
  -H "Authorization: Bearer $SKILLET_TOKEN"
```

Returns the JSON-RPC response.

```json
{
  "jsonrpc": "2.0",
  "id": "…",
  "result": {},
  "error": {
    "code": 0,
    "message": "…",
    "data": {}
  }
}
```

| Status | Meaning |
| --- | --- |
| `202` | A JSON-RPC notification was accepted; no body. |
| `400` | The request was malformed (bad parameter, missing field). |
| `401` | Missing, disabled, or revoked MCP token. |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |
