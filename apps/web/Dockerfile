FROM node:22-alpine AS base
WORKDIR /app

# Next.js phones home to Vercel at build/run; disable it everywhere (required for
# air-gap, harmless otherwise).
ENV NEXT_TELEMETRY_DISABLED=1

# Copy manifests first to get a cacheable dependency layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/sdk-js/package.json ./packages/sdk-js/

RUN npm ci --workspace=apps/web --workspace=packages/core --workspace=packages/api-client --workspace=packages/sdk-js --ignore-scripts

# ── Development stage ──────────────────────────────────────────────────────
FROM base AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--prefix", "apps/web"]

# ── Production build stage ─────────────────────────────────────────────────
FROM base AS build
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY . .
RUN npm run build --prefix apps/web

# ── Production runtime stage ───────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

COPY --from=build /app/apps/web/.next ./.next
COPY --from=build /app/apps/web/public ./public
COPY --from=build /app/apps/web/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules

EXPOSE 3000
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["node_modules/.bin/next", "start"]
