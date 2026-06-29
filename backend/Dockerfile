# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app

# LibreOffice is required for DOCX/DOC to PDF conversion.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice \
        default-jre-headless \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV HOME=/home/mike
ENV XDG_CACHE_HOME=/home/mike/.cache
ENV XDG_CONFIG_HOME=/home/mike/.config
ENV FONTCONFIG_CACHEDIR=/home/mike/.cache/fontconfig
# Agent step logs (override in backend/.env).
ENV AGENT_LOG_DIR=/app/logs
# Headless LibreOffice in containers (svp = no X11 display required).
ENV SAL_USE_VCLPLUGIN=svp
ENV SAL_DISABLE_OPENCL=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs --home /home/mike --no-create-home mike \
    && mkdir -p \
        /home/mike/.cache/dconf \
        /home/mike/.cache/fontconfig \
        /home/mike/.config \
    && chown -R mike:nodejs /home/mike

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD gosu mike node -e "fetch('http://127.0.0.1:3001/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
