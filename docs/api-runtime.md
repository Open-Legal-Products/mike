# API Runtime

## Decision

Use Next.js route handlers as the only server runtime.

Use `/api/v1/*` as the single API entrypoint. oRPC owns that entrypoint.

Do not add tRPC. oRPC fits this app better because it has a Next route-handler
adapter, TanStack Query utilities, native File/Blob support, event iterators,
Better Auth patterns, and OpenAPI support.

## Current Shape

- `frontend/src/app/api/v1/[[...path]]/route.ts` runs the oRPC handler.
- Better Auth is mounted at `/api/v1/auth/*`.
- Existing HTTP paths are matched by oRPC OpenAPI routes under
  `frontend/src/server/rpc/router.ts`.
- `frontend/src/server/backend/**` contains the server code that used to live in
  the separate Express service.
- `frontend/src/server/rpc/router.ts` starts the typed API with user profile and
  API-key status procedures.
- `frontend/src/app/lib/orpc.ts` creates the browser oRPC client and TanStack
  Query helpers.

## TanStack Query Pattern

Wrap the app with `QueryClientProvider` once in `frontend/src/components/providers.tsx`.

For typed oRPC reads:

```tsx
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/app/lib/orpc";

function AccountHeader() {
    const profile = useQuery(orpc.user.profile.queryOptions());
    return profile.data?.displayName ?? null;
}
```

For writes:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/app/lib/orpc";

function useUpdateProfile() {
    const queryClient = useQueryClient();
    return useMutation(
        orpc.user.updateProfile.mutationOptions({
            onSuccess() {
                void queryClient.invalidateQueries(
                    orpc.user.profile.queryOptions(),
                );
            },
        }),
    );
}
```

## Runtime Constraints

This app must run the API on the Node.js runtime.

Reasons:

- Better Auth, Postgres access, and S3/R2 signing are server-only.
- DOC/DOCX parsing can be CPU and memory heavy.
- DOC/DOCX to PDF conversion uses LibreOffice.
- Chat and tabular review streams need long-lived responses.
- Cloudflare Workers/OpenNext can run some routes, but LibreOffice and Worker
  CPU/memory limits make full parity unlikely.

## Migration Notes

- Express is removed.
- `NEXT_PUBLIC_API_BASE_URL` now defaults to `/api/v1`.
- `/api/backend` and `/rpc` are removed.
- Do not add non-oRPC API fallbacks under `/api/v1`.
- Keep API routes on the Node.js runtime.
