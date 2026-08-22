---
title: Versioning
searchTitle: "Skillet API versioning and deprecation policy"
description: "How the Skillet API versions, what counts as a breaking change, and the headers that warn you before an endpoint goes away."
order: 6
section: Reference
---

The version is in the URL path: `/api/v1`. A path under that prefix keeps its meaning for as long as the prefix answers. Breaking changes ship as a new prefix, not as an edit to the old one.

```bash
curl -s "https://skillet.md/api/v1/skills?limit=1"
```

Machine-readable form of everything on this page is in the OpenAPI document under `info.x-versioning`.

## What is a breaking change

| Change | Breaking | What you should do |
| --- | --- | --- |
| A new field on an existing response | No | Ignore fields you don't recognize |
| A new member in an existing enum | No | Treat an unknown value as unrecognized, not as an error |
| A new optional query parameter | No | Nothing |
| A new endpoint | No | Nothing |
| A field removed or retyped | Yes | New prefix |
| An error `code` changing meaning | Yes | New prefix |
| An endpoint removed | Yes | New prefix, after the deprecation window below |

Undocumented routes are not part of this promise. The registry serves roughly 175 routes; the ones described in [`/openapi.json`](https://skillet.md/openapi.json) are the supported surface. The rest are internal and may change or vanish without a header.

## How a deprecation is announced

Nothing in the documented surface is removed without appearing in a response header first. Three headers, in the order you will meet them:

| Header | Spec | Means |
| --- | --- | --- |
| `Deprecation` | RFC 9745 | This endpoint is deprecated. Value is `true`, or the HTTP date it became so. |
| `Link: <...>; rel="deprecation"` | RFC 8288 | Where the replacement is documented. |
| `Sunset` | RFC 8594 | The HTTP date after which this endpoint stops answering. |

```
HTTP/2 200
Deprecation: true
Link: <https://skillet.md/docs/versioning>; rel="deprecation"
Sunset: Wed, 01 Jul 2026 00:00:00 GMT
```

`Deprecation` appears first and can stand alone. Its value is `true` while no date is claimed, or `@` plus Unix seconds once one is. `Sunset` is added only when a removal date exists, is always an HTTP-date, and never appears less than 90 days ahead of that date. An agent that reads these two headers has everything it needs to migrate on its own schedule.

Already retired: `POST /api/v1/signup` answers `410` with `Deprecation` and the link above. Anonymous device signup was replaced by the pairing flow; see [Install](/docs/install).

The apex mirror at `skillet.md/api/v1` relays all three headers from the registry, so it does not matter which origin you call.

## Deprecated skills

A skill can be deprecated independently of the API. That is a content decision by its author, not a version change, and it answers `410` with a reason rather than disappearing:

```json
{ "deprecated": true, "deprecation_message": "Superseded by shadcn/shadcn-v2." }
```

The record stays readable so a client that pinned it can say why it stopped.

## Client versions

The `skilletmd` CLI and the desktop app are versioned independently of the API and follow semver. The registry declines to sync a client older than its minimum supported version and says which version to upgrade to, rather than failing on a schema it cannot explain.

## Related

- [API](/docs/api): endpoints, auth scopes, errors, caching, rate limits
- [`/openapi.json`](https://skillet.md/openapi.json): the typed description, with `info.x-versioning`
