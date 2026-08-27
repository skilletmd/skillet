# Registry HTTP API

> Generated from the Fastify route registrations in `packages/registry/src` by
> `scripts/gen-registry-api.mjs`. Do not edit by hand — run the script to refresh.

The registry (`@skillet/registry`) is the source of truth: a Fastify + Prisma/MySQL
service. This is the route map a self-hoster needs; conceptual detail lives in the
main [README](../README.md) and [packages/registry/README.md](../packages/registry/README.md).

## Conventions

- **Base path.** Every route is under `/api/v1`. Health check: `GET /api/hc`.
- **Machine-readable description.** `GET /openapi.json` (also under the version
  prefix) serves the OpenAPI 3.1 document for the public surface, built from
  `@skillet/protocol/openapi` so the web app can serve the same bytes.
- **Auth.** Bearer tokens in `Authorization` — `skillet_s_` session, `skillet_d_`
  device, `skillet_m_` MCP-link. Public reads work unauthenticated; write and
  account routes require the right token class.
- **Internal routes (BFF only).** Routes marked 🔒 let the trusted web BFF act on any
  account. They require the web-internal HMAC signature, must never be internet-routable,
  and can be origin-locked with `SKILLET_INTERNAL_ORIGIN_ALLOWLIST` (they 404 for any
  other peer). See the README Operations section.
- **Errors.** Every failure is JSON carrying `{ error, code, message, statusCode, docs }`.
  `code` is the stable machine-readable field; the envelope is filled in on the way out
  by `src/error-envelope.ts`, which only ADDS fields, so a handler's own body survives.
  5xx are reduced to `{ error: "internal", request_id }` with the detail logged
  server-side.
- **Rate limits.** Per-client-IP classes (ambient / write / heavy); see
  `packages/registry/README.md`.

_182 routes across 35 areas._

## Account

| Method | Path |
| --- | --- |
| GET | `/api/v1/me/muted-team-kits` |
| PUT | `/api/v1/me/team-kits/:kitId/mute` |
| DELETE | `/api/v1/me/team-kits/:kitId/mute` |
| GET | `/api/v1/me/update-mode` |
| PATCH | `/api/v1/me/update-mode` |

## Adapters

| Method | Path |
| --- | --- |
| GET | `/api/v1/adapters/manifest` |

## Admin

| Method | Path |
| --- | --- |
| GET | `/api/v1/admin/activity` |
| GET | `/api/v1/admin/featured` |
| POST | `/api/v1/admin/kits/:id/feature` |
| POST | `/api/v1/admin/kits/:id/moderate` |
| POST | `/api/v1/admin/mirrors/:handle/grant` |
| GET | `/api/v1/admin/moderation` |
| GET | `/api/v1/admin/moderation/recent` |
| GET | `/api/v1/admin/reports` |
| POST | `/api/v1/admin/reports/:id/reopen` |
| POST | `/api/v1/admin/reports/:id/resolve` |
| POST | `/api/v1/admin/skills/:author/:slug/scan-override` |
| POST | `/api/v1/admin/skills/:id/feature` |
| POST | `/api/v1/admin/skills/:id/moderate` |
| POST | `/api/v1/admin/skills/:id/reverse` |
| GET | `/api/v1/admin/summons` |
| POST | `/api/v1/admin/users/:handle/suspend` |

## Approvals

| Method | Path |
| --- | --- |
| POST | `/api/v1/approvals` |
| POST | `/api/v1/approvals/all` |
| GET | `/api/v1/me/decisions` |
| GET | `/api/v1/me/removals` |
| GET | `/api/v1/me/updates` |
| POST | `/api/v1/rejections` |
| POST | `/api/v1/rejections/all` |
| POST | `/api/v1/removals` |

## Auth

| Method | Path |
| --- | --- |
| POST | `/api/v1/auth/logout` |
| POST | `/api/v1/auth/web/claim-github` 🔒 |
| POST | `/api/v1/auth/web/claim-github-bootstrap` 🔒 |
| POST | `/api/v1/claim` |
| GET | `/api/v1/devices` |
| PATCH | `/api/v1/devices/:device_id` |
| DELETE | `/api/v1/devices/:device_id` |
| POST | `/api/v1/devices/:device_id/revoke` |
| GET | `/api/v1/devices/:device_id/sync` |
| PUT | `/api/v1/devices/:device_id/sync` |
| POST | `/api/v1/devices/token` |
| POST | `/api/v1/sessions/dev` |
| POST | `/api/v1/signup` |
| GET | `/api/v1/whoami` |

## Author Keys

| Method | Path |
| --- | --- |
| GET | `/api/v1/auth/keys` |
| POST | `/api/v1/auth/keys` |
| DELETE | `/api/v1/auth/keys/:key_id` |
| GET | `/api/v1/auth/keys/nonce` |

