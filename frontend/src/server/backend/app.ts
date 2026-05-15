import type { NextRequest } from "next/server";
import { chatRouter } from "./routes/chat";
import { projectsRouter } from "./routes/projects";
import { projectChatRouter } from "./routes/projectChat";
import { documentsRouter } from "./routes/documents";
import { tabularRouter } from "./routes/tabular";
import { workflowsRouter } from "./routes/workflows";
import { userRouter } from "./routes/user";
import { downloadsRouter } from "./routes/downloads";
import {
    createQuery,
    Request,
    Response as CompatResponse,
    type RequestHandler,
    type Router,
} from "./http/compat";

type MountedRoute = {
    method: string;
    pattern: string;
    handlers: RequestHandler[];
};

const mountedRoutes: MountedRoute[] = [];

function joinPath(prefix: string, path: string): string {
    const joined = `${prefix.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    return joined === "/" ? "/" : joined.replace(/\/$/, "");
}

function mount(prefix: string, router: Router): void {
    for (const route of router.routes) {
        mountedRoutes.push({
            method: route.method,
            pattern: joinPath(prefix, route.path),
            handlers: route.handlers,
        });
    }
}

mount("/chat", chatRouter);
mount("/projects", projectsRouter);
mount("/projects/:projectId/chat", projectChatRouter);
mount("/single-documents", documentsRouter);
mount("/tabular-review", tabularRouter);
mount("/workflows", workflowsRouter);
mount("/user", userRouter);
mount("/users", userRouter);
mount("/download", downloadsRouter);

function matchPath(
    pattern: string,
    path: string,
): Record<string, string> | null {
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);
    if (patternParts.length !== pathParts.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i += 1) {
        const expected = patternParts[i];
        const actual = pathParts[i];
        if (expected?.startsWith(":")) {
            params[expected.slice(1)] = decodeURIComponent(actual ?? "");
        } else if (expected !== actual) {
            return null;
        }
    }
    return params;
}

async function parseBody(request: NextRequest): Promise<unknown> {
    if (request.method === "GET" || request.method === "HEAD") return {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) return {};
    if (!contentType.includes("application/json")) return {};

    const text = await request.text();
    if (!text.trim()) return {};
    return JSON.parse(text);
}

async function runHandlers(
    handlers: RequestHandler[],
    req: Request,
    res: CompatResponse,
): Promise<void> {
    let index = -1;

    async function dispatch(nextIndex: number, err?: unknown): Promise<void> {
        if (err) throw err;
        if (nextIndex <= index) throw new Error("next() called twice");
        index = nextIndex;
        const handler = handlers[nextIndex];
        if (!handler) return;
        let nextPromise: Promise<void> | null = null;
        await handler(req, res, (nextErr?: unknown) => {
            nextPromise = dispatch(nextIndex + 1, nextErr);
        });
        if (nextPromise) await nextPromise;
    }

    await dispatch(0);
}

export async function handleBackendRequest(
    request: NextRequest,
    path: string,
): Promise<globalThis.Response> {
    const normalizedPath = path === "" ? "/" : path.replace(/\/$/, "") || "/";

    if (request.method === "GET" && normalizedPath === "/health") {
        return Response.json({ ok: true });
    }

    const route = mountedRoutes.find((candidate) => {
        return (
            candidate.method === request.method &&
            matchPath(candidate.pattern, normalizedPath)
        );
    });

    if (!route) {
        return Response.json({ detail: "Not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const params = matchPath(route.pattern, normalizedPath) ?? {};
    const req = new Request(request, {
        body: await parseBody(request),
        params,
        query: createQuery(url.searchParams),
    });
    const res = new CompatResponse();

    const runPromise = runHandlers(route.handlers, req, res);
    const complete = Symbol("complete");
    const result = await Promise.race([
        res.waitForStreamResponse(),
        runPromise.then(() => complete),
    ]);

    if (result !== complete) {
        runPromise.catch((err) => {
            console.error("[backend] streamed route failed", err);
        });
        return result as globalThis.Response;
    }

    try {
        await runPromise;
    } catch (err) {
        console.error("[backend] route failed", err);
        return Response.json(
            { detail: err instanceof Error ? err.message : "Request failed" },
            { status: 500 },
        );
    }

    return res.toNextResponse();
}
