---
title: Discovery API
description: "Cross-catalog search and browse feeds."
order: 2
section: API reference
---

<!-- Generated from the OpenAPI document by `scripts/gen-api-docs.mjs`. Do not edit by hand. -->

Base URL: `https://skillet.md/api/v1`

Auth, errors, caching, pagination, and rate limits are in the [API overview](/docs/api). Every endpoint here is also described in [`/openapi.json`](https://skillet.md/openapi.json).

## Endpoints

- [`GET /search`](#get-search) — Search skills, kits, and people
- [`GET /discover/feed`](#get-discoverfeed) — Read the public activity feed

## GET /search

One query across every public object type. This is the right first call for "is there already a skill for X" — it ranks skills, kits, authors, and teams together.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `search`

| Parameter | Description |
| --- | --- |
| `q` string · query · required | The search query. An empty query returns no results. Multi-word queries match word by word, across hyphens and underscores, so `web design` finds `web-design-guidelines`. Results matching every word rank first; when nothing matches every word, results matching any word are returned. Words of three or more characters match anywhere (`lint` finds `eslint-config`); shorter words match only where they start a word, so `x` finds `twitter-x` but not `linux`. |
| `types` string · query · optional | Comma-separated object types to include. Defaults to all of `skills,kits,people`. |
| `limit` integer · query · optional | Maximum results per type. |

```bash
curl -s "https://skillet.md/api/v1/search?q=code%20review"
```

Returns ranked results grouped by type.

```json
{
  "skills": [
    {
      "author": "shadcn",
      "slug": "shadcn",
      "skill_id": "shadcn:shadcn",
      "description": "Manages shadcn components and projects: adding, searching, fixing, and composing UI.",
      "visibility": "public",
      "latest_hash": "sha256:c57e3cc8688fe5f0956c8e91ee02d1ee97fb5b0e8115e2d6ca6447c1ade69686",
      "version": 3,
      "version_label": "1.2.0",
      "install_count": 412,
      "created_at": 1787163766,
      "category": "frontend",
      "signatureStatus": "verified",
      "scanStatus": "clean",
      "moderationStatus": "none",
      "deprecated": false,
      "used_by": [
        "gtm"
      ],
      "used_by_count": 12
    }
  ],
  "kits": [
    {
      "id": "…",
      "owner": "…",
      "slug": "…",
      "name": "…",
      "description": "…",
      "skill_count": 0,
      "subscriber_count": 0,
      "category": "…"
    }
  ],
  "people": [
    {
      "handle": "…",
      "name": "…",
      "avatar_url": "https://skillet.md/…"
    }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /discover/feed

Registry-wide public activity — publishes, new kits, new profiles — newest first. Poll it to track what changed since a previous read.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `listActivity`

| Parameter | Description |
| --- | --- |
| `limit` integer · query · optional | Page size. Clamped server-side to 1-100. |
| `offset` integer · query · optional | Zero-based offset into the result set. |

```bash
curl -s "https://skillet.md/api/v1/discover/feed"
```

Returns a page of public activity events.

```json
{
  "events": [
    {
      "kind": "…",
      "actor": "…",
      "skill_id": "…",
      "kit_id": "…",
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
