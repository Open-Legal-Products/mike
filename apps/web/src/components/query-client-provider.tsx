"use client";

import { useState } from "react";
import {
    QueryClient,
    QueryClientProvider as TanstackQueryClientProvider,
} from "@tanstack/react-query";

/**
 * App-wide React Query provider (TECH_DUE_DILIGENCE §4.2 request-caching layer).
 *
 * The QueryClient is created with `useState(() => …)` so it is a single stable
 * instance per browser session — the standard Next.js App Router pattern that
 * avoids sharing a client across requests on the server while keeping one
 * client across re-renders on the client.
 */
export function QueryClientProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 30_000, // 30s: treat reads as fresh briefly
                        gcTime: 5 * 60_000, // 5min before unused cache is dropped
                        refetchOnWindowFocus: false,
                        retry: 1,
                    },
                },
            }),
    );

    return (
        <TanstackQueryClientProvider client={queryClient}>
            {children}
        </TanstackQueryClientProvider>
    );
}
