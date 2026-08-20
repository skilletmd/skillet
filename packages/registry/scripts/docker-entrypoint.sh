#!/bin/sh
# Apply pending Prisma migrations before serving traffic. Deploy used to ship
# code that queried tables (e.g. muted_team_kits) without running migrate deploy,
# which made /sync/manifest return opaque 500s while /api/hc stayed green.
set -eu

SCHEMA="/app/packages/registry/prisma/schema.prisma"
PRISMA_BIN="/app/node_modules/.bin/prisma"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "docker-entrypoint: DATABASE_URL is required" >&2
  exit 1
fi

if [ ! -x "$PRISMA_BIN" ]; then
  echo "docker-entrypoint: prisma CLI missing at $PRISMA_BIN" >&2
  exit 1
fi

if [ ! -f "$SCHEMA" ]; then
  echo "docker-entrypoint: schema missing at $SCHEMA" >&2
  exit 1
fi

echo "docker-entrypoint: prisma migrate deploy"
"$PRISMA_BIN" migrate deploy --schema="$SCHEMA"

exec node /app/packages/registry/dist/main.js
