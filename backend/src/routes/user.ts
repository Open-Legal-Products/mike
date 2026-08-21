import crypto from "crypto";
import { Router } from "express";
import { requireAuth, requireMfaIfEnrolled } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { recordAudit } from "../lib/audit";
import { enqueueDbJob } from "../lib/dbq/enqueue";
import { EXPORT_TYPES, type ExportType } from "../lib/dbq/handlers";
import type { DbJob } from "../lib/dbq/types";
import { buildContentDisposition, downloadFile } from "../lib/storage";
import {
    DEFAULT_TABULAR_MODEL,
    DEFAULT_TITLE_MODEL,
    CLAUDE_LOW_MODELS,
    isSupportedOpenCodeGoModel,
    OPENAI_LOW_MODELS,
    resolveModel,
} from "../lib/llm";
import {
    type ApiKeyStatus,
    getUserApiKeyStatus,
    hasEnvApiKey,
    normalizeApiKeyProvider,
    saveUserApiKey,
} from "../lib/userApiKeys";
import {
    completeUserMcpConnectorOAuth,
    createUserMcpConnector,
    deleteUserMcpConnector,
    getUserMcpConnector,
    listUserMcpConnectors,
    McpOAuthRequiredError,
    refreshUserMcpConnectorTools,
    setUserMcpToolEnabled,
    startUserMcpConnectorOAuth,
    updateUserMcpConnector,
} from "../lib/mcpConnectors";
import {
    deleteAllUserChats,
    deleteAllUserTabularReviews,
    deleteUserAccountData,
    deleteUserProjects,
} from "../lib/userDataCleanup";
import {
    buildUserAccountExport,
    buildUserChatsExport,
    buildUserTabularReviewsExport,
    userExportFilename,
} from "../lib/userDataExport";
import { findProfileUserByEmail } from "../lib/userLookup";
import {
    getAllUserRouterModels,
    replaceUserRouterModels,
    ROUTER_SLUGS,
    type RouterModelSelections,
    type RouterSlug,
} from "../lib/routerModels";

export const userRouter = Router();

const MONTHLY_CREDIT_LIMIT = 999999;

type UserProfileRow = {
    display_name: string | null;
    organisation: string | null;
    message_credits_used: number;
    credits_reset_date: string;
    tier: string;
    title_model: string | null;
    tabular_model: string;
    mfa_on_login: boolean | null;
    legal_research_us: boolean | null;
    quick_actions_visible: boolean | null;
};

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (error && typeof error === "object") {
        const record = error as {
            message?: unknown;
            details?: unknown;
            hint?: unknown;
            code?: unknown;
        };
        return (
            [record.message, record.details, record.hint, record.code]
                .filter(
                    (value): value is string =>
                        typeof value === "string" && !!value,
                )
                .join(" ") || JSON.stringify(error)
        );
    }
    return String(error);
}

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

