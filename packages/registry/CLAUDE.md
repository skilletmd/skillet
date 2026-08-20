# packages/registry

Fastify + Prisma/MySQL API. Root [CLAUDE.md](../../CLAUDE.md) has the
repo-wide invariants; these are registry-specific.

- **Test runner is `node --test`, not vitest**, with an explicit file list in
  the `test` script — a new test file must be added to that list or it never
  runs. Live MySQL suites skip unless `SKILLET_MYSQL_TESTS=1` (use
  `pnpm test:mysql` after Docker compose on `:3307` or native MySQL on `:3306`).
  Default `pnpm test` stays hermetic for pre-commit without Docker.
  `tests/scrub-env.mjs` is preloaded to keep the suite hermetic against
  dev-shell `SKILLET_*` exports.
- **Never point tests at a database you care about** — `resetMysqlRegistry`
  truncates every table. Use a dedicated test database.
- **Identity value spaces:** `authors.id` is a handle string (superset of
  users: org slugs, unclaimed mirror brands); `users.id` is a UUID. The
  invariant is carried by branded types (`Handle`/`UserId`) in
  `src/auth/identity.ts` — construct them through the smart constructors at
  the DB boundary, don't cast.
- **Version ordinals are derived, not stored:** `versionOrdinal()` orders by
  `(published_at, rowid)`. The ordinal is embedded in signed Ed25519
  attestations (`platform-signing.ts`), so anything touching version order is
  a signature-compatibility change.
- **Consent invariant:** every sync-manifest source must be covered by
  `pendingTargetsPrisma` (`src/lib/pending-update-targets.ts`) except
  self-authored skills. `tests/consent-coverage.test.ts` enforces it — when
  adding a manifest source, seed it there and extend the queue in the same PR.
- Schema changes go through Prisma migrations; never edit applied migrations.
- **After a scanner corpus-version bump** (`DETECTOR_CORPUS_VERSION` in
  `src/scanner/cache.ts` or `CAPABILITY_VERSION` in
  `src/scanner/capabilities/scan.ts`), run `pnpm --filter @skillet/registry
  backfill:scans` to refresh already-published rows. Sync only re-scans on
  content change, so a bump reaches existing content only via this job. Each
  `skill_version_scans` row stamps both lane versions
  (`detector_corpus_version`, `capabilities_version`); the backfill re-scans any
  row behind current. Use `--dry-run` to size it, `--all` to force every row.
