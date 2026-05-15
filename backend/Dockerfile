FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx tsc

FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001
# LibreOffice is required for DOC/DOCX → PDF conversion.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libreoffice \
        fontconfig \
        fonts-dejavu \
        wget \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd -r -g 1001 nodejs && useradd -r -m -u 1001 -g nodejs mike
COPY --from=prod-deps --chown=mike:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=mike:nodejs /app/dist ./dist
COPY --chown=mike:nodejs package.json ./
COPY --chown=mike:nodejs drizzle ./drizzle
USER mike
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3001/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
