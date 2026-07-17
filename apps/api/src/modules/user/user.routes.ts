import crypto from "crypto";
import { Router } from "express";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import { normalizeApiKeyProvider } from "../../lib/userApiKeys";
import { completeUserMcpConnectorOAuth } from "../../lib/mcpConnectors";
import {
    completeDmsConnectorOAuth,
    startDmsConnectorOAuth,
} from "../../lib/dmsConnectors";
import { userExportFilename } from "../../lib/userDataExport";
import {
    bootstrapUserProfile,
    createDmsConnector,
    createMcpConnector,
    deleteDmsConnector,
    deleteMcpConnector,
    deleteUserAccount,
    deleteUserChats,
    deleteUserProjectsData,
    deleteUserTabularReviews,
    errorMessage,
    exportUserAccount,
    exportUserChats,
    exportUserTabularReviews,
    getApiKeyStatus,
    getDmsConnector,
    getMcpConnector,
    getUserProfile,
    lookupUserByEmail,
    importDmsDocument,
    listDmsConnectors,
    listMcpConnectors,
    readBooleanBodyField,
    refreshMcpConnectorTools,
    saveApiKey,
    searchDmsConnector,
    setMcpToolEnabled,
    setMfaOnLogin,
    startMcpConnectorOAuth,
    syncDmsConnector,
    updateDmsConnector,
    updateMcpConnector,
    updateUserProfile,
    validateProfilePayload,
} from "./user.service";

export const userRouter = Router();

function backendPublicUrl(req: {
    protocol: string;
    get(name: string): string | undefined;
}) {
    return (
        process.env.API_PUBLIC_URL ||
        process.env.BACKEND_URL ||
        `${req.protocol}://${req.get("host")}`
    ).replace(/\/+$/, "");
}