function frontendUrl(path = "/settings/connectors") {
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

function mcpOAuthPopupHtml(
    payload: {
        success: boolean;
        connectorId?: string;
        detail?: string;
    },
    nonce: string,
) {
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

const PROFILE_SELECT =
    "display_name, organisation, message_credits_used, credits_reset_date, tier, title_model, tabular_model, mfa_on_login, legal_research_us, quick_actions_visible";
const PROFILE_SELECT_NO_QUICK_ACTIONS =
    "display_name, organisation, message_credits_used, credits_reset_date, tier, title_model, tabular_model, mfa_on_login, legal_research_us";
const PROFILE_SELECT_NO_LEGAL =
    "display_name, organisation, message_credits_used, credits_reset_date, tier, title_model, tabular_model, mfa_on_login";
const LEGACY_PROFILE_SELECT =
    "display_name, organisation, message_credits_used, credits_reset_date, tier, tabular_model";
const LEGACY_PROFILE_MODEL_SELECT =
    "display_name, organisation, message_credits_used, credits_reset_date, tier, title_model, tabular_model";

function isMissingProfileColumn(error: unknown, column: string): boolean {
    const record =
        error && typeof error === "object"
            ? (error as { code?: unknown; message?: unknown })
            : {};
    const message = typeof record.message === "string" ? record.message : "";
    return record.code === "42703" && message.includes(column);
}

// Loads a profile while tolerating older databases that lack newer preference
// columns. Tries the full select first, then falls back through the legacy
// cascade (which also handles missing title_model / mfa_on_login) and applies
// safe defaults for missing fields.
async function selectProfile(
    db: ReturnType<typeof createServerSupabase>,
    userId: string,
    mode: "maybe" | "single",
) {
    const fullQuery = db
        .from("user_profiles")
        .select(PROFILE_SELECT)
        .eq("user_id", userId);
    const full =
        mode === "single"
            ? await fullQuery.single()
            : await fullQuery.maybeSingle();
    if (!full.error) return full;

    if (isMissingProfileColumn(full.error, "quick_actions_visible")) {
        const previousQuery = db
            .from("user_profiles")
            .select(PROFILE_SELECT_NO_QUICK_ACTIONS)
            .eq("user_id", userId);
        const previous =
            mode === "single"
                ? await previousQuery.single()
                : await previousQuery.maybeSingle();
        if (!previous.error) {
            if (previous.data && typeof previous.data === "object") {
                Object.assign(previous.data, {
                    quick_actions_visible: true,
                });
            }
            return previous;
        }
    }

    const legacy = await selectProfileLegacy(db, userId, mode);
    if (legacy.data && typeof legacy.data === "object") {
        const row = legacy.data as Record<string, unknown>;
        if (!("legal_research_us" in row)) {
            Object.assign(row, { legal_research_us: true });
        }
        Object.assign(row, { quick_actions_visible: true });
    }
    return legacy;
}

async function selectProfileLegacy(
    db: ReturnType<typeof createServerSupabase>,
    userId: string,
    mode: "maybe" | "single",
) {
    const query = db
        .from("user_profiles")
        .select(PROFILE_SELECT_NO_LEGAL)
        .eq("user_id", userId);
    const result =
        mode === "single" ? await query.single() : await query.maybeSingle();
    if (!result.error) {
        return result;
    }

    const missingMfaOnLogin = isMissingProfileColumn(
        result.error,
        "mfa_on_login",
    );
    if (missingMfaOnLogin) {
        const modelQuery = db
            .from("user_profiles")
            .select(LEGACY_PROFILE_MODEL_SELECT)
            .eq("user_id", userId);
        const modelLegacy =
            mode === "single"
                ? await modelQuery.single()
                : await modelQuery.maybeSingle();
        if (
            !modelLegacy.error ||
            !isMissingProfileColumn(modelLegacy.error, "title_model")
        ) {
            if (modelLegacy.data && typeof modelLegacy.data === "object") {
                const row = modelLegacy.data as Record<string, unknown>;
                Object.assign(row, {
                    mfa_on_login: false,
                });
            }
            return modelLegacy;
        }
    }

    if (
        !missingMfaOnLogin &&
        !isMissingProfileColumn(result.error, "title_model")
    ) {
        return result;
    }

    const legacyQuery = db
        .from("user_profiles")
        .select(LEGACY_PROFILE_SELECT)
        .eq("user_id", userId);
    const legacy =
        mode === "single"
            ? await legacyQuery.single()
            : await legacyQuery.maybeSingle();
    if (legacy.data && typeof legacy.data === "object") {
        const row = legacy.data as Record<string, unknown>;
        Object.assign(row, {
            title_model: null,
            mfa_on_login: false,
        });
    }
    return legacy;
}

const CATALOG_MODEL_ID_RE = /^[^\s/]+\/[^\s]+$/;

/**
 * A router's catalog-id shape. OpenRouter and Vercel publish vendor/model
 * pairs; OpenCode Go publishes bare model names ("glm-5"), so requiring a
 * slash there would reject its entire catalog.
 */
const ROUTER_MODEL_ID_RE: Record<RouterSlug, RegExp> = {
    openrouter: CATALOG_MODEL_ID_RE,
    vercel: CATALOG_MODEL_ID_RE,
    "opencode-go": /^[^\s]+$/,
};

/**
 * The profile field each router's selection is read from and written to.
 * Mirrored by the frontend's updateUserProfile payload.
 */
export const ROUTER_PROFILE_FIELDS: Record<RouterSlug, string> = {
    openrouter: "openRouterModels",
    vercel: "vercelModels",
    "opencode-go": "openCodeGoModels",
};

export function normalizeRouterModels(
    value: unknown,
    provider: RouterSlug,
): string[] {
    if (!Array.isArray(value)) return [];
    const models: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== "string") continue;
        const trimmed = item.trim();
        // Strip a leading router slug ("openrouter/deepseek/deepseek-v3" →
        // "deepseek/deepseek-v3") only when what remains is still a full
        // vendor/model catalog id. Some catalog ids legitimately begin with
        // the router's own slug (OpenRouter's "openrouter/auto", Vercel's
        // "vercel/v0-1.5-md"); for those the raw id IS the canonical form
        // and stripping would destroy it.
        const catalogIdRe = ROUTER_MODEL_ID_RE[provider];
        const stripped = trimmed.replace(new RegExp(`^${provider}/`), "");
        const model = catalogIdRe.test(stripped) ? stripped : trimmed;
        if (
            !model ||
            model.length > 200 ||
            !catalogIdRe.test(model) ||
            (provider === "opencode-go" &&
                !isSupportedOpenCodeGoModel(model)) ||
            seen.has(model)
        ) {
            continue;
        }
        seen.add(model);
        models.push(model);
        if (models.length === 50) break;
    }
    return models;
}

