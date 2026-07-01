import express from "express";
import "./lib/asyncErrors";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { httpLogger } from "./middleware/httpLogger";
import { chatRouter } from "./modules/chat/chat.routes";
import { projectsRouter } from "./modules/projects/projects.routes";
import { projectChatRouter } from "./modules/project-chat/projectChat.routes";
import { documentsRouter } from "./modules/documents/documents.routes";
import { tabularRouter } from "./modules/tabular/tabular.routes";
import { workflowsRouter } from "./modules/workflows/workflows.routes";
import { userRouter } from "./modules/user/user.routes";
import { downloadsRouter } from "./modules/downloads/downloads.routes";
import { caseLawRouter } from "./modules/case-law/caseLaw.routes";
import { getAdminClient } from "./lib/supabase";
import { checkStorageReady } from "./lib/storage";
import { env } from "./lib/env";
import { sendError } from "./lib/http";
import { setupSentryErrorHandler } from "./lib/observability/sentry";

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

// Data export / deletion are expensive and privacy-sensitive operations, so
// they get their own conservative hourly caps independent of the general limit.
const exportLimiter = makeLimiter({
    windowMs: hours(1),
    max: 10,
    message: "Too many export requests. Please try again later.",
});

const dataDeleteLimiter = makeLimiter({
    windowMs: hours(1),
    max: 20,
    message: "Too many data deletion requests. Please try again later.",
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
                baseUri: ["'none'"],
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

// The Office.js add-in (Word task pane) runs at https://localhost:3000 during
// development — office-addin tooling forces HTTPS even locally, so the HTTPS
// variant must be allowed alongside the regular frontend origin. This dev-only
// origin is deliberately excluded in production so a localhost origin never
// ships in the prod allowlist; env.FRONTEND_URL is always allowed.
const allowedOrigins = new Set<string>([
    env.FRONTEND_URL,
    ...(isProduction ? [] : ["https://localhost:3000"]),
]);

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow server-to-server requests (no Origin header) and any
            // explicitly listed origin. A disallowed origin resolves to `false`
            // (cors omits the Access-Control-Allow-Origin header and the browser
            // blocks the response) rather than calling back with an Error —
            // throwing here would propagate to Express's default handler and turn
            // every disallowed cross-origin request, including preflight, into an
            // HTTP 500.
            callback(null, !origin || allowedOrigins.has(origin));
        },
        credentials: true,
        allowedHeaders: ["Authorization", "Content-Type"],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
app.put(
    "/single-documents/:documentId/versions/:versionId/file",
    uploadLimiter,
);
app.post("/projects/:projectId/documents", uploadLimiter);
app.get("/user/export", exportLimiter);
app.get("/user/chats/export", exportLimiter);
app.get("/user/tabular-reviews/export", exportLimiter);
app.delete("/user/account", dataDeleteLimiter);
app.delete("/user/chats", dataDeleteLimiter);
app.delete("/user/projects", dataDeleteLimiter);
app.delete("/user/tabular-reviews", dataDeleteLimiter);

app.use("/chat", chatRouter);
app.use("/projects", projectsRouter);
app.use("/projects/:projectId/chat", projectChatRouter);
app.use("/single-documents", documentsRouter);
app.use("/tabular-review", tabularRouter);
app.use("/workflows", workflowsRouter);
app.use("/user", userRouter);
app.use("/users", userRouter);
app.use("/download", downloadsRouter);
app.use("/case-law", caseLawRouter);

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

// Sentry's Express error handler must run after all routes but before the
// app's own central error handler, so Sentry records the error first and then
// delegates to the handler below. No-op when SENTRY_DSN is unset.
setupSentryErrorHandler(app);

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
