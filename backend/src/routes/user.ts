import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { requireAuth } from "../middleware/auth";
import { db, type Db } from "../db";
import { user_profiles, users } from "../db/schema";
import { DEFAULT_TABULAR_MODEL, resolveModel } from "../lib/llm";
import {
  type ApiKeyStatus,
  getUserApiKeyStatus,
  hasEnvApiKey,
  normalizeApiKeyProvider,
  saveUserApiKey,
} from "../lib/userApiKeys";

export const userRouter = Router();

const MONTHLY_CREDIT_LIMIT = 999999;

type UserProfileRow = {
  display_name: string | null;
  organisation: string | null;
  message_credits_used: number;
  credits_reset_date: Date;
  tier: string;
  tabular_model: string;
};

function serializeProfile(row: UserProfileRow, apiKeyStatus?: ApiKeyStatus) {
  const creditsUsed = row.message_credits_used ?? 0;
  return {
    displayName: row.display_name,
    organisation: row.organisation,
    messageCreditsUsed: creditsUsed,
    creditsResetDate: row.credits_reset_date.toISOString(),
    creditsRemaining: Math.max(MONTHLY_CREDIT_LIMIT - creditsUsed, 0),
    tier: row.tier || "Free",
    tabularModel: resolveModel(row.tabular_model, DEFAULT_TABULAR_MODEL),
    ...(apiKeyStatus ? { apiKeyStatus } : {}),
  };
}

function validateProfilePayload(body: unknown):
  | {
      ok: true;
      update: {
        display_name?: string | null;
        organisation?: string | null;
        tabular_model?: string;
        updated_at: Date;
      };
    }
  | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "Expected a JSON object" };
  }

  const raw = body as Record<string, unknown>;
  const allowedFields = new Set(["displayName", "organisation", "tabularModel"]);
  const invalidField = Object.keys(raw).find((key) => !allowedFields.has(key));
  if (invalidField) {
    return { ok: false, detail: `Unsupported profile field: ${invalidField}` };
  }

  const update: {
    display_name?: string | null;
    organisation?: string | null;
    tabular_model?: string;
    updated_at: Date;
  } = { updated_at: new Date() };

  if ("displayName" in raw) {
    if (raw.displayName !== null && typeof raw.displayName !== "string") {
      return { ok: false, detail: "displayName must be a string or null" };
    }
    update.display_name = (raw.displayName as string | null)?.trim() || null;
  }

  if ("organisation" in raw) {
    if (raw.organisation !== null && typeof raw.organisation !== "string") {
      return { ok: false, detail: "organisation must be a string or null" };
    }
    update.organisation = (raw.organisation as string | null)?.trim() || null;
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

  return { ok: true, update };
}

async function ensureProfileRow(client: Db, userId: string): Promise<void> {
  await client
    .insert(user_profiles)
    .values({ user_id: userId })
    .onConflictDoNothing({ target: user_profiles.user_id });
}

async function loadProfile(
  client: Db,
  userId: string,
  options: { repairMissing?: boolean } = {},
): Promise<{ data: ReturnType<typeof serializeProfile> | null; error: Error | null }> {
  let row = await client.query.user_profiles.findFirst({
    where: eq(user_profiles.user_id, userId),
    columns: {
      display_name: true,
      organisation: true,
      message_credits_used: true,
      credits_reset_date: true,
      tier: true,
      tabular_model: true,
    },
  });

  if (!row) {
    if (!options.repairMissing) {
      return { data: null, error: new Error("Profile not found") };
    }
    await ensureProfileRow(client, userId);
    row = await client.query.user_profiles.findFirst({
      where: eq(user_profiles.user_id, userId),
      columns: {
        display_name: true,
        organisation: true,
        message_credits_used: true,
        credits_reset_date: true,
        tier: true,
        tabular_model: true,
      },
    });
    if (!row) {
      return { data: null, error: new Error("Failed to create profile") };
    }
  }

  if (row.credits_reset_date && new Date() > new Date(row.credits_reset_date)) {
    const creditsResetDate = new Date();
    creditsResetDate.setDate(creditsResetDate.getDate() + 30);
    const [updated] = await client
      .update(user_profiles)
      .set({
        message_credits_used: 0,
        credits_reset_date: creditsResetDate,
        updated_at: new Date(),
      })
      .where(eq(user_profiles.user_id, userId))
      .returning({
        display_name: user_profiles.display_name,
        organisation: user_profiles.organisation,
        message_credits_used: user_profiles.message_credits_used,
        credits_reset_date: user_profiles.credits_reset_date,
        tier: user_profiles.tier,
        tabular_model: user_profiles.tabular_model,
      });
    if (!updated) {
      return { data: null, error: new Error("Failed to reset credits") };
    }
    row = updated;
  }

  return { data: serializeProfile(row as UserProfileRow), error: null };
}

// POST /user/profile
userRouter.post("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  try {
    await ensureProfileRow(db, userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      detail: err instanceof Error ? err.message : "Failed to ensure profile",
    });
  }
});

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const { data, error } = await loadProfile(db, userId, { repairMissing: true });
  if (error) return void res.status(500).json({ detail: error.message });
  const apiKeyStatus = await getUserApiKeyStatus(userId, db);
  res.json({ ...data, apiKeyStatus });
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const parsed = validateProfilePayload(req.body);
  if (!parsed.ok) return void res.status(400).json({ detail: parsed.detail });

  try {
    await ensureProfileRow(db, userId);
    await db.update(user_profiles).set(parsed.update).where(eq(user_profiles.user_id, userId));
  } catch (err) {
    return void res.status(500).json({
      detail: err instanceof Error ? err.message : "Failed to update profile",
    });
  }

  const { data, error } = await loadProfile(db, userId);
  if (error) return void res.status(500).json({ detail: error.message });
  const apiKeyStatus = await getUserApiKeyStatus(userId, db);
  res.json({ ...data, apiKeyStatus });
});

// GET /user/api-keys
userRouter.get("/api-keys", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const status = await getUserApiKeyStatus(userId, db);
  res.json(status);
});

// PUT /user/api-keys/:provider
userRouter.put("/api-keys/:provider", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const provider = normalizeApiKeyProvider(req.params.provider);
  if (!provider) return void res.status(400).json({ detail: "Unsupported provider" });

  const body = req.body as { api_key?: unknown } | undefined;
  const apiKey = typeof body?.api_key === "string" ? body.api_key : null;
  try {
    if (hasEnvApiKey(provider)) {
      return void res.status(409).json({
        detail:
          "This provider is configured by the server environment and cannot be changed from the browser.",
      });
    }
    await saveUserApiKey(userId, provider, apiKey, db);
    const status = await getUserApiKeyStatus(userId, db);
    res.json(status);
  } catch (err) {
    console.error("[user/api-keys] save failed", {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ detail: "Failed to save API key" });
  }
});

// DELETE /user/account
userRouter.delete("/account", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const email = res.locals.userEmail as string | undefined;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    return void res.status(500).json({ detail: "Cognito is not configured" });
  }
  try {
    const cognito = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      ...(process.env.COGNITO_ENDPOINT ? { endpoint: process.env.COGNITO_ENDPOINT } : {}),
    });
    await cognito.send(
      new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: email || userId,
      }),
    );
    // Cascading FKs on public.users remove user_profiles, user_api_keys, etc.
    await db.delete(users).where(eq(users.id, userId));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({
      detail: err instanceof Error ? err.message : "Failed to delete account",
    });
  }
});