function routerTitleFallback(
    routerModels: RouterModelSelections,
    apiKeyStatus?: ApiKeyStatus,
): string | null {
    for (const slug of ROUTER_SLUGS) {
        const first = routerModels[slug][0];
        if (apiKeyStatus?.[slug] && first) return `${slug}/${first}`;
    }
    return null;
}

function serializeProfile(
    routerModels: RouterModelSelections,
    row: UserProfileRow,
    apiKeyStatus?: ApiKeyStatus,
) {
    const creditsUsed = row.message_credits_used ?? 0;
    const titleFallback = apiKeyStatus?.gemini
        ? DEFAULT_TITLE_MODEL
        : apiKeyStatus?.openai
          ? OPENAI_LOW_MODELS[0]
          : apiKeyStatus?.claude
            ? CLAUDE_LOW_MODELS[0]
            : (routerTitleFallback(routerModels, apiKeyStatus) ??
              DEFAULT_TITLE_MODEL);
    return {
        displayName: row.display_name,
        organisation: row.organisation,
        messageCreditsUsed: creditsUsed,
        creditsResetDate: row.credits_reset_date,
        creditsRemaining: Math.max(MONTHLY_CREDIT_LIMIT - creditsUsed, 0),
        tier: row.tier || "Free",
        titleModel: resolveModel(row.title_model, titleFallback),
        tabularModel: resolveModel(row.tabular_model, DEFAULT_TABULAR_MODEL),
        mfaOnLogin: row.mfa_on_login === true,
        legalResearchUs: row.legal_research_us !== false,
        quickActionsVisible: row.quick_actions_visible !== false,
        ...Object.fromEntries(
            ROUTER_SLUGS.map((slug) => [
                ROUTER_PROFILE_FIELDS[slug],
                routerModels[slug],
            ]),
        ),
        ...(apiKeyStatus ? { apiKeyStatus } : {}),
    };
}

