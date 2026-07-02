// Business logic + data-access for the user module.
//
// These functions are the service layer behind user.routes.ts. They take an
// explicit Supabase client (`db`) plus request-derived primitives, perform the
// profile / MFA / API-key / export / deletion orchestration, and RETURN values
// or typed error results. They never touch req/res — the thin route handlers
// map the results onto HTTP status codes, headers, and response bodies.
//
// Security boundaries preserved here verbatim:
//   - API-key crypto: writes funnel through saveUserApiKey (never reimplemented).
//   - MFA: the requireMfaIfEnrolled guard stays in the route (HTTP layer); only
//     the verified-TOTP factor lookup lives here.
//   - Data deletion: the userDataCleanup helpers + auth-admin deleteUser call are
//     invoked with identical args and ordering (destructive — exact preservation).
//   - Exports: the payload builders are called here; the route owns the
//     Content-Type / Content-Disposition headers and filenames.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import {
    DEFAULT_TABULAR_MODEL,
    DEFAULT_TITLE_MODEL,
    CLAUDE_LOW_MODELS,
    OPENAI_LOW_MODELS,
    resolveModel,
} from "../../lib/llm";
import {
    type ApiKeyStatus,
    getUserApiKeyStatus,
    hasEnvApiKey,
    saveUserApiKey,
} from "../../lib/userApiKeys";
import {
    createUserMcpConnector,
    deleteUserMcpConnector,
    getUserMcpConnector,
    listUserMcpConnectors,
    McpOAuthRequiredError,
    refreshUserMcpConnectorTools,
    setUserMcpToolEnabled,
    startUserMcpConnectorOAuth,
    updateUserMcpConnector,
} from "../../lib/mcpConnectors";
import {
    createDmsConnector as createDmsConnectorSvc,
    deleteDmsConnector as deleteDmsConnectorSvc,
    getDmsConnector as getDmsConnectorSvc,
    importDmsDocument as importDmsDocumentSvc,
    listDmsConnectors as listDmsConnectorsSvc,
    searchDms as searchDmsSvc,
    syncDmsConnector as syncDmsConnectorSvc,
    updateDmsConnector as updateDmsConnectorSvc,
    DmsOAuthRequiredError,
} from "../../lib/dmsConnectors";
import {
    deleteAllUserChats,
    deleteAllUserTabularReviews,
    deleteUserAccountData,
    deleteUserProjects,
} from "../../lib/userDataCleanup";
import {
    buildUserAccountExport,
    buildUserChatsExport,
    buildUserTabularReviewsExport,
} from "../../lib/userDataExport";

type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of pino's Logger — service functions only ever .error().
type Log = Pick<typeof logger, "error">;

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
};

export function errorMessage(error: unknown): string {
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

const PROFILE_SELECT =
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

// Loads a profile while tolerating older databases that lack the
// legal_research_us column. Tries the full select first, then falls back to
// the legacy cascade (which also handles missing title_model / mfa_on_login)
// and defaults the feature flag to enabled.
async function selectProfile(db: Db, userId: string, mode: "maybe" | "single") {
    const fullQuery = db
        .from("user_profiles")
        .select(PROFILE_SELECT)
        .eq("user_id", userId);
    const full =
        mode === "single"
            ? await fullQuery.single()
            : await fullQuery.maybeSingle();
    if (!full.error) return full;

    const legacy = await selectProfileLegacy(db, userId, mode);
    if (legacy.data && typeof legacy.data === "object") {
        const row = legacy.data as Record<string, unknown>;
        if (!("legal_research_us" in row)) {
            Object.assign(row, { legal_research_us: true });
        }
    }
    return legacy;
}

async function selectProfileLegacy(
    db: Db,
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

function serializeProfile(row: UserProfileRow, apiKeyStatus?: ApiKeyStatus) {
    const creditsUsed = row.message_credits_used ?? 0;
    const titleFallback = apiKeyStatus?.gemini
        ? DEFAULT_TITLE_MODEL
        : apiKeyStatus?.openai
          ? OPENAI_LOW_MODELS[0]
          : apiKeyStatus?.claude
            ? CLAUDE_LOW_MODELS[0]
            : DEFAULT_TITLE_MODEL;
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
        ...(apiKeyStatus ? { apiKeyStatus } : {}),
    };
}

export function validateProfilePayload(body: unknown):
    | {
          ok: true;
          update: {
              display_name?: string | null;
              organisation?: string | null;
              title_model?: string;
              tabular_model?: string;
              legal_research_us?: boolean;
              updated_at: string;
          };
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
        updated_at: string;
    } = { updated_at: new Date().toISOString() };

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

    if ("legalResearchUs" in raw) {
        if (typeof raw.legalResearchUs !== "boolean") {
            return {
                ok: false,
                detail: "legalResearchUs must be a boolean",
            };
        }
        update.legal_research_us = raw.legalResearchUs;
    }

    return { ok: true, update };
}

