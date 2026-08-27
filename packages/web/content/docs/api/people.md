---
title: People API
description: "Author and team profiles, and the trust graph."
order: 3
section: API reference
---

<!-- Generated from the OpenAPI document by `scripts/gen-api-docs.mjs`. Do not edit by hand. -->

Base URL: `https://skillet.md/api/v1`

Auth, errors, caching, pagination, and rate limits are in the [API overview](/docs/api). Every endpoint here is also described in [`/openapi.json`](https://skillet.md/openapi.json).

## Endpoints

- [`GET /discover/people`](#get-discoverpeople) — Browse authors and teams
- [`GET /profiles/{author}`](#get-profilesauthor) — Get an author or team profile
- [`GET /profiles/{author}/followers`](#get-profilesauthorfollowers) — List a profile’s followers
- [`GET /profiles/{author}/following`](#get-profilesauthorfollowing) — List who a profile follows

## GET /discover/people

Public profiles that have published at least one skill, with the categories they publish in. Use it to answer "who is worth following for X".

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `listPeople`

| Parameter | Description |
| --- | --- |
| `limit` integer · query · optional | Page size. Clamped server-side to 1-100. |
| `offset` integer · query · optional | Zero-based offset into the result set. |
| `q` string · query · optional | Free-text filter over handle, display name, and bio. |
| `category` string · query · optional | One category key, or a comma-separated list. |
| `sort` `followers` \| `new` \| `alpha` · query · optional | Ordering: `followers`, `new`, or `alpha`. |

```bash
curl -s "https://skillet.md/api/v1/discover/people"
```

Returns a page of public profiles.

```json
{
  "people": [
    {
      "handle": "…",
      "name": "…",
      "bio": "…",
      "avatar_url": "https://skillet.md/…",
      "followers": 0,
      "public_skills": 0,
      "kits": 0,
      "categories": [
        "…"
      ],
      "created_at": 0
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

## GET /profiles/{author}

A profile's public record: display name, bio, avatar, follower counts, public adopter count, and every public skill they publish.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `getProfile`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |

```bash
curl -s "https://skillet.md/api/v1/profiles/shadcn"
```

Returns the profile record.

```json
{
  "handle": "shadcn",
  "displayName": "shadcn/ui",
  "bio": "Official shadcn/ui workflow.",
  "avatarUrl": "https://skillet.md/…",
  "kind": "user",
  "followers": 0,
  "following": 0,
  "totalInstalls": 0,
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
  ]
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /profiles/{author}/followers

Public handles that follow this profile.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `listFollowers`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |
| `limit` integer · query · optional | Page size. Clamped server-side to 1-100. |
| `offset` integer · query · optional | Zero-based offset into the result set. |

```bash
curl -s "https://skillet.md/api/v1/profiles/shadcn/followers"
```

Returns a page of follower handles.

```json
{
  "items": [
    {
      "handle": "…",
      "name": "…",
      "avatar_url": "https://skillet.md/…"
    }
  ],
  "total": 0
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /profiles/{author}/following

Public handles this profile follows.

**Auth** — none. This endpoint is anonymous. A bearer token with the `read` scope also works.

**Operation ID** — `listFollowing`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |
| `limit` integer · query · optional | Page size. Clamped server-side to 1-100. |
| `offset` integer · query · optional | Zero-based offset into the result set. |

```bash
curl -s "https://skillet.md/api/v1/profiles/shadcn/following"
```

Returns a page of followed handles.

```json
{
  "items": [
    {
      "handle": "…",
      "name": "…",
      "avatar_url": "https://skillet.md/…"
    }
  ],
  "total": 0
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |
