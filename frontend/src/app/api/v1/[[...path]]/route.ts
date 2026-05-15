import type { NextRequest } from "next/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { auth } from "@/server/backend/lib/auth";
import { appRouter } from "@/server/rpc/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ path?: string[] }> | { path?: string[] };
};

const rpcHandler = new RPCHandler(appRouter, {
    interceptors: [
        onError(function logRpcError(error) {
            console.error("[orpc]", error);
        }),
    ],
});

const openApiHandler = new OpenAPIHandler(appRouter, {
    interceptors: [
        onError(function logOpenApiError(error) {
            console.error("[orpc-openapi]", error);
        }),
    ],
});

async function handler(request: NextRequest, context: RouteContext) {
    const params = await context.params;
    const path = `/${params.path?.join("/") ?? ""}`;

    if (path === "/auth" || path.startsWith("/auth/")) {
        return auth.handler(request);
    }

    const rpcResult = await rpcHandler.handle(request.clone(), {
        prefix: "/api/v1",
        context: { request },
    });
    if (rpcResult.matched) {
        return rpcResult.response;
    }

    const openApiResult = await openApiHandler.handle(request, {
        prefix: "/api/v1",
        context: { request },
    });
    if (openApiResult.matched) {
        return openApiResult.response;
    }

    return new Response("Not Found", { status: 404 });
}

export {
    handler as DELETE,
    handler as GET,
    handler as HEAD,
    handler as PATCH,
    handler as POST,
    handler as PUT,
};
