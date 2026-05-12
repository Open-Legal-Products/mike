import { Router } from "express";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middleware/auth";
import { db } from "../lib/db";
import { userProfiles } from "../db/schema";
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

const PROFILE_COLUMNS = {
  display_name: userProfiles.displayName,
  organisation: userProfiles.organisation,
  message_credits_used: userProfiles.messageCreditsUsed,
  credits_reset_date: userProfiles.creditsResetDate,
  tier: userProfiles.tier,
  tabular_model: userProfiles.tabularModel,
} as const;

type UserProfileRow = {
  display_name: string | null;
  organisation: string | null;
  message_credits_used: number;
  credits_reset_date: Date | string;
  tier: string;
  tabular_model: string;
};

function serializeProfile(
  row: UserProfileRow,
  apiKeyStatus?: ApiKeyStatus,
) {
  const creditsUsed = row.message_credits_used ?? 0;
  const resetDate =
    row.credits_reset_date instanceof Date
      ? row.credits_reset_date.toISOString()
      : row.credits_reset_date;
  return {
    displayName: row.display_name,
    organisation: row.organisation,
    messageCreditsUsed: creditsUsed,
    creditsResetDate: resetDate,
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
        displayName?: string | null;
        organisation?: string | null;
        tabularModel?: string;
        updatedAt: Date;
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
    "tabularModel",
  ]);
  const invalidField = Object.keys(raw).find((key) => !allowedFields.has(key));
  if (invalidField) {
    return { ok: false, detail: `Unsupported profile field: ${invalidField}` };
  }

  const update: {
    displayName?: string | null;
    organisation?: string | null;
    tabularModel?: string;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if ("displayName" in raw) {
    if (raw.displayName !== null && typeof raw.displayName !== "string") {
      return { ok: false, detail: "displayName must be a string or null" };
    }
    update.displayName =
      typeof raw.displayName === "string"
        ? raw.displayName.trim() || null
        : null;
  }

  if ("organisation" in raw) {
    if (raw.organisation !== null && typeof raw.organisation !== "string") {
      return { ok: false, detail: "organisation must be a string or null" };
    }
    update.organisation =
      typeof raw.organisation === "string"
        ? raw.organisation.trim() || null
        : null;
  }

  if ("tabularModel" in raw) {
    if (typeof raw.tabularModel !== "string") {
      return { ok: false, detail: "tabularModel must be a string" };
    }
    const resolved = resolveModel(raw.tabularModel, "");
    if (!resolved) {
      return { ok: false, detail: "Unsupported tabularModel" };
    }
    update.tabularModel = resolved;
  }

  return { ok: true, update };
}

async function ensureProfileRow(userId: string): Promise<void> {
  await db
    .insert(userProfiles)
    .values({ userId })
    .onConflictDoNothing({ target: userProfiles.userId });
}

async function loadProfile(
  userId: string,
  options: { repairMissing?: boolean } = {},
): Promise<
  | { data: ReturnType<typeof serializeProfile>; error: null }
  | { data: null; error: Error }
> {
  let [row] = await db
    .select(PROFILE_COLUMNS)
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (!row) {
    if (!options.repairMissing) {
      return { data: null, error: new Error("Profile not found") };
    }
    await ensureProfileRow(userId);
    [row] = await db
      .select(PROFILE_COLUMNS)
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    if (!row) {
      return { data: null, error: new Error("Profile not found") };
    }
  }

  if (row.credits_reset_date && new Date() > new Date(row.credits_reset_date)) {
    const creditsResetDate = new Date();
    creditsResetDate.setDate(creditsResetDate.getDate() + 30);
    const [resetRow] = await db
      .update(userProfiles)
      .set({
        messageCreditsUsed: 0,
        creditsResetDate,
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId))
      .returning(PROFILE_COLUMNS);
    if (!resetRow) {
      return { data: null, error: new Error("Profile not found") };
    }
    row = resetRow;
  }

  return { data: serializeProfile(row as UserProfileRow), error: null };
}

// POST /user/profile
userRouter.post("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  await ensureProfileRow(userId);
  res.json({ ok: true });
});

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const { data, error } = await loadProfile(userId, { repairMissing: true });
  if (error) return void res.status(500).json({ detail: error.message });
  const apiKeyStatus = await getUserApiKeyStatus(userId);
  res.json({ ...data, apiKeyStatus });
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const parsed = validateProfilePayload(req.body);
  if (!parsed.ok) return void res.status(400).json({ detail: parsed.detail });

  await ensureProfileRow(userId);
  await db
    .update(userProfiles)
    .set(parsed.update)
    .where(eq(userProfiles.userId, userId));

  const { data, error } = await loadProfile(userId);
  if (error) return void res.status(500).json({ detail: error.message });
  const apiKeyStatus = await getUserApiKeyStatus(userId);
  res.json({ ...data, apiKeyStatus });
});

// GET /user/api-keys
userRouter.get("/api-keys", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const status = await getUserApiKeyStatus(userId);
  res.json(status);
});

// PUT /user/api-keys/:provider
userRouter.put("/api-keys/:provider", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const provider = normalizeApiKeyProvider(req.params.provider);
  if (!provider)
    return void res.status(400).json({ detail: "Unsupported provider" });

  const apiKey =
    typeof req.body?.api_key === "string" ? req.body.api_key : null;
  try {
    if (hasEnvApiKey(provider)) {
      return void res.status(409).json({
        detail:
          "This provider is configured by the server environment and cannot be changed from the browser.",
      });
    }
    await saveUserApiKey(userId, provider, apiKey);
    const status = await getUserApiKeyStatus(userId);
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
//
// Identity is owned by Clerk after the migration — actual user deletion must
// happen via the Clerk Backend API, not via a Supabase admin client. We delete
// the local profile row here; full Clerk account deletion is wired separately
// once we expose it from the frontend.
userRouter.delete("/account", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  res.status(204).send();
});
