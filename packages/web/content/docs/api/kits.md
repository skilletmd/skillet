---
title: Kits API
description: "Kits: named, versioned collections of skills."
order: 4
section: API reference
---

<!-- Generated from the OpenAPI document by `scripts/gen-api-docs.mjs`. Do not edit by hand. -->

Base URL: `https://skillet.md/api/v1`

Auth, errors, caching, pagination, and rate limits are in the [API overview](/docs/api). Every endpoint here is also described in [`/openapi.json`](https://skillet.md/openapi.json).

## Endpoints

- [`GET /discover/kits`](#get-discoverkits) — Browse public kits
- [`GET /kits/by-handle/{owner}/{slug}`](#get-kitsby-handleownerslug) — Get a kit by owner and slug

## GET /discover/kits

The public kit catalog. A kit is a named, versioned collection of skills that a person or team maintains; subscribing to one keeps every member skill current.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `listKits`

| Parameter | Description |
| --- | --- |
| `limit` integer · query · optional | Page size. Clamped server-side to 1-100. |
| `offset` integer · query · optional | Zero-based offset into the result set. |
| `q` string · query · optional | Free-text filter over kit name and description. Words are matched separately, across hyphens and underscores, and every word must match. Words of three or more characters match anywhere; shorter words match only where they start a word. |
| `category` string · query · optional | One category key, or a comma-separated list. |
| `sort` `new` \| `alpha` · query · optional | `new` for most recently published, `alpha` for name order. |

```bash
curl -s "https://skillet.md/api/v1/discover/kits"
```

Returns a page of public kits.

```json
{
  "items": [
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
  "total": 0,
  "limit": 0,
  "offset": 0
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /kits/by-handle/{owner}/{slug}

One public kit and its member skills, addressed the same way its web page is (`/{owner}/kit/{slug}`).

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `getKitByHandle`

| Parameter | Description |
| --- | --- |
| `owner` string · path · required | Handle of the person or team that owns the kit. |
| `slug` string · path · required | Kit slug. |

```bash
curl -s "https://skillet.md/api/v1/kits/by-handle/shadcn/kit"
```

Returns the kit and its members.

```json
{
  "id": "…",
  "owner": "…",
  "slug": "…",
  "name": "…",
  "description": "…",
  "skill_count": 0,
  "subscriber_count": 0,
  "category": "…",
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
  "version": 0
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |
