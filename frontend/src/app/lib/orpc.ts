"use client";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterClient } from "@orpc/server";
import type { appRouter } from "@/server/rpc/router";

const link = new RPCLink({
    url: "/api/v1",
});

export const orpcClient: RouterClient<typeof appRouter> =
    createORPCClient(link);

export const orpc = createTanstackQueryUtils(orpcClient);