function validateProfilePayload(body: unknown):
    | {
          ok: true;
          update: {
              display_name?: string | null;
              organisation?: string | null;
              title_model?: string;
              tabular_model?: string;
              legal_research_us?: boolean;
              quick_actions_visible?: boolean;
              updated_at: string;
          };
          routerModels?: Partial<Record<RouterSlug, string[]>>;
      }
    | { ok: false; detail: string } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false, detail: "Expected a JSON object" };
    }

    const raw = body as Record<string, unknown>;
    const allowedFields = new Set([
        "displayName",
        "organisation",
        "titleModel",
        "tabularModel",
        "legalResearchUs",
        "quickActionsVisible",
        ...ROUTER_SLUGS.map((slug) => ROUTER_PROFILE_FIELDS[slug]),
    ]);
    const invalidField = Object.keys(raw).find(
        (key) => !allowedFields.has(key),
    );
    if (invalidField) {
        return {
            ok: false,
            detail: `Unsupported profile field: ${invalidField}`,
        };
    }

    const update: {
        display_name?: string | null;
        organisation?: string | null;
        title_model?: string;
        tabular_model?: string;
        legal_research_us?: boolean;
        quick_actions_visible?: boolean;
        updated_at: string;
    } = { updated_at: new Date().toISOString() };
    const routerModels: Partial<Record<RouterSlug, string[]>> = {};

    if ("displayName" in raw) {
        if (raw.displayName !== null && typeof raw.displayName !== "string") {
            return {
                ok: false,
                detail: "displayName must be a string or null",
            };
        }
        update.display_name = raw.displayName?.trim() || null;
    }

    if ("organisation" in raw) {
        if (raw.organisation !== null && typeof raw.organisation !== "string") {
            return {
                ok: false,
                detail: "organisation must be a string or null",
            };
        }
        update.organisation = raw.organisation?.trim() || null;
    }

    if ("tabularModel" in raw) {
        if (typeof raw.tabularModel !== "string") {
            return { ok: false, detail: "tabularModel must be a string" };
        }
        const resolved = resolveModel(raw.tabularModel, "");
        if (!resolved) {
            return { ok: false, detail: "Unsupported tabularModel" };
        }
        update.tabular_model = resolved;
    }

    if ("titleModel" in raw) {
        if (typeof raw.titleModel !== "string") {
            return { ok: false, detail: "titleModel must be a string" };
        }
        const resolved = resolveModel(raw.titleModel, "");
        if (!resolved) {
            return { ok: false, detail: "Unsupported titleModel" };
        }
        update.title_model = resolved;
    }

    for (const slug of ROUTER_SLUGS) {
        const field = ROUTER_PROFILE_FIELDS[slug];
        if (!(field in raw)) continue;
        const value = raw[field];
        if (!Array.isArray(value)) {
            return {
                ok: false,
                detail: `${field} must be an array of model IDs`,
            };
        }
        // Check the cap before normalizing: normalizeRouterModels truncates
        // at 50, so a longer payload would otherwise surface as the
        // misleading "invalid or duplicate model ID".
        if (value.length > 50) {
            return {
                ok: false,
                detail: `${field} can include at most 50 models`,
            };
        }
        const models = normalizeRouterModels(value, slug);
        if (models.length !== value.length) {
            return {
                ok: false,
                detail: `${field} contains an invalid or duplicate model ID`,
            };
        }
        routerModels[slug] = models;
    }

    if ("legalResearchUs" in raw) {
        if (typeof raw.legalResearchUs !== "boolean") {
            return {
                ok: false,
                detail: "legalResearchUs must be a boolean",
            };
        }
        update.legal_research_us = raw.legalResearchUs;
    }

    if ("quickActionsVisible" in raw) {
        if (typeof raw.quickActionsVisible !== "boolean") {
            return {
                ok: false,
                detail: "quickActionsVisible must be a boolean",
            };
        }
        update.quick_actions_visible = raw.quickActionsVisible;
    }

    return { ok: true, update, routerModels };
}

function readBooleanBodyField(
    body: unknown,
    field: string,
): { ok: true; value: boolean } | { ok: false; detail: string } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false, detail: "Expected a JSON object" };
    }

    const raw = body as Record<string, unknown>;
    const invalidField = Object.keys(raw).find((key) => key !== field);
    if (invalidField) {
        return { ok: false, detail: `Unsupported field: ${invalidField}` };
    }
    if (typeof raw[field] !== "boolean") {
        return { ok: false, detail: `${field} must be a boolean` };
    }

    return { ok: true, value: raw[field] };
}

async function userHasVerifiedTotpFactor(
    db: ReturnType<typeof createServerSupabase>,
    userId: string,
) {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error) return { ok: false as const, error };

    const factors = data.user?.factors ?? [];
    return {
        ok: true as const,
        hasVerifiedTotp: factors.some(
            (factor) =>
                factor.factor_type === "totp" && factor.status === "verified",
        ),
    };
}

