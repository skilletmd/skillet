---
title: Skills API
description: "The skill catalog: search, detail, versions, and content."
order: 1
section: API reference
---

<!-- Generated from the OpenAPI document by `scripts/gen-api-docs.mjs`. Do not edit by hand. -->

Base URL: `https://skillet.md/api/v1`

Auth, errors, caching, pagination, and rate limits are in the [API overview](/docs/api). Every endpoint here is also described in [`/openapi.json`](https://skillet.md/openapi.json).

## Endpoints

- [`GET /skills`](#get-skills) — List published skills
- [`GET /skills/{author}/{slug}`](#get-skillsauthorslug) — Get one skill
- [`GET /skills/{author}/{slug}/manifest`](#get-skillsauthorslugmanifest) — Get the latest version manifest
- [`GET /skills/{author}/{slug}/versions/{hash}/files`](#get-skillsauthorslugversionshashfiles) — List the files in a version
- [`GET /skills/{author}/{slug}/versions/{hash}/file`](#get-skillsauthorslugversionshashfile) — Read one file from a version
- [`GET /skills/{author}/{slug}/versions/{hash}/scan`](#get-skillsauthorslugversionshashscan) — Get the harm-scan verdict for a version
- [`GET /skills/{author}/{slug}/kits`](#get-skillsauthorslugkits) — List the kits a skill belongs to

## GET /skills

The public skill catalog, newest first by default. Use `q` for a substring match over name and description, or `category` to narrow to one domain. Returns only public skills for an anonymous caller.

**Auth** — none. This endpoint is anonymous.

**Operation ID** — `listSkills`

| Parameter | Description |
| --- | --- |
| `limit` integer · query · optional | Page size. Clamped server-side to 1-100. |
| `offset` integer · query · optional | Zero-based offset into the result set. |
| `q` string · query · optional | Free-text filter over skill name and description. |
| `category` string · query · optional | One category key, or a comma-separated list. Unknown keys are ignored rather than widening the query. |
| `sort` `new` \| `alpha` · query · optional | `new` for most recently published, `alpha` for name order. |

```bash
curl -s "https://skillet.md/api/v1/skills"
```

Returns a page of catalog entries.

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
  "total": 1145,
  "limit": 50,
  "offset": 0
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /skills/{author}/{slug}

A skill's full public record: description, category, latest version hash, the version list, scan and signature status, provenance, and token cost. Fetch this before reading skill content so you know which `hash` to request.

**Auth** — none. This endpoint is anonymous.

**Operation ID** — `getSkill`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |
| `slug` string · path · required | Skill slug, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-63 chars. |

```bash
curl -s "https://skillet.md/api/v1/skills/shadcn/shadcn"
```

Returns the skill detail record.

```json
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
  "used_by_count": 12,
  "versions": [
    {
      "hash": "…",
      "published_at": 0,
      "version_label": "…"
    }
  ],
  "author_name": "…",
  "author_avatar_url": "https://skillet.md/…",
  "author_public_key": "…",
  "manifest_url": "…",
  "is_mirror": false,
  "mirror_source_url": "https://skillet.md/…",
  "mirror_license": "…",
  "triggers": [
    "…"
  ],
  "token_count": 0,
  "deprecation_message": "…"
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /skills/{author}/{slug}/manifest

The per-file manifest of the latest published version: every bundle path with its size and content hash. Use it to verify a download or to decide which files are worth fetching.

**Auth** — none. This endpoint is anonymous.

**Operation ID** — `getSkillManifest`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |
| `slug` string · path · required | Skill slug, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-63 chars. |

```bash
curl -s "https://skillet.md/api/v1/skills/shadcn/shadcn/manifest"
```

Returns the manifest for the latest published version.

```json
{
  "schema_version": 0,
  "hash": "…",
  "author": "…",
  "slug": "…",
  "files": [
    {
      "path": "…",
      "size": 0,
      "hash": "…"
    }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /skills/{author}/{slug}/versions/{hash}/files

Every file in one published version, with size and kind. `SKILL.md` is always present; supporting `scripts/`, `references/`, and `assets/` files appear when the author bundled them.

**Auth** — none. This endpoint is anonymous.

**Operation ID** — `listSkillVersionFiles`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |
| `slug` string · path · required | Skill slug, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-63 chars. |
| `hash` string · path · required | Content hash of a published version, with or without the `sha256:` prefix. Read it from `latest_hash` or the `versions[]` list on the skill detail response. |

```bash
curl -s "https://skillet.md/api/v1/skills/shadcn/shadcn/versions/sha256:c57e3cc8688fe5f0956c8e91ee02d1ee97fb5b0e8115e2d6ca6447c1ade69686/files"
```

Returns the file listing for that version.

```json
{
  "schema_version": 0,
  "hash": "…",
  "author": "…",
  "slug": "…",
  "files": [
    {
      "path": "…",
      "size": 0,
      "hash": "…"
    }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /skills/{author}/{slug}/versions/{hash}/file

The decoded text of a single bundle file. Request `path=SKILL.md` to read the instructions an agent loads. Responses carry a strong ETag; send `If-None-Match` to get a 304 instead of a re-download.

**Auth** — none. This endpoint is anonymous.

**Operation ID** — `getSkillVersionFile`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |
| `slug` string · path · required | Skill slug, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-63 chars. |
| `hash` string · path · required | Content hash of a published version, with or without the `sha256:` prefix. Read it from `latest_hash` or the `versions[]` list on the skill detail response. |
| `path` string · query · required | Bundle-relative file path, e.g. `SKILL.md` or `references/API.md`. |

```bash
curl -s "https://skillet.md/api/v1/skills/shadcn/shadcn/versions/sha256:c57e3cc8688fe5f0956c8e91ee02d1ee97fb5b0e8115e2d6ca6447c1ade69686/file?path=SKILL.md"
```

Returns the file, decoded as text.

```json
{
  "schema_version": 0,
  "hash": "…",
  "author": "…",
  "slug": "…",
  "path": "…",
  "size": 0,
  "text": "…"
}
```

| Status | Meaning |
| --- | --- |
| `304` | The caller already has this exact version of the file. |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /skills/{author}/{slug}/versions/{hash}/scan

The registry's static scan of a version: an overall verdict plus the findings behind it. Read this before running a third-party skill; `quarantined` means the registry refuses to serve the content at all.

**Auth** — none. This endpoint is anonymous.

**Operation ID** — `getSkillVersionScan`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |
| `slug` string · path · required | Skill slug, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-63 chars. |
| `hash` string · path · required | Content hash of a published version, with or without the `sha256:` prefix. Read it from `latest_hash` or the `versions[]` list on the skill detail response. |

```bash
curl -s "https://skillet.md/api/v1/skills/shadcn/shadcn/versions/sha256:c57e3cc8688fe5f0956c8e91ee02d1ee97fb5b0e8115e2d6ca6447c1ade69686/scan"
```

Returns the scan record for that version.

```json
{
  "hash": "…",
  "status": "clean",
  "corpus_version": 0,
  "findings": [
    {
      "detector": "…",
      "severity": "…",
      "path": "…",
      "line": 0,
      "message": "…"
    }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |

## GET /skills/{author}/{slug}/kits

Public kits that include this skill. Useful for finding curated collections around a capability you already trust.

**Auth** — none. This endpoint is anonymous.

**Operation ID** — `listKitsForSkill`

| Parameter | Description |
| --- | --- |
| `author` string · path · required | Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars. |
| `slug` string · path · required | Skill slug, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-63 chars. |

```bash
curl -s "https://skillet.md/api/v1/skills/shadcn/shadcn/kits"
```

Returns the kits containing this skill.

```json
{
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
  ]
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed (bad parameter, missing field). |
| `404` | No such resource, or it is not readable by this caller. |
| `429` | Rate limited. Retry after the window in `Retry-After`. |