export function readBooleanBodyField(
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

async function userHasVerifiedTotpFactor(db: Db, userId: string) {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error) return { ok: false as const, error };

    const factors = data.user?.factors ?? [];
    return {
        ok: true as const,
        hasVerifiedTotp: factors.some(
            (factor: { factor_type?: string; status?: string }) =>
                factor.factor_type === "totp" && factor.status === "verified",
        ),
    };
}

async function ensureProfileRow(db: Db, userId: string) {
    const { error } = await db
        .from("user_profiles")
        .upsert(
            { user_id: userId },
            { onConflict: "user_id", ignoreDuplicates: true },
        );
    return error;
}

async function loadProfile(
    db: Db,
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

    return { data: serializeProfile(row, options.apiKeyStatus), error: null };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function bootstrapUserProfile(
    db: Db,
    userId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    const error = await ensureProfileRow(db, userId);
    if (error) return { ok: false, detail: error.message };
    return { ok: true };
}

export async function getUserProfile(
    db: Db,
    userId: string,
): Promise<
    { ok: true; body: Record<string, unknown> } | { ok: false; detail: string }
> {
    const apiKeyStatus = await getUserApiKeyStatus(userId, db);
    const { data, error } = await loadProfile(db, userId, {
        repairMissing: true,
        apiKeyStatus,
    });
    if (error) return { ok: false, detail: error.message };
    return { ok: true, body: { ...data, apiKeyStatus } };
}

export async function updateUserProfile(
    db: Db,
    userId: string,
    update: Record<string, unknown>,
): Promise<
    { ok: true; body: Record<string, unknown> } | { ok: false; detail: string }
> {
    const ensureError = await ensureProfileRow(db, userId);
    if (ensureError) return { ok: false, detail: ensureError.message };

    const { error: updateError } = await db
        .from("user_profiles")
        .update(update)
        .eq("user_id", userId);
    if (updateError) return { ok: false, detail: updateError.message };

    const apiKeyStatus = await getUserApiKeyStatus(userId, db);
    const { data, error } = await loadProfile(db, userId, { apiKeyStatus });
    if (error) return { ok: false, detail: error.message };
    return { ok: true, body: { ...data, apiKeyStatus } };
}

export type SetMfaOnLoginResult =
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; kind: "no_factor"; detail: string }
    | { ok: false; kind: "db_error"; detail: string };

