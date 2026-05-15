# API Runtime

## Decision

Use Next.js route handlers as the only server runtime.

Keep REST paths for the existing app surface under `/api/backend/*` so uploads,
downloads, and SSE streams keep their current behavior. Use oRPC for typed JSON
routes going forward.

Do not add tRPC. oRPC fits this app better because it has a Next route-handler
adapter, TanStack Query utilities, native File/Blob support, event iterators,
Better Auth patterns, and OpenAPI support.

## Current Shape

- `frontend/src/app/api/backend/[[...path]]/route.ts` mounts the old REST API
  surface in Next.
- `frontend/src/server/backend/**` contains the server code that used to live in
  the separate Express service.
- `frontend/src/app/rpc/[[...rest]]/route.ts` mounts oRPC.
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

- Supabase service-role access and S3/R2 signing are server-only.
- DOC/DOCX parsing can be CPU and memory heavy.
- DOC/DOCX to PDF conversion uses LibreOffice.
- Chat and tabular review streams need long-lived responses.
- Cloudflare Workers/OpenNext can run some routes, but LibreOffice and Worker
  CPU/memory limits make full parity unlikely.

## Migration Notes

- Express is removed.
- `NEXT_PUBLIC_API_BASE_URL` now defaults to `/api/backend`.
- Keep uploads, downloads, and SSE on direct route handlers until each has a
  typed oRPC equivalent that preserves streaming and binary behavior.
- Move simple JSON routes to oRPC first: user, projects, workflows, chat
  metadata, and tabular metadata.
- Move Better Auth only after deciding the same-origin auth route shape.
