import { ORPCError, os, type as orpcType } from "@orpc/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/server/backend/lib/supabase";
import { DEFAULT_TABULAR_MODEL, resolveModel } from "@/server/backend/lib/llm";
import {
    getUserApiKeyStatus,
    type ApiKeyStatus,
} from "@/server/backend/lib/userApiKeys";

const MONTHLY_CREDIT_LIMIT = 999999;

type RpcContext = {
    request: Request;
};

type AuthedUser = {
    id: string;
    email: string;
};

type UserProfileRow = {
    display_name: string | null;
    organisation: string | null;
    message_credits_used: number;
    credits_reset_date: string;
    tier: string;
    tabular_model: string;
};

type UpdateUserProfileInput = {
    displayName?: string | null;
    organisation?: string | null;
    tabularModel?: string;
};

async function requireRpcUser(request: Request): Promise<AuthedUser> {
    const auth = request.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
        throw new ORPCError("UNAUTHORIZED", {
            message: "Missing or invalid Authorization header",
        });
    }

    const token = auth.slice(7).trim();
    const supabaseUrl =
        process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";

    if (!supabaseUrl || !serviceKey) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Server auth is not configured",
        });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });
    const { data } = await admin.auth.getUser(token);
    if (!data.user) {
        throw new ORPCError("UNAUTHORIZED", {
            message: "Invalid or expired token",
        });
    }

    return {
        id: data.user.id,
        email: data.user.email?.toLowerCase() ?? "",
    };
}

function serializeProfile(row: UserProfileRow, apiKeyStatus: ApiKeyStatus) {
    const creditsUsed = row.message_credits_used ?? 0;
    return {
        displayName: row.display_name,
        organisation: row.organisation,
        messageCreditsUsed: creditsUsed,
        creditsResetDate: row.credits_reset_date,
        creditsRemaining: Math.max(MONTHLY_CREDIT_LIMIT - creditsUsed, 0),
        tier: row.tier || "Free",
        tabularModel: resolveModel(row.tabular_model, DEFAULT_TABULAR_MODEL),
        apiKeyStatus,
    };
}

function parseProfileUpdate(input: UpdateUserProfileInput) {
    const update: {
        display_name?: string | null;
        organisation?: string | null;
        tabular_model?: string;
        updated_at: string;
    } = { updated_at: new Date().toISOString() };

    if ("displayName" in input) {
        if (input.displayName !== null && typeof input.displayName !== "string") {
            throw new ORPCError("BAD_REQUEST", {
                message: "displayName must be a string or null",
            });
        }
        update.display_name = input.displayName?.trim() || null;
    }

    if ("organisation" in input) {
        if (
            input.organisation !== null &&
            typeof input.organisation !== "string"
        ) {
            throw new ORPCError("BAD_REQUEST", {
                message: "organisation must be a string or null",
            });
        }
        update.organisation = input.organisation?.trim() || null;
    }

    if ("tabularModel" in input) {
        if (typeof input.tabularModel !== "string") {
            throw new ORPCError("BAD_REQUEST", {
                message: "tabularModel must be a string",
            });
        }
        const resolved = resolveModel(input.tabularModel, "");
        if (!resolved) {
            throw new ORPCError("BAD_REQUEST", {
                message: "Unsupported tabularModel",
            });
        }
        update.tabular_model = resolved;
    }

    return update;
}

async function ensureProfileRow(userId: string) {
    const db = createServerSupabase();
    const { error } = await db
        .from("user_profiles")
        .upsert(
            { user_id: userId },
            { onConflict: "user_id", ignoreDuplicates: true },
        );
    if (error) throw error;
}

async function loadProfile(userId: string) {
    const db = createServerSupabase();
    await ensureProfileRow(userId);

    const { data, error } = await db
        .from("user_profiles")
        .select(
            "display_name, organisation, message_credits_used, credits_reset_date, tier, tabular_model",
        )
        .eq("user_id", userId)
        .single();
    if (error) throw error;

    let row = data as UserProfileRow;
    if (row.credits_reset_date && new Date() > new Date(row.credits_reset_date)) {
        const creditsResetDate = new Date();
        creditsResetDate.setDate(creditsResetDate.getDate() + 30);
        const reset = await db
            .from("user_profiles")
            .update({
                message_credits_used: 0,
                credits_reset_date: creditsResetDate.toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .select(
                "display_name, organisation, message_credits_used, credits_reset_date, tier, tabular_model",
            )
            .single();
        if (reset.error) throw reset.error;
        row = reset.data as UserProfileRow;
    }

    const apiKeyStatus = await getUserApiKeyStatus(userId, db);
    return serializeProfile(row, apiKeyStatus);
}

export const appRouter = {
    user: {
        profile: os.handler(async ({ context }) => {
            const user = await requireRpcUser((context as RpcContext).request);
            return loadProfile(user.id);
        }),
        updateProfile: os
            .input(orpcType<UpdateUserProfileInput>())
            .handler(async ({ input, context }) => {
                const user = await requireRpcUser(
                    (context as RpcContext).request,
                );
                const db = createServerSupabase();
                await ensureProfileRow(user.id);
                const { error } = await db
                    .from("user_profiles")
                    .update(parseProfileUpdate(input))
                    .eq("user_id", user.id);
                if (error) throw error;
                return loadProfile(user.id);
            }),
        apiKeys: os.handler(async ({ context }) => {
            const user = await requireRpcUser((context as RpcContext).request);
            return getUserApiKeyStatus(user.id);
        }),
    },
};