export async function setMfaOnLogin(
    db: Db,
    userId: string,
    enabled: boolean,
): Promise<SetMfaOnLoginResult> {
    if (enabled) {
        const factorCheck = await userHasVerifiedTotpFactor(db, userId);
        if (!factorCheck.ok) {
            return { ok: false, kind: "db_error", detail: factorCheck.error.message };
        }
        if (!factorCheck.hasVerifiedTotp) {
            return {
                ok: false,
                kind: "no_factor",
                detail: "Set up an authenticator app before requiring verification on login.",
            };
        }
    }

    const ensureError = await ensureProfileRow(db, userId);
    if (ensureError)
        return { ok: false, kind: "db_error", detail: ensureError.message };

    const { error: updateError } = await db
        .from("user_profiles")
        .update({
            mfa_on_login: enabled,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    if (updateError)
        return { ok: false, kind: "db_error", detail: updateError.message };

    const apiKeyStatus = await getUserApiKeyStatus(userId, db);
    const { data, error } = await loadProfile(db, userId, { apiKeyStatus });
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    return { ok: true, body: { ...data, apiKeyStatus } };
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export function getApiKeyStatus(db: Db, userId: string) {
    return getUserApiKeyStatus(userId, db);
}

export type SaveApiKeyResult =
    | { ok: true; status: ApiKeyStatus }
    | { ok: false; kind: "env_configured" }
    | { ok: false; kind: "save_failed"; detail: string };

export async function saveApiKey(
    db: Db,
    params: { userId: string; provider: string; apiKey: string | null },
    log: Log,
): Promise<SaveApiKeyResult> {
    const { userId, provider, apiKey } = params;
    try {
        if (hasEnvApiKey(provider)) {
            return { ok: false, kind: "env_configured" };
        }
        await saveUserApiKey(userId, provider, apiKey, db);
        const status = await getUserApiKeyStatus(userId, db);
        return { ok: true, status };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                provider,
                error: detail,
            },
            "[user/api-keys] save failed",
        );
        return { ok: false, kind: "save_failed", detail };
    }
}

// ---------------------------------------------------------------------------
// MCP connectors
// ---------------------------------------------------------------------------

export async function listMcpConnectors(
    db: Db,
    userId: string,
): Promise<{ ok: true; connectors: unknown } | { ok: false; detail: string }> {
    try {
        const connectors = await listUserMcpConnectors(userId, db, {
            includeTools: false,
        });
        return { ok: true, connectors };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/mcp-connectors] list failed",
        );
        return { ok: false, detail };
    }
}

export async function getMcpConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await getUserMcpConnector(userId, connectorId, db);
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] get failed",
        );
        return { ok: false, detail };
    }
}

export async function createMcpConnector(
    db: Db,
    userId: string,
    params: {
        name: string;
        serverUrl: string;
        bearerToken: string | null;
        headers: Record<string, unknown> | undefined;
    },
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await createUserMcpConnector(userId, params, db);
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                error: detail,
            },
            "[user/mcp-connectors] create failed",
        );
        return { ok: false, detail };
    }
}

export async function updateMcpConnector(
    db: Db,
    userId: string,
    connectorId: string,
    updates: Parameters<typeof updateUserMcpConnector>[2],
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await updateUserMcpConnector(
            userId,
            connectorId,
            updates,
            db,
        );
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] update failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteMcpConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteUserMcpConnector(userId, connectorId, db);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function startMcpConnectorOAuth(
    db: Db,
    userId: string,
    connectorId: string,
    redirectUri: string,
    log: Log,
): Promise<{ ok: true; result: unknown } | { ok: false; detail: string }> {
    try {
        const result = await startUserMcpConnectorOAuth(
            userId,
            connectorId,
            redirectUri,
            db,
        );
        return { ok: true, result };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] oauth start failed",
        );
        return { ok: false, detail };
    }
}

export type RefreshMcpToolsResult =
    | { ok: true; connector: unknown }
    | { ok: false; kind: "oauth_required"; code: string; detail: string }
    | { ok: false; kind: "error"; detail: string };

export async function refreshMcpConnectorTools(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<RefreshMcpToolsResult> {
    try {
        const connector = await refreshUserMcpConnectorTools(
            userId,
            connectorId,
            db,
        );
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] refresh failed",
        );
        if (err instanceof McpOAuthRequiredError) {
            return { ok: false, kind: "oauth_required", code: err.code, detail };
        }
        return { ok: false, kind: "error", detail };
    }
}

export async function setMcpToolEnabled(
    db: Db,
    userId: string,
    connectorId: string,
    toolId: string,
    enabled: boolean,
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await setUserMcpToolEnabled(
            userId,
            connectorId,
            toolId,
            enabled,
            db,
        );
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                toolId,
                error: detail,
            },
            "[user/mcp-connectors] tool toggle failed",
        );
        return { ok: false, detail };
    }
}

// ---------------------------------------------------------------------------
// DMS connectors (R3 — iManage / NetDocuments). Thin {ok,...}|{ok:false,detail}
// wrappers over lib/dmsConnectors, mirroring the MCP wrappers above. Air-gap
// gating + SSRF validation + project authz live in the service layer they call.
// ---------------------------------------------------------------------------

export async function listDmsConnectors(
    db: Db,
    userId: string,
    log: Log,
): Promise<{ ok: true; connectors: unknown } | { ok: false; detail: string }> {
    try {
        const connectors = await listDmsConnectorsSvc(userId, db);
        return { ok: true, connectors };
    } catch (err) {
        const detail = errorMessage(err);
        log.error({ userId, error: detail }, "[user/dms-connectors] list failed");
        return { ok: false, detail };
    }
}

