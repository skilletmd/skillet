# @skillet/core-e2e

End-to-end suites that drive `@skillet/core` against a real `@skillet/registry`
server: device enrollment and delegation, session upload, share loops, and team
share loops.

## Why these do not live in `packages/core`

They used to. Because they need a live registry, `core` carried a
devDependency on `@skillet/registry` — and `registry` depends on `mcp`, which
depends on `core`. That closed a cycle:

```
core → registry → mcp → core
```

pnpm cannot order a cycle topologically, so it built those packages
concurrently and `mcp`'s `tsc` could start before `core` had emitted its `dist`,
failing with `Cannot find module '@skillet/core'`. It surfaced as flaky local
builds and a permanently red `docs-setup` workflow. Moving the suites into their
own package — which depends on both, and which nothing depends on — breaks the
cycle and lets `pnpm build` order the workspace properly.

## Running them

They need MySQL. The default matches `docker-compose.mysql.yml`
(`mysql://root:skillet@127.0.0.1:3307/skillet_core_e2e`) and is overridable with
`CORE_E2E_DATABASE_URL`. The suites TCP-probe the port first, so they skip
rather than hang when it is down.

```bash
docker compose -f ../../docker-compose.mysql.yml up -d   # or native MySQL on :3307

pnpm --filter @skillet/core-e2e test:mysql   # sets SKILLET_MYSQL_TESTS=1, then test:e2e
pnpm --filter @skillet/core-e2e test:e2e     # if you already exported it
```

There is deliberately no `test` script: `pnpm -r test` stays hermetic and does
not require a database, exactly as when these lived under `core/tests/e2e/`.

The suites use `node:test` rather than vitest because the `@skillet/registry`
import chain reaches `node:sqlite`, which vite's transformer mangles.