## Availability

| Method | Path |
| --- | --- |
| GET | `/api/v1/me/availability` |
| DELETE | `/api/v1/me/availability` |
| POST | `/api/v1/sync/availability` |

## Connect Pair

| Method | Path |
| --- | --- |
| POST | `/api/v1/connect/claim` |
| POST | `/api/v1/connect/codes` |

## Connected Repos

| Method | Path |
| --- | --- |
| POST | `/api/v1/github/connect-token` |
| GET | `/api/v1/github/owned-repos` |
| GET | `/api/v1/github/repos` 🔒 |
| POST | `/api/v1/github/repos` 🔒 |
| DELETE | `/api/v1/github/repos/:id` 🔒 |
| POST | `/api/v1/github/repos/:id/refresh` 🔒 |

## Delegations

| Method | Path |
| --- | --- |
| GET | `/api/v1/authors/:handle/revoked-device-keys` |
| GET | `/api/v1/delegations` |
| POST | `/api/v1/delegations` |
| PATCH | `/api/v1/delegations/:device_key_id` |
| POST | `/api/v1/delegations/:device_key_id/revoke` |
| POST | `/api/v1/delegations/:device_key_id/revoke-session` |

## Device Agents

| Method | Path |
| --- | --- |
| PUT | `/api/v1/devices/:device_id/agents` |
| GET | `/api/v1/devices/:device_id/materializations` |
| PUT | `/api/v1/devices/:device_id/materializations` |

## Device Sync Stream

| Method | Path |
| --- | --- |
| GET | `/api/v1/devices/sync/stream` |

## Discover

| Method | Path |
| --- | --- |
| GET | `/api/v1/discover/feed` |
| GET | `/api/v1/discover/kits` |
| GET | `/api/v1/discover/people` |

## Email Login Code

| Method | Path |
| --- | --- |
| POST | `/api/v1/auth/login-code/send` |
| POST | `/api/v1/auth/login-code/verify` |

## Events

| Method | Path |
| --- | --- |
| POST | `/api/v1/events` |
| PUT | `/api/v1/me/activity` |
| GET | `/api/v1/me/events` |
| DELETE | `/api/v1/me/events` |
| GET | `/api/v1/me/route-usage` |

## Events Stream

| Method | Path |
| --- | --- |
| GET | `/api/v1/me/events/stream` |
| GET | `/api/v1/me/notifications/attention` |

## Follows

| Method | Path |
| --- | --- |
| POST | `/api/v1/follows` |
| DELETE | `/api/v1/follows` |
| GET | `/api/v1/me/feed` |
| GET | `/api/v1/me/followed-curations` |
| GET | `/api/v1/me/following` |
| GET | `/api/v1/me/suggestions` |
| GET | `/api/v1/profiles/:author/activity` |
| GET | `/api/v1/profiles/:author/adopters` |
| GET | `/api/v1/profiles/:author/followers` |
| GET | `/api/v1/profiles/:author/following` |

## Kit Members

| Method | Path |
| --- | --- |
| GET | `/api/v1/kits/:kitId/members` |
| POST | `/api/v1/kits/:kitId/members` |
| DELETE | `/api/v1/kits/:kitId/members` |

## Kit Subscriptions

| Method | Path |
| --- | --- |
| GET | `/api/v1/authors/:author/kit` |
| POST | `/api/v1/authors/:author/subscribe` |
| DELETE | `/api/v1/authors/:author/subscribe` |
| POST | `/api/v1/kits/:kitId/subscribe` |
| PATCH | `/api/v1/kits/:kitId/subscribe` |
| DELETE | `/api/v1/kits/:kitId/subscribe` |
| GET | `/api/v1/kits/mine` |
| GET | `/api/v1/subscriptions` |

## Kits

| Method | Path |
| --- | --- |
| POST | `/api/v1/kits` |
| GET | `/api/v1/kits/:kitId` |
| PATCH | `/api/v1/kits/:kitId` |
| POST | `/api/v1/kits/:kitId/publish` |
| GET | `/api/v1/kits/:kitId/related` |
| POST | `/api/v1/kits/:kitId/revert` |
| POST | `/api/v1/kits/:kitId/skills` |
| PATCH | `/api/v1/kits/:kitId/skills/:author/:slug` |
| DELETE | `/api/v1/kits/:kitId/skills/:author/:slug` |
| GET | `/api/v1/kits/:kitId/versions` |
| GET | `/api/v1/kits/by-handle/:owner/:slug` |
| POST | `/api/v1/me/library/skills` |

## Mcp

| Method | Path |
| --- | --- |
| GET | `/api/v1/mcp/link` |
| POST | `/api/v1/mcp/link/disable` |
| POST | `/api/v1/mcp/link/enable` |
| POST | `/api/v1/mcp/link/regenerate` |