async function ensureProfileRow(
    db: ReturnType<typeof createServerSupabase>,
    userId: string,
) {
    const { error } = await db
        .from("user_profiles")
        .upsert(
            { user_id: userId },
            { onConflict: "user_id", ignoreDuplicates: true },
        );
    return error;
}

async function loadProfile(
    db: ReturnType<typeof createServerSupabase>,
    userId: string,
    options: { repairMissing?: boolean; apiKeyStatus?: ApiKeyStatus } = {},
) {
    let { data, error } = await selectProfile(db, userId, "maybe");

    if (error) return { data: null, error };
    if (!data) {
        if (!options.repairMissing) {
            return { data: null, error: new Error("Profile not found") };
        }

        const ensureError = await ensureProfileRow(db, userId);
        if (ensureError) return { data: null, error: ensureError };

        const created = await selectProfile(db, userId, "single");
        if (created.error) return { data: null, error: created.error };
        data = created.data;
    }

    let row = data as UserProfileRow;
    if (
        row.credits_reset_date &&
        new Date() > new Date(row.credits_reset_date)
    ) {
        const creditsResetDate = new Date();
        creditsResetDate.setDate(creditsResetDate.getDate() + 30);
        const { error: resetError } = await db
            .from("user_profiles")
            .update({
                message_credits_used: 0,
                credits_reset_date: creditsResetDate.toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);

        if (resetError) return { data: null, error: resetError };
        const { data: resetData, error: resetLoadError } = await selectProfile(
            db,
            userId,
            "single",
        );
        if (resetLoadError) return { data: null, error: resetLoadError };
        row = resetData as UserProfileRow;
    }

    try {
        const routerModels = await getAllUserRouterModels(userId, db);
        return {
            data: serializeProfile(routerModels, row, options.apiKeyStatus),
            error: null,
        };
    } catch (routerModelsError) {
        return {
            data: null,
            error:
                routerModelsError instanceof Error
                    ? routerModelsError
                    : new Error(errorMessage(routerModelsError)),
        };
    }
}

// POST /user/profile
userRouter.post("/profile", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const error = await ensureProfileRow(db, userId);
    if (error) return void res.status(500).json({ detail: error.message });
    res.json({ ok: true });
});

// GET /user/lookup?email=person@example.com
userRouter.get("/lookup", requireAuth, async (req, res) => {
    const email = typeof req.query.email === "string" ? req.query.email : "";
    if (!email.trim()) {
        return void res.status(400).json({ detail: "email is required" });
    }

    const db = createServerSupabase();
    const user = await findProfileUserByEmail(db, email);
    res.json({
        exists: !!user,
        email: user?.email ?? email.trim().toLowerCase(),
        display_name: user?.display_name ?? null,
    });
});

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const apiKeyStatus = await getUserApiKeyStatus(userId, db);
    const { data, error } = await loadProfile(db, userId, {
        repairMissing: true,
        apiKeyStatus,
    });
    if (error) return void res.status(500).json({ detail: error.message });
    res.json({ ...data, apiKeyStatus });
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const parsed = validateProfilePayload(req.body);
    if (!parsed.ok) return void res.status(400).json({ detail: parsed.detail });

    const db = createServerSupabase();
    const ensureError = await ensureProfileRow(db, userId);
    if (ensureError)
        return void res.status(500).json({ detail: ensureError.message });

    const { error: updateError } = await db
        .from("user_profiles")
        .update(parsed.update)
        .eq("user_id", userId);
    if (updateError)
        return void res.status(500).json({ detail: updateError.message });

    for (const slug of ROUTER_SLUGS) {
        const models = parsed.routerModels?.[slug];
        if (models === undefined) continue;
        try {
            await replaceUserRouterModels(userId, slug, models, db);
        } catch (routerModelsError) {
            return void res.status(500).json({
                detail: errorMessage(routerModelsError),
            });
        }
    }

    const apiKeyStatus = await getUserApiKeyStatus(userId, db);
    const { data, error } = await loadProfile(db, userId, { apiKeyStatus });
    if (error) return void res.status(500).json({ detail: error.message });
    res.json({ ...data, apiKeyStatus });
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
        if (parsed.value) {
            const factorCheck = await userHasVerifiedTotpFactor(db, userId);
            if (!factorCheck.ok) {
                return void res.status(500).json({
                    detail: factorCheck.error.message,
                });
            }
            if (!factorCheck.hasVerifiedTotp) {
                return void res.status(400).json({
                    detail: "Set up an authenticator app before requiring verification on login.",
                });
            }
        }

        const ensureError = await ensureProfileRow(db, userId);
        if (ensureError)
            return void res.status(500).json({ detail: ensureError.message });

        const { error: updateError } = await db
            .from("user_profiles")
            .update({
                mfa_on_login: parsed.value,
                updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);
        if (updateError)
            return void res.status(500).json({ detail: updateError.message });

        const apiKeyStatus = await getUserApiKeyStatus(userId, db);
        const { data, error } = await loadProfile(db, userId, { apiKeyStatus });
        if (error) return void res.status(500).json({ detail: error.message });
        res.json({ ...data, apiKeyStatus });
    },
);