function frontendUrl(path = "/account/connectors") {
    const base = (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(
        /\/+$/,
        "",
    );
    return `${base}${path}`;
}

function shortHash(value: string) {
    return value
        ? crypto.createHash("sha256").update(value).digest("hex").slice(0, 12)
        : null;
}

function mcpOAuthPopupHtml(payload: {
    success: boolean;
    connectorId?: string;
    detail?: string;
}, nonce: string) {
    const targetOrigin = new URL(frontendUrl()).origin;
    const targetUrl = frontendUrl();
    const message = JSON.stringify({
        type: "mcp_oauth_result",
        ...payload,
    });
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MCP authorization</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
      main { max-width: 360px; padding: 24px; text-align: center; }
      p { color: #6b7280; }
    </style>
  </head>
  <body>
    <main>
      <h1>${payload.success ? "Authorization complete" : "Authorization failed"}</h1>
      <p>${payload.success ? "You can return to Mike." : "Return to Mike and try connecting again."}</p>
    </main>
    <script nonce="${nonce}">
      const message = ${message};
      const targetUrl = ${JSON.stringify(targetUrl)};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, ${JSON.stringify(targetOrigin)});
      }
      setTimeout(() => window.close(), ${payload.success ? 600 : 2500});
      ${
          payload.success
              ? "setTimeout(() => window.location.assign(targetUrl), 1000);"
              : ""
      }
    </script>
  </body>
</html>`;
}

function mcpOAuthPopupCsp(nonce: string) {
    return [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    ].join("; ");
}

// POST /user/profile
userRouter.post("/profile", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await bootstrapUserProfile(db, userId);
    if (!result.ok) return void res.status(500).json({ detail: result.detail });
    res.json({ ok: true });
});

// GET /user/lookup?email=person@example.com
userRouter.get("/lookup", requireAuth, async (req, res) => {
    const email = typeof req.query.email === "string" ? req.query.email : "";
    if (!email.trim()) {
        return void res.status(400).json({ detail: "email is required" });
    }

    const db = createServerSupabase();
    res.json(await lookupUserByEmail(db, email));
});

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await getUserProfile(db, userId);
    if (!result.ok) return void res.status(500).json({ detail: result.detail });
    res.json(result.body);
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const parsed = validateProfilePayload(req.body);
    if (!parsed.ok) return void res.status(400).json({ detail: parsed.detail });

    const db = createServerSupabase();
    const result = await updateUserProfile(db, userId, parsed.update);
    if (!result.ok) return void res.status(500).json({ detail: result.detail });
    res.json(result.body);
});

// PATCH /user/security/mfa-login
userRouter.patch(
    "/security/mfa-login",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const parsed = readBooleanBodyField(req.body, "enabled");
        if (!parsed.ok)
            return void res.status(400).json({ detail: parsed.detail });

        const db = createServerSupabase();
        const result = await setMfaOnLogin(db, userId, parsed.value);
        if (!result.ok) {
            if (result.kind === "no_factor")
                return void res.status(400).json({ detail: result.detail });
            return void res.status(500).json({ detail: result.detail });
        }
        res.json(result.body);
    },
);

// GET /user/api-keys
userRouter.get("/api-keys", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const status = await getApiKeyStatus(db, userId);
    res.json(status);
});

// PUT /user/api-keys/:provider
userRouter.put(
    "/api-keys/:provider",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const provider = normalizeApiKeyProvider(req.params.provider);
        if (!provider)
            return void res
                .status(400)
                .json({ detail: "Unsupported provider" });

        const apiKey =
            typeof req.body?.api_key === "string" ? req.body.api_key : null;
        const db = createServerSupabase();
        const result = await saveApiKey(
            db,
            { userId, provider, apiKey },
            req.log,
        );
        if (!result.ok) {
            if (result.kind === "env_configured")
                return void res.status(409).json({
                    detail: "This provider is configured by the server environment and cannot be changed from the browser.",
                });
            return void res.status(500).json({ detail: result.detail });
        }
        res.json(result.status);
    },
);

// GET /user/mcp-connectors
userRouter.get("/mcp-connectors", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listMcpConnectors(db, userId);
    if (!result.ok) return void res.status(500).json({ detail: result.detail });
    res.json(result.connectors);
});

// GET /user/mcp-connectors/:connectorId
userRouter.get(
    "/mcp-connectors/:connectorId",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await getMcpConnector(
            db,
            userId,
            req.params.connectorId,
            req.log,
        );
        if (!result.ok)
            return void res.status(404).json({ detail: result.detail });
        res.json(result.connector);
    },
);

// POST /user/mcp-connectors
userRouter.post(
    "/mcp-connectors",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const name = typeof req.body?.name === "string" ? req.body.name : "";
        const serverUrl =
            typeof req.body?.serverUrl === "string" ? req.body.serverUrl : "";
        const bearerToken =
            typeof req.body?.bearerToken === "string"
                ? req.body.bearerToken
                : null;
        const headers =
            req.body?.headers &&
            typeof req.body.headers === "object" &&
            !Array.isArray(req.body.headers)
                ? (req.body.headers as Record<string, unknown>)
                : undefined;
        const db = createServerSupabase();
        const result = await createMcpConnector(
            db,
            userId,
            { name, serverUrl, bearerToken, headers },
            req.log,
        );
        if (!result.ok)
            return void res.status(400).json({ detail: result.detail });
        res.status(201).json(result.connector);
    },
);

// PATCH /user/mcp-connectors/:connectorId
userRouter.patch(
    "/mcp-connectors/:connectorId",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const body = req.body ?? {};
        const result = await updateMcpConnector(
            db,
            userId,
            req.params.connectorId,
            {
                ...(typeof body.name === "string" ? { name: body.name } : {}),
                ...(typeof body.serverUrl === "string"
                    ? { serverUrl: body.serverUrl }
                    : {}),
                ...(typeof body.enabled === "boolean"
                    ? { enabled: body.enabled }
                    : {}),
                ...("bearerToken" in body
                    ? {
                          bearerToken:
                              typeof body.bearerToken === "string"
                                  ? body.bearerToken
                                  : null,
                      }
                    : {}),
                ...("headers" in body
                    ? {
                          headers:
                              body.headers &&
                              typeof body.headers === "object" &&
                              !Array.isArray(body.headers)
                                  ? (body.headers as Record<string, unknown>)
                                  : {},
                      }
                    : {}),
            },
            req.log,
        );
        if (!result.ok)
            return void res.status(400).json({ detail: result.detail });
        res.json(result.connector);
    },
);

// DELETE /user/mcp-connectors/:connectorId
userRouter.delete(
    "/mcp-connectors/:connectorId",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await deleteMcpConnector(
            db,
            userId,
            req.params.connectorId,
            req.log,
        );
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.status(204).send();
    },
);

// POST /user/mcp-connectors/:connectorId/oauth/start
userRouter.post(
    "/mcp-connectors/:connectorId/oauth/start",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const redirectUri = `${backendPublicUrl(req)}/user/mcp-connectors/oauth/callback`;
        const result = await startMcpConnectorOAuth(
            db,
            userId,
            req.params.connectorId,
            redirectUri,
            req.log,
        );
        if (!result.ok)
            return void res.status(400).json({ detail: result.detail });
        res.json(result.result);
    },
);

// GET /user/mcp-connectors/oauth/callback
userRouter.get("/mcp-connectors/oauth/callback", async (req, res) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const error =
        typeof req.query.error === "string" ? req.query.error : undefined;
    const db = createServerSupabase();
    try {
        if (error) throw new Error(error);
        if (!state || !code)
            throw new Error("OAuth callback is missing state or code.");
        const result = await completeUserMcpConnectorOAuth(state, code, db);
        res.set("Content-Security-Policy", mcpOAuthPopupCsp(nonce))
            .type("html")
            .send(
                mcpOAuthPopupHtml(
                    {
                        success: true,
                        connectorId: result.connectorId,
                    },
                    nonce,
                ),
            );
    } catch (err) {
        const detail = errorMessage(err);
        req.log.error(
            {
                error: detail,
                stateHash: shortHash(state),
                hasCode: !!code,
                hasError: !!error,
                issuer:
                    typeof req.query.iss === "string"
                        ? req.query.iss
                        : undefined,
                scope:
                    typeof req.query.scope === "string"
                        ? req.query.scope
                        : undefined,
            },
            "[user/mcp-connectors] oauth callback failed",
        );
        res.status(400)
            .set("Content-Security-Policy", mcpOAuthPopupCsp(nonce))
            .type("html")
            .send(mcpOAuthPopupHtml({ success: false, detail }, nonce));
    }
});

// POST /user/mcp-connectors/:connectorId/refresh-tools
userRouter.post(
    "/mcp-connectors/:connectorId/refresh-tools",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await refreshMcpConnectorTools(
            db,
            userId,
            req.params.connectorId,
            req.log,
        );
        if (!result.ok) {
            if (result.kind === "oauth_required")
                return void res.status(401).json({
                    code: result.code,
                    detail: result.detail,
                });
            return void res.status(400).json({ detail: result.detail });
        }
        res.json(result.connector);
    },
);

// PATCH /user/mcp-connectors/:connectorId/tools/:toolId
userRouter.patch(
    "/mcp-connectors/:connectorId/tools/:toolId",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const parsed = readBooleanBodyField(req.body, "enabled");
        if (!parsed.ok)
            return void res.status(400).json({ detail: parsed.detail });

        const db = createServerSupabase();
        const result = await setMcpToolEnabled(
            db,
            userId,
            req.params.connectorId,
            req.params.toolId,
            parsed.value,
            req.log,
        );
        if (!result.ok)
            return void res.status(400).json({ detail: result.detail });
        res.json(result.connector);
    },
);

// ---------------------------------------------------------------------------
// DMS connectors (R3 — iManage / NetDocuments). Same auth posture as the MCP
// connector routes: requireAuth on reads, requireAuth + requireMfaIfEnrolled on
// writes. The OAuth callback is unauthenticated (the DMS redirects the browser
// to it) and validated by the one-time state token.
// ---------------------------------------------------------------------------

// GET /user/dms-connectors
userRouter.get("/dms-connectors", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listDmsConnectors(db, userId, req.log);
    if (!result.ok) return void res.status(500).json({ detail: result.detail });
    res.json(result.connectors);
});

// GET /user/dms-connectors/:connectorId
userRouter.get(
    "/dms-connectors/:connectorId",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await getDmsConnector(
            db,
            userId,
            req.params.connectorId,
            req.log,
        );
        if (!result.ok)
            return void res.status(404).json({ detail: result.detail });
        res.json(result.connector);
    },
);

// POST /user/dms-connectors
userRouter.post(
    "/dms-connectors",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const kind = typeof req.body?.kind === "string" ? req.body.kind : "";
        const name = typeof req.body?.name === "string" ? req.body.name : "";
        const baseUrl =
            typeof req.body?.baseUrl === "string" ? req.body.baseUrl : "";
        const config =
            req.body?.config &&
            typeof req.body.config === "object" &&
            !Array.isArray(req.body.config)
                ? (req.body.config as Record<string, unknown>)
                : undefined;
        const db = createServerSupabase();
        const result = await createDmsConnector(
            db,
            userId,
            { kind, name, baseUrl, config },
            req.log,
        );
        if (!result.ok)
            return void res.status(400).json({ detail: result.detail });
        res.status(201).json(result.connector);
    },
);

// PATCH /user/dms-connectors/:connectorId
userRouter.patch(
    "/dms-connectors/:connectorId",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const body = req.body ?? {};
        const result = await updateDmsConnector(
            db,
            userId,
            req.params.connectorId,
            {
                ...(typeof body.name === "string" ? { name: body.name } : {}),
                ...(typeof body.baseUrl === "string"
                    ? { baseUrl: body.baseUrl }
                    : {}),
                ...(typeof body.enabled === "boolean"
                    ? { enabled: body.enabled }
                    : {}),
                ...(body.config &&
                typeof body.config === "object" &&
                !Array.isArray(body.config)
                    ? { config: body.config as Record<string, unknown> }
                    : {}),
            },
            req.log,
        );
        if (!result.ok)
            return void res.status(400).json({ detail: result.detail });
        res.json(result.connector);
    },
);

// DELETE /user/dms-connectors/:connectorId
userRouter.delete(
    "/dms-connectors/:connectorId",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await deleteDmsConnector(
            db,
            userId,
            req.params.connectorId,
            req.log,
        );
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.status(204).send();
    },
);

// POST /user/dms-connectors/:connectorId/oauth/start
userRouter.post(
    "/dms-connectors/:connectorId/oauth/start",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const redirectUri = `${backendPublicUrl(req)}/user/dms-connectors/oauth/callback`;
        try {
            const result = await startDmsConnectorOAuth(
                userId,
                req.params.connectorId,
                redirectUri,
                db,
            );
            res.json(result);
        } catch (err) {
            const detail = errorMessage(err);
            req.log.error(
                { userId, error: detail },
                "[user/dms-connectors] oauth start failed",
            );
            res.status(400).json({ detail });
        }
    },
);

// GET /user/dms-connectors/oauth/callback
userRouter.get("/dms-connectors/oauth/callback", async (req, res) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const error =
        typeof req.query.error === "string" ? req.query.error : undefined;
    const db = createServerSupabase();
    try {
        if (error) throw new Error(error);
        if (!state || !code)
            throw new Error("OAuth callback is missing state or code.");
        const result = await completeDmsConnectorOAuth(state, code, db);
        res.set("Content-Security-Policy", mcpOAuthPopupCsp(nonce))
            .type("html")
            .send(
                mcpOAuthPopupHtml(
                    { success: true, connectorId: result.connectorId },
                    nonce,
                ),
            );
    } catch (err) {
        const detail = errorMessage(err);
        req.log.error(
            { error: detail, stateHash: shortHash(state), hasCode: !!code },
            "[user/dms-connectors] oauth callback failed",
        );
        res.status(400)
            .set("Content-Security-Policy", mcpOAuthPopupCsp(nonce))
            .type("html")
            .send(mcpOAuthPopupHtml({ success: false, detail }, nonce));
    }
});

// POST /user/dms-connectors/:connectorId/sync — verify credentials reach the DMS
userRouter.post(
    "/dms-connectors/:connectorId/sync",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await syncDmsConnector(
            db,
            userId,
            req.params.connectorId,
            req.log,
        );
        if (!result.ok) {
            if (result.detail === "oauth_required")
                return void res
                    .status(401)
                    .json({ code: "oauth_required", detail: result.detail });
            return void res.status(400).json({ detail: result.detail });
        }
        res.json(result.result);
    },
);

// POST /user/dms-connectors/:connectorId/search
userRouter.post(
    "/dms-connectors/:connectorId/search",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const query = typeof req.body?.query === "string" ? req.body.query : "";
        const folderId =
            typeof req.body?.folderId === "string" ? req.body.folderId : null;
        const limit =
            typeof req.body?.limit === "number" ? req.body.limit : undefined;
        const result = await searchDmsConnector(
            db,
            userId,
            req.params.connectorId,
            query,
            { folderId, limit },
            req.log,
        );
        if (!result.ok)
            return void res.status(400).json({ detail: result.detail });
        res.json(result.results);
    },
);

// POST /user/dms-connectors/:connectorId/import — pull a DMS doc into a project
userRouter.post(
    "/dms-connectors/:connectorId/import",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const db = createServerSupabase();
        const dmsDocId =
            typeof req.body?.dmsDocId === "string" ? req.body.dmsDocId : "";
        const projectId =
            typeof req.body?.projectId === "string" ? req.body.projectId : null;
        if (!dmsDocId)
            return void res.status(400).json({ detail: "dmsDocId is required." });
        const result = await importDmsDocument(
            db,
            userId,
            userEmail,
            req.params.connectorId,
            dmsDocId,
            projectId,
            req.log,
        );
        if (!result.ok)
            return void res
                .status(result.status)
                .json({ detail: result.detail });
        res.status(201).json({ documentId: result.documentId, doc: result.doc });
    },
);

// DELETE /user/account
userRouter.delete(
    "/account",
    requireAuth,
    requireMfaIfEnrolled,
    async (_req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const db = createServerSupabase();
        const result = await deleteUserAccount(db, userId, userEmail);
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.status(204).send();
    },
);

// DELETE /user/chats
userRouter.delete(
    "/chats",
    requireAuth,
    requireMfaIfEnrolled,
    async (_req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await deleteUserChats(db, userId);
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.status(204).send();
    },
);

// DELETE /user/projects
userRouter.delete(
    "/projects",
    requireAuth,
    requireMfaIfEnrolled,
    async (_req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await deleteUserProjectsData(db, userId);
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.status(204).send();
    },
);

// DELETE /user/tabular-reviews
userRouter.delete(
    "/tabular-reviews",
    requireAuth,
    requireMfaIfEnrolled,
    async (_req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await deleteUserTabularReviews(db, userId);
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.status(204).send();
    },
);

// GET /user/export
userRouter.get(
    "/export",
    requireAuth,
    requireMfaIfEnrolled,
    async (_req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const db = createServerSupabase();
        const result = await exportUserAccount(db, userId, userEmail);
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${userExportFilename("account", userId)}"`,
        );
        res.json(result.data);
    },
);

// GET /user/chats/export
userRouter.get(
    "/chats/export",
    requireAuth,
    requireMfaIfEnrolled,
    async (_req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const db = createServerSupabase();
        const result = await exportUserChats(db, userId, userEmail);
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${userExportFilename("chats", userId)}"`,
        );
        res.json(result.data);
    },
);

// GET /user/tabular-reviews/export
userRouter.get(
    "/tabular-reviews/export",
    requireAuth,
    requireMfaIfEnrolled,
    async (_req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const db = createServerSupabase();
        const result = await exportUserTabularReviews(db, userId, userEmail);
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${userExportFilename("tabular-reviews", userId)}"`,
        );
        res.json(result.data);
    },
);