export async function getDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await getDmsConnectorSvc(userId, connectorId, db);
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] get failed",
        );
        return { ok: false, detail };
    }
}

export async function createDmsConnector(
    db: Db,
    userId: string,
    input: {
        kind: string;
        name: string;
        baseUrl: string;
        config?: Record<string, unknown>;
    },
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await createDmsConnectorSvc(userId, input, db);
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error({ userId, error: detail }, "[user/dms-connectors] create failed");
        return { ok: false, detail };
    }
}

export async function updateDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    updates: {
        name?: string;
        baseUrl?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
    },
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await updateDmsConnectorSvc(
            userId,
            connectorId,
            updates,
            db,
        );
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] update failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteDmsConnectorSvc(userId, connectorId, db);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function syncDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true; result: unknown } | { ok: false; detail: string }> {
    try {
        const result = await syncDmsConnectorSvc(userId, connectorId, db);
        return { ok: true, result };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] sync failed",
        );
        if (err instanceof DmsOAuthRequiredError) {
            return { ok: false, detail: "oauth_required" };
        }
        return { ok: false, detail };
    }
}

export async function searchDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    query: string,
    opts: { folderId?: string | null; limit?: number },
    log: Log,
): Promise<{ ok: true; results: unknown } | { ok: false; detail: string }> {
    try {
        const results = await searchDmsSvc(userId, connectorId, query, opts, db);
        return { ok: true, results };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] search failed",
        );
        return { ok: false, detail };
    }
}

export async function importDmsDocument(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    connectorId: string,
    dmsDocId: string,
    projectId: string | null,
    log: Log,
): Promise<
    | { ok: true; documentId: string; doc: unknown }
    | { ok: false; status: number; detail: string }
> {
    try {
        const result = await importDmsDocumentSvc(
            userId,
            userEmail,
            connectorId,
            dmsDocId,
            projectId,
            db,
        );
        if (!result.ok) return result;
        return { ok: true, documentId: result.documentId, doc: result.doc };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, dmsDocId, error: detail },
            "[user/dms-connectors] import failed",
        );
        const status = err instanceof DmsOAuthRequiredError ? 401 : 500;
        return { ok: false, status, detail };
    }
}

// ---------------------------------------------------------------------------
// Account / data deletion (destructive — exact call args + ordering preserved)
// ---------------------------------------------------------------------------

export async function deleteUserAccount(
    db: Db,
    userId: string,
    userEmail: string | undefined,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteUserAccountData(db, userId, userEmail);
        const { error } = await db.auth.admin.deleteUser(userId);
        if (error) return { ok: false, detail: error.message };
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/account] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteUserChats(
    db: Db,
    userId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteAllUserChats(db, userId);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/chats] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteUserProjectsData(
    db: Db,
    userId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteUserProjects(db, userId);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/projects] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteUserTabularReviews(
    db: Db,
    userId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteAllUserTabularReviews(db, userId);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/tabular-reviews] delete failed",
        );
        return { ok: false, detail };
    }
}

// ---------------------------------------------------------------------------
// Data export (route owns the Content-Type / Content-Disposition headers)
// ---------------------------------------------------------------------------

export async function exportUserAccount(
    db: Db,
    userId: string,
    userEmail: string | undefined,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
    try {
        const data = await buildUserAccountExport(db, userId, userEmail);
        return { ok: true, data };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error({ userId, error: detail }, "[user/export] failed");
        return { ok: false, detail };
    }
}

export async function exportUserChats(
    db: Db,
    userId: string,
    userEmail: string | undefined,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
    try {
        const data = await buildUserChatsExport(db, userId, userEmail);
        return { ok: true, data };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/chats/export] failed",
        );
        return { ok: false, detail };
    }
}

export async function exportUserTabularReviews(
    db: Db,
    userId: string,
    userEmail: string | undefined,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
    try {
        const data = await buildUserTabularReviewsExport(db, userId, userEmail);
        return { ok: true, data };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/tabular-reviews/export] failed",
        );
        return { ok: false, detail };
    }
}