// GET /user/api-keys
userRouter.get("/api-keys", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const status = await getUserApiKeyStatus(userId, db);
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
        try {
            if (hasEnvApiKey(provider)) {
                return void res.status(409).json({
                    detail: "This provider is configured by the server environment and cannot be changed from the browser.",
                });
            }
            await saveUserApiKey(userId, provider, apiKey, db);
            const status = await getUserApiKeyStatus(userId, db);
            res.json(status);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/api-keys] save failed", {
                provider,
                error: detail,
            });
            res.status(500).json({ detail });
        }
    },
);

// GET /user/mcp-connectors
userRouter.get("/mcp-connectors", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    try {
        res.json(
            await listUserMcpConnectors(userId, db, { includeTools: false }),
        );
    } catch (err) {
        const detail = errorMessage(err);
        console.error("[user/mcp-connectors] list failed", {
            userId,
            error: detail,
        });
        res.status(500).json({ detail });
    }
});

// GET /user/mcp-connectors/:connectorId
userRouter.get(
    "/mcp-connectors/:connectorId",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        try {
            res.json(
                await getUserMcpConnector(userId, req.params.connectorId, db),
            );
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/mcp-connectors] get failed", {
                userId,
                connectorId: req.params.connectorId,
                error: detail,
            });
            res.status(404).json({ detail });
        }
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
        try {
            const connector = await createUserMcpConnector(
                userId,
                { name, serverUrl, bearerToken, headers },
                db,
            );
            res.status(201).json(connector);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/mcp-connectors] create failed", {
                userId,
                error: detail,
            });
            res.status(400).json({ detail });
        }
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
        try {
            const connector = await updateUserMcpConnector(
                userId,
                req.params.connectorId,
                {
                    ...(typeof body.name === "string"
                        ? { name: body.name }
                        : {}),
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
                                      ? (body.headers as Record<
                                            string,
                                            unknown
                                        >)
                                      : {},
                          }
                        : {}),
                },
                db,
            );
            res.json(connector);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/mcp-connectors] update failed", {
                userId,
                connectorId: req.params.connectorId,
                error: detail,
            });
            res.status(400).json({ detail });
        }
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
        try {
            await deleteUserMcpConnector(userId, req.params.connectorId, db);
            res.status(204).send();
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/mcp-connectors] delete failed", {
                userId,
                connectorId: req.params.connectorId,
                error: detail,
            });
            res.status(500).json({ detail });
        }
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
        try {
            const redirectUri = `${backendPublicUrl(req)}/user/mcp-connectors/oauth/callback`;
            const result = await startUserMcpConnectorOAuth(
                userId,
                req.params.connectorId,
                redirectUri,
                db,
            );
            res.json(result);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/mcp-connectors] oauth start failed", {
                userId,
                connectorId: req.params.connectorId,
                error: detail,
            });
            res.status(400).json({ detail });
        }
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
        console.error("[user/mcp-connectors] oauth callback failed", {
            error: detail,
            stateHash: shortHash(state),
            hasCode: !!code,
            hasError: !!error,
            issuer:
                typeof req.query.iss === "string" ? req.query.iss : undefined,
            scope:
                typeof req.query.scope === "string"
                    ? req.query.scope
                    : undefined,
        });
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
        try {
            const connector = await refreshUserMcpConnectorTools(
                userId,
                req.params.connectorId,
                db,
            );
            res.json(connector);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/mcp-connectors] refresh failed", {
                userId,
                connectorId: req.params.connectorId,
                error: detail,
            });
            if (err instanceof McpOAuthRequiredError) {
                return void res.status(401).json({
                    code: err.code,
                    detail,
                });
            }
            res.status(400).json({ detail });
        }
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
        try {
            const connector = await setUserMcpToolEnabled(
                userId,
                req.params.connectorId,
                req.params.toolId,
                parsed.value,
                db,
            );
            res.json(connector);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/mcp-connectors] tool toggle failed", {
                userId,
                connectorId: req.params.connectorId,
                toolId: req.params.toolId,
                error: detail,
            });
            res.status(400).json({ detail });
        }
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
        try {
            // Order matters, and is the REVERSE of the old inline flow:
            // 1. Delete the auth user first. From the user's point of view
            //    the account is now gone (no login, sessions revoked) and if
            //    THIS fails, nothing has happened — the request is cleanly
            //    retriable.
            // 2. Then enqueue the data cascade as a durable job. The old
            //    inline cascade died with the request or a restart, leaving
            //    a half-deleted account with no owner; the job retries until
            //    the (idempotent) cascade completes.
            const { error } = await db.auth.admin.deleteUser(userId);
            if (error)
                return void res.status(500).json({ detail: error.message });
            try {
                await enqueueDbJob(db, {
                    kind: "account.delete",
                    payload: { userId, userEmail: userEmail ?? null },
                    dedupeKey: `account.delete:${userId}`,
                    maxAttempts: 20,
                });
            } catch (enqueueErr) {
                // Auth user is already gone — the user cannot retry. Fall
                // back to the old inline cascade rather than stranding the
                // data.
                console.error(
                    "[user/account] cleanup enqueue failed; running inline",
                    { userId, error: errorMessage(enqueueErr) },
                );
                await deleteUserAccountData(db, userId, userEmail);
            }
            res.status(204).send();
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/account] delete failed", {
                userId,
                error: detail,
            });
            res.status(500).json({ detail });
        }
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
        try {
            await deleteAllUserChats(db, userId);
            res.status(204).send();
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/chats] delete failed", {
                userId,
                error: detail,
            });
            res.status(500).json({ detail });
        }
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
        try {
            await deleteUserProjects(db, userId);
            res.status(204).send();
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/projects] delete failed", {
                userId,
                error: detail,
            });
            res.status(500).json({ detail });
        }
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
        try {
            await deleteAllUserTabularReviews(db, userId);
            res.status(204).send();
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/tabular-reviews] delete failed", {
                userId,
                error: detail,
            });
            res.status(500).json({ detail });
        }
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
        try {
            const data = await buildUserAccountExport(db, userId, userEmail);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${userExportFilename("account", userId)}"`,
            );
            void recordAudit(createServerSupabase(), {
                userId,
                userEmail: res.locals.userEmail as string | undefined,
                action: "export.account",
                surface: "account",
            });
            res.json(data);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/export] failed", { userId, error: detail });
            res.status(500).json({ detail });
        }
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
        try {
            const data = await buildUserChatsExport(db, userId, userEmail);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${userExportFilename("chats", userId)}"`,
            );
            void recordAudit(createServerSupabase(), {
                userId,
                userEmail: res.locals.userEmail as string | undefined,
                action: "export.chats",
                surface: "account",
            });
            res.json(data);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/chats/export] failed", {
                userId,
                error: detail,
            });
            res.status(500).json({ detail });
        }
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
        try {
            const data = await buildUserTabularReviewsExport(
                db,
                userId,
                userEmail,
            );
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${userExportFilename("tabular-reviews", userId)}"`,
            );
            void recordAudit(createServerSupabase(), {
                userId,
                userEmail: res.locals.userEmail as string | undefined,
                action: "export.tabular",
                surface: "account",
            });
            res.json(data);
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/tabular-reviews/export] failed", {
                userId,
                error: detail,
            });
            res.status(500).json({ detail });
        }
    },
);