## Mirror Queue

| Method | Path |
| --- | --- |
| GET | `/api/v1/admin/mirror-queue` |
| POST | `/api/v1/admin/mirror-queue` |
| POST | `/api/v1/admin/mirror-queue/:id/decide` |

## Moderation

| Method | Path |
| --- | --- |
| GET | `/api/v1/moderation` |

## Notifications

| Method | Path |
| --- | --- |
| GET | `/api/v1/me/notifications` |
| POST | `/api/v1/me/notifications/seen` |
| GET | `/api/v1/me/notifications/unread-count` |

## Openapi

| Method | Path |
| --- | --- |
| GET | `/api/v1/openapi.json` |

## Orgs

| Method | Path |
| --- | --- |
| GET | `/api/v1/orgs` |
| POST | `/api/v1/orgs` |
| POST | `/api/v1/orgs/:orgSlug/invites` |
| POST | `/api/v1/orgs/:orgSlug/invites/:inviteId/accept` |
| GET | `/api/v1/orgs/:orgSlug/members` |
| PATCH | `/api/v1/orgs/:orgSlug/members/:memberId` |
| DELETE | `/api/v1/orgs/:orgSlug/members/:memberId` |
| GET | `/api/v1/orgs/:orgSlug/skills` |
| GET | `/api/v1/orgs/invites` |

## Profiles

| Method | Path |
| --- | --- |
| POST | `/api/v1/authors/:handle/suggestions/copy` |
| GET | `/api/v1/authors/:handle/summon` |
| GET | `/api/v1/authors/:username` |
| GET | `/api/v1/authors/summon-demo` |
| POST | `/api/v1/profiles` |
| GET | `/api/v1/profiles/:author` |
| PATCH | `/api/v1/profiles/:author` |
| POST | `/api/v1/profiles/:author/avatar` |

## Proposals

| Method | Path |
| --- | --- |
| GET | `/api/v1/skills/:author/:slug/proposals` |
| POST | `/api/v1/skills/:author/:slug/proposals` |
| GET | `/api/v1/skills/:author/:slug/proposals/:proposalId` |
| POST | `/api/v1/skills/:author/:slug/proposals/:proposalId/decision` |

## Reports

| Method | Path |
| --- | --- |
| POST | `/api/v1/skills/:author/:slug/report` |

## Search

| Method | Path |
| --- | --- |
| GET | `/api/v1/search` |

## Server

| Method | Path |
| --- | --- |
| GET | `/api/hc` |

## Skills

| Method | Path |
| --- | --- |
| GET | `/api/v1/scanner/cache-stats` |
| GET | `/api/v1/skills` |
| POST | `/api/v1/skills` |
| GET | `/api/v1/skills/:author/:slug` |
| PATCH | `/api/v1/skills/:author/:slug/category` |
| POST | `/api/v1/skills/:author/:slug/deprecate` |
| GET | `/api/v1/skills/:author/:slug/diff` |
| GET | `/api/v1/skills/:author/:slug/download` |
| POST | `/api/v1/skills/:author/:slug/install` |
| GET | `/api/v1/skills/:author/:slug/installs/timeseries` |
| GET | `/api/v1/skills/:author/:slug/kits` |
| GET | `/api/v1/skills/:author/:slug/manifest` |
| POST | `/api/v1/skills/:author/:slug/undeprecate` |
| GET | `/api/v1/skills/:author/:slug/versions/:hash` |
| GET | `/api/v1/skills/:author/:slug/versions/:hash/download` |
| GET | `/api/v1/skills/:author/:slug/versions/:hash/file` |
| GET | `/api/v1/skills/:author/:slug/versions/:hash/files` |
| GET | `/api/v1/skills/:author/:slug/versions/:hash/files/*` |
| PATCH | `/api/v1/skills/:author/:slug/versions/:hash/notes` |
| GET | `/api/v1/skills/:author/:slug/versions/:hash/scan` |
| POST | `/api/v1/skills/:author/:slug/versions/:hash/unyank` |
| POST | `/api/v1/skills/:author/:slug/versions/:hash/yank` |
| POST | `/api/v1/skills/:author/:slug/visibility` |
| POST | `/api/v1/skills/scan` |
| GET | `/api/v1/skills/scan/batch` |

## Stats

| Method | Path |
| --- | --- |
| GET | `/api/v1/stats` |

## Sync

| Method | Path |
| --- | --- |
| GET | `/api/v1/sync/content/:content_hash` |
| GET | `/api/v1/sync/manifest` |

## Web Routes

| Method | Path |
| --- | --- |
| POST | `/api/v1/auth/link` 🔒 |
| DELETE | `/api/v1/auth/link` 🔒 |
| POST | `/api/v1/auth/web/session` 🔒 |
| POST | `/api/v1/auth/web/session/refresh` 🔒 |
