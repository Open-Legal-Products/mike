import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { appRouter } from "@/server/rpc/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rpcHandler = new RPCHandler(appRouter, {
    interceptors: [
        onError((error) => {
            console.error("[orpc]", error);
        }),
    ],
});

async function handleRequest(request: Request) {
    const { response } = await rpcHandler.handle(request, {
        prefix: "/rpc",
        context: { request },
    });

    return response ?? new Response("Not found", { status: 404 });
}

export {
    handleRequest as DELETE,
    handleRequest as GET,
    handleRequest as HEAD,
    handleRequest as PATCH,
    handleRequest as POST,
    handleRequest as PUT,
};