// ---------------------------------------------------------------------------
// Async exports (durable): POST creates a DB-queue job that builds the
// export off the request thread; GET polls it; the download endpoint streams
// the finished artifact. The synchronous GET /user/*/export routes above
// still work (curl users, older clients) — the frontend uses this flow so a
// large export can neither time out the request nor die with a dropped tab.
// Artifacts expire after 24 hours (the runner's retention sweep deletes the
// file and the job row).

// POST /user/exports  { type: "account" | "chats" | "tabular-reviews" }
userRouter.post(
    "/exports",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const type = (req.body as { type?: string } | undefined)?.type;
        if (!type || !EXPORT_TYPES.includes(type as ExportType))
            return void res.status(400).json({
                detail: `type must be one of: ${EXPORT_TYPES.join(", ")}`,
            });
        const db = createServerSupabase();
        try {
            // Deduped per (user, type): double clicks and impatient retries
            // collapse into the already-running build.
            const out = await enqueueDbJob(db, {
                kind: "export.build",
                payload: { userId, userEmail: userEmail ?? null, type },
                dedupeKey: `export:${userId}:${type}`,
                maxAttempts: 3,
            });
            if (!out.id)
                return void res
                    .status(500)
                    .json({ detail: "Failed to schedule export" });
            res.status(202).json({ export_id: out.id });
        } catch (err) {
            const detail = errorMessage(err);
            console.error("[user/exports] enqueue failed", {
                userId,
                error: detail,
            });
            res.status(500).json({ detail });
        }
    },
);

