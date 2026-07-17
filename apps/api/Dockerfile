FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies separately from source so Docker can cache this layer.
# The monorepo root package.json and workspace manifests must all be present
# before `npm install` runs, but the actual source is copied afterwards.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/sdk-js/package.json ./packages/sdk-js/

RUN npm ci --workspace=apps/api --workspace=packages/core --workspace=packages/api-client --workspace=packages/sdk-js --ignore-scripts

# ── Development stage ──────────────────────────────────────────────────────
FROM base AS dev
COPY . .
EXPOSE 3001
CMD ["npx", "--prefix", "apps/api", "tsx", "watch", "apps/api/src/index.ts"]

# ── Production build stage ─────────────────────────────────────────────────
FROM base AS build
COPY . .
RUN npm run build --workspace=apps/api

# ── Production runtime stage ───────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "dist/apps/api/src/index.js"]

# ── Air-gapped runtime ─────────────────────────────────────────────────────
# Adds LibreOffice (+fonts) so DOCX→PDF conversion works offline — lib/convert.ts
# shells out to `soffice`, which the lean image lacks (conversion silently no-ops
# today). Also bundles the SQL migrations + runner so the `migrate` init
# container applies them with no CLI. Build target: mike-api:airgapped.
FROM production AS production-airgapped
USER root
RUN apk add --no-cache \
        libreoffice \
        ttf-dejavu ttf-liberation font-noto \
    && rm -rf /var/cache/apk/*
# Migration runner + ordered SQL for the migrate init container.
COPY apps/api/scripts/migrate.mjs ./apps/api/scripts/migrate.mjs
COPY supabase/migrations ./supabase/migrations
CMD ["node", "dist/apps/api/src/index.js"]
