import express from "express";
import "./lib/asyncErrors";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { httpLogger } from "./middleware/httpLogger";
import { chatRouter } from "./routes/chat";
import { projectsRouter } from "./routes/projects";
import { projectChatRouter } from "./routes/projectChat";
import { documentsRouter } from "./routes/documents";
import { tabularRouter } from "./routes/tabular";
import { workflowsRouter } from "./routes/workflows";
import { userRouter } from "./routes/user";
import { downloadsRouter } from "./routes/downloads";
import { getAdminClient } from "./lib/supabase";
import { checkStorageReady } from "./lib/storage";
import { env } from "./lib/env";
import { sendError } from "./lib/http";

const isProduction = env.NODE_ENV === "production";

function minutes(value: number): number {
    return value * 60 * 1000;
}

function hours(value: number): number {
    return minutes(value * 60);
}

function makeLimiter(options: {
    windowMs: number;
    max: number;
    message?: string;
}) {
    return rateLimit({
        windowMs: options.windowMs,
        max: options.max,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => req.method === "OPTIONS",
        handler: (_req, res) => {
            sendError(
                res,
                429,
                "RATE_LIMITED",
                options.message ?? "Too many requests. Please try again later.",
            );
        },
    });
}

const generalLimiter = makeLimiter({
    windowMs: minutes(env.RATE_LIMIT_GENERAL_WINDOW_MINUTES),
    max: env.RATE_LIMIT_GENERAL_MAX,
});

const chatLimiter = makeLimiter({
    windowMs: minutes(env.RATE_LIMIT_CHAT_WINDOW_MINUTES),
    max: env.RATE_LIMIT_CHAT_MAX,
    message: "Too many chat requests. Please try again later.",
});

const chatCreateLimiter = makeLimiter({
    windowMs: minutes(env.RATE_LIMIT_CHAT_CREATE_WINDOW_MINUTES),
    max: env.RATE_LIMIT_CHAT_CREATE_MAX,
});

const uploadLimiter = makeLimiter({
    windowMs: hours(env.RATE_LIMIT_UPLOAD_WINDOW_HOURS),
    max: env.RATE_LIMIT_UPLOAD_MAX,
    message: "Too many upload requests. Please try again later.",
});

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY_HOPS);

app.use(httpLogger);

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'none'"],
                frameAncestors: ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: false,
        hsts: isProduction
            ? { maxAge: 15552000, includeSubDomains: true }
            : false,
        referrerPolicy: { policy: "no-referrer" },
    }),
);

app.use(
    cors({
        origin: env.FRONTEND_URL,
        credentials: true,
    }),
);

app.use(generalLimiter);

// 10 MB cap on JSON bodies. The API never legitimately receives larger payloads
// — documents are uploaded as multipart/form-data, not base64 in JSON.
app.use(express.json({ limit: "10mb" }));

app.post("/chat", chatLimiter);
app.post("/projects/:projectId/chat", chatLimiter);
app.post("/tabular-review/:reviewId/chat", chatLimiter);
app.post("/tabular-review/:reviewId/generate", chatLimiter);
app.post("/chat/create", chatCreateLimiter);
app.post("/chat/:chatId/generate-title", chatCreateLimiter);
app.post("/single-documents", uploadLimiter);
app.post("/single-documents/:documentId/versions", uploadLimiter);
app.post("/projects/:projectId/documents", uploadLimiter);

app.use("/chat", chatRouter);
app.use("/projects", projectsRouter);
app.use("/projects/:projectId/chat", projectChatRouter);
app.use("/single-documents", documentsRouter);
app.use("/tabular-review", tabularRouter);
app.use("/workflows", workflowsRouter);
app.use("/user", userRouter);
app.use("/users", userRouter);
app.use("/download", downloadsRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/ready", async (_req, res) => {
    const checks: Record<
        string,
        { ok: boolean; latencyMs?: number; error?: string }
    > = {};

    try {
        const t0 = Date.now();
        const { error } = await getAdminClient()
            .from("projects")
            .select("id")
            .limit(0);
        checks.db = error
            ? { ok: false, error: error.message }
            : { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
        checks.db = { ok: false, error: String(err) };
    }

    checks.storage = await checkStorageReady();

    const allOk = Object.values(checks).every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({ ok: allOk, checks });
});

app.use(
    (
        err: unknown,
        req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
    ) => {
        req.log?.error({ err }, "Unhandled request error");
        if (res.headersSent) return;
        sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
    },
);