// Shared lookup: an export job is only visible to the user whose data it
// exports. A foreign or unknown id is a 404 either way, so ids are not
// probeable.
async function loadOwnExportJob(
    db: ReturnType<typeof createServerSupabase>,
    exportId: string,
    userId: string,
): Promise<Pick<DbJob, "id" | "status" | "result"> | null> {
    const { data: job } = await db
        .from("db_jobs")
        .select("id, kind, status, payload, result")
        .eq("id", exportId)
        .eq("kind", "export.build")
        .maybeSingle();
    if (!job || (job.payload as { userId?: string })?.userId !== userId)
        return null;
    return job as Pick<DbJob, "id" | "status" | "result">;
}

// GET /user/exports/:exportId — poll until status is "done", then fetch
// GET /user/exports/:exportId/download.
userRouter.get(
    "/exports/:exportId",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const row = await loadOwnExportJob(db, req.params.exportId, userId);
        if (!row)
            return void res.status(404).json({ detail: "Export not found" });
        if (row.status === "done" && row.result) {
            return void res.json({
                status: "done",
                filename: row.result.filename ?? null,
            });
        }
        if (row.status === "failed")
            return void res.json({ status: "failed" });
        res.json({ status: "pending" });
    },
);

// GET /user/exports/:exportId/download — stream the finished artifact.
// Authenticated + ownership-checked on every request (unlike /download/:token,
// which only serves paths backed by a document_versions row and would 404 on
// an export artifact); artifacts expire after 24h.
userRouter.get(
    "/exports/:exportId/download",
    requireAuth,
    requireMfaIfEnrolled,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const row = await loadOwnExportJob(db, req.params.exportId, userId);
        if (!row || row.status !== "done" || !row.result)
            return void res.status(404).json({ detail: "Export not found" });
        const storagePath = row.result.storage_path as string | undefined;
        const filename =
            (row.result.filename as string | undefined) ?? "export.json";
        if (!storagePath)
            return void res.status(404).json({ detail: "Export not found" });
        const raw = await downloadFile(storagePath);
        if (!raw)
            return void res.status(404).json({ detail: "Export expired" });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            buildContentDisposition("attachment", filename),
        );
        res.send(Buffer.from(raw));
    },
);
