FROM node:24-alpine AS builder

RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace manifests for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm.config.yaml tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/registry/package.json ./packages/registry/

# Install all workspace deps (protocol + registry)
RUN pnpm install --frozen-lockfile --filter @skillet/registry...

# Build protocol first (registry depends on it)
COPY packages/protocol/ ./packages/protocol/
RUN pnpm --filter @skillet/protocol build

# Build registry
COPY packages/registry/ ./packages/registry/
RUN pnpm --filter @skillet/registry build

# ---- Runtime image ----
FROM node:24-alpine

WORKDIR /app

# Copy built artifacts and production node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=builder /app/packages/protocol/package.json ./packages/protocol/
COPY --from=builder /app/packages/registry/dist ./packages/registry/dist
COPY --from=builder /app/packages/registry/package.json ./packages/registry/
# Schema + migrations so the entrypoint can run `prisma migrate deploy` before listen.
COPY --from=builder /app/packages/registry/prisma ./packages/registry/prisma
COPY packages/registry/scripts/docker-entrypoint.sh /app/packages/registry/scripts/docker-entrypoint.sh
RUN chmod +x /app/packages/registry/scripts/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3481
ENV HOST=0.0.0.0
# Relational storage is MySQL via DATABASE_URL (Prisma). Do not set REGISTRY_DB_PATH.

EXPOSE 3481

ENTRYPOINT ["/app/packages/registry/scripts/docker-entrypoint.sh"]
