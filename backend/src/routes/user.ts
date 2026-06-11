import { Router } from "express";
import { requireAuth, requireMfaIfEnrolled } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import {
    DEFAULT_TABULAR_MODEL,
    DEFAULT_TITLE_MODEL,
    CLAUDE_LOW_MODELS,
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

function validateProfilePayload(body: unknown):
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

    return { data: serializeProfile(row, options.apiKeyStatus), error: null };
}

// POST /user/profile
userRouter.post("/profile", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const error = await ensureProfileRow(db, userId);
    if (error) return void res.status(500).json({ detail: error.message });
    res.json({ ok: true });
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
            await deleteUserAccountData(db, userId, userEmail);
            const { error } = await db.auth.admin.deleteUser(userId);
            if (error)
                return void res.status(500).json({ detail: error.message });
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
