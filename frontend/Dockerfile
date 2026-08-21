# Build context is the REPO ROOT (see docker-compose.yml): the frontend
# type-imports from backend/src (e.g. shared/types.ts pulls AskInputsEvent
# from backend/src/lib/chat/types), so a frontend-only context makes those
# unions silently collapse and `next build`'s type check fails. Only the
# backend's *sources* are copied — nothing from backend lands in the bundle;
# the imports are `import type` and erased at compile time.
FROM node:22-slim

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY backend/src /backend/src

# NEXT_PUBLIC_* are inlined at build time, so they must be present during `next build`.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
