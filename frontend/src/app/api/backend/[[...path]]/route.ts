import type { NextRequest } from "next/server";
import { handleBackendRequest } from "@/server/backend/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ path?: string[] }> | { path?: string[] };
};

async function handler(request: NextRequest, context: RouteContext) {
    const params = await context.params;
    const path = `/${params.path?.join("/") ?? ""}`;
    return handleBackendRequest(request, path);
}

export {
    handler as DELETE,
    handler as GET,
    handler as PATCH,
    handler as POST,
    handler as PUT,
};
