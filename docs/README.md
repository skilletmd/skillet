# Skillet docs

Maintainer and operator documentation for the Skillet monorepo. Start here.

> **User-facing product docs** (CLI reference, install, publishing, safety, FAQ)
> are separate — they live in [`packages/web/content/docs/`](../packages/web/content/docs)
> and are served at `skillet.md/docs`. This folder is internal: how the system
> runs, its contracts, and its policies.

Repo-wide conventions and build reality are in the root
[CLAUDE.md](../CLAUDE.md); domain vocabulary in [CONCEPTS.md](../CONCEPTS.md).

## Guides

- [operating-a-registry.md](operating-a-registry.md) — run your own Skillet
  backend: processes, first deploy, and the ongoing operations (migrations, blob
  storage, the nightly mirror job, scanner backfill, security invariants).
- [private-kits.md](private-kits.md) — team onboarding for private kits: what a
  kit is, visibility, and how members join.

## Reference

- [registry-api.md](registry-api.md) — the full HTTP route map, generated from
  the Fastify registrations (`pnpm gen:registry-api`; `check:registry-api` fails
  if stale).
- [sync-times.md](sync-times.md) — the pull-based sync model and freshness: how
  and when devices pick up changes.
- [reference-stability-policy.md](reference-stability-policy.md) — published
  `@author/slug` refs and content hashes as permanent contracts: yank, alias
  redirect, and ban semantics.

## Policy and legal

- [security/content-security-policy.md](security/content-security-policy.md) —
  the web app's CSP: what it allows, and the enforce/report/off rollout.
- [legal/terms-of-service.md](legal/terms-of-service.md) — Terms of Service (draft).
- [legal/content-and-mirroring-policy.md](legal/content-and-mirroring-policy.md) —
  content and mirroring policy (draft).
- [legal/dmca-policy.md](legal/dmca-policy.md) — DMCA / copyright policy (draft).

## Brand

- [brand/illo-mascot-pack/](brand/illo-mascot-pack) — reproducible source for the
  Skillet mascot illustration packs (see the pack READMEs for the compositing
  workflow).

---

Everything in this folder is reference material contributors can use. Planning
artifacts, internal reports, and decision history do **not** live here — they go
to the maintainers' private repo. The `.gitignore` keeps `plans/`, `reports/`,
`solutions/`, and `internal/` untrackable so they cannot land here by accident.
