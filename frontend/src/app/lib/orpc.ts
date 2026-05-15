"use client";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterClient } from "@orpc/server";
import { supabase } from "@/lib/supabase";
import type { appRouter } from "@/server/rpc/router";

const link = new RPCLink({
    url: "/rpc",
    headers: async () => {
        const {
            data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return {};
        return { Authorization: `Bearer ${session.access_token}` };
    },
});

export const orpcClient: RouterClient<typeof appRouter> =
    createORPCClient(link);

export const orpc = createTanstackQueryUtils(orpcClient);
