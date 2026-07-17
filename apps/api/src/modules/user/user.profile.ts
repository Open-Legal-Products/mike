// User profile: load, serialize, validate, bootstrap, read + update.
//
// Service layer behind user.routes.ts — see user.shared.ts for the module's
// contract (explicit `db`, request-derived primitives in, typed result objects
// out, no req/res). The profile-row loaders (ensureProfileRow / loadProfile)
// are exported for intra-module reuse by user.mfa.ts; the facade does NOT
// re-export them, so they stay off the module's public surface.

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
} from "../../lib/userApiKeys";
import { findProfileUserByEmail } from "../../lib/userLookup";
import { type Db } from "./user.shared";

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

export async function ensureProfileRow(db: Db, userId: string) {
    const { error } = await db
        .from("user_profiles")
        .upsert(
            { user_id: userId },
            { onConflict: "user_id", ignoreDuplicates: true },
        );
    return error;
}

export async function loadProfile(
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

/**
 * Look up whether an email belongs to an existing Mike user via the mirrored
 * profile email (no auth.users scan). Used by the sharing UIs to validate
 * recipients before submitting.
 */
export async function lookupUserByEmail(
    db: Db,
    email: string,
): Promise<{
    exists: boolean;
    email: string;
    display_name: string | null;
}> {
    const user = await findProfileUserByEmail(db, email);
    return {
        exists: !!user,
        email: user?.email ?? email.trim().toLowerCase(),
        display_name: user?.display_name ?? null,
    };
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
