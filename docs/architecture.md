# Architecture

Mike is organized as a monorepo with deployable apps in `apps/` and reusable
libraries in `packages/`.

## Layers

- `packages/core` contains framework-free contracts, shared domain types, and
  portable utilities. It must not import from apps.
- `packages/api-client` contains the typed HTTP client used by the web app and
  SDKs.
- `packages/sdk-js` exposes the public JavaScript SDK facade.
- `apps/api` owns HTTP routing, authentication, persistence, document
  processing, and provider integrations.
- `apps/web` owns the Next.js user interface.

Dependencies should point inward:

```text
apps/web  -> packages/api-client -> packages/core
apps/api  -> packages/core
sdk-js    -> packages/api-client -> packages/core
```

## API Modules

API route implementations live under `apps/api/src/modules/<feature>`.
Compatibility exports remain under `apps/api/src/routes` so the server entry
point stays small and stable. New backend behavior should move business logic
into `*.service.ts` files and database access into `*.repository.ts` files.
