import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { encryptApiKey, hasStoredApiKey } from "../lib/apiKeys";
import { resolveModel, DEFAULT_TABULAR_MODEL } from "../lib/llm";

export const userRouter = Router();

type ProfileRow = {
  display_name: string | null;
  organisation: string | null;
  message_credits_used: number;
  credits_reset_date: string;
  tier: string;
  tabular_model: string;
  claude_api_key: string | null;
  gemini_api_key: string | null;
};

function safeProfile(row: ProfileRow) {
  return {
    display_name: row.display_name,
    organisation: row.organisation,
    message_credits_used: row.message_credits_used,
    credits_reset_date: row.credits_reset_date,
    tier: row.tier,
    tabular_model: resolveModel(row.tabular_model, DEFAULT_TABULAR_MODEL),
    has_claude_api_key: hasStoredApiKey(row.claude_api_key),
    has_gemini_api_key: hasStoredApiKey(row.gemini_api_key),
  };
}

async function ensureProfile(
  userId: string,
  db: ReturnType<typeof createServerSupabase>,
) {
  await db
    .from("user_profiles")
    .upsert(
      { user_id: userId },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
}

// POST /user/profile
userRouter.post("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { error } = await db.from("user_profiles").upsert(
    { user_id: userId },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (error) return void res.status(500).json({ detail: error.message });
  res.json({ ok: true });
});

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  await ensureProfile(userId, db);
  const { data, error } = await db
    .from("user_profiles")
    .select(
      "display_name, organisation, message_credits_used, credits_reset_date, tier, tabular_model, claude_api_key, gemini_api_key",
    )
    .eq("user_id", userId)
    .single();
  if (error || !data)
    return void res
      .status(500)
      .json({ detail: error?.message ?? "Profile not found" });
  res.json(safeProfile(data as ProfileRow));
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  await ensureProfile(userId, db);

  const updates: Record<string, unknown> = {};
  if (typeof req.body.display_name === "string") {
    updates.display_name = req.body.display_name.trim().slice(0, 200) || null;
  }
  if (typeof req.body.organisation === "string") {
    updates.organisation = req.body.organisation.trim().slice(0, 200) || null;
  }
  if (typeof req.body.tabular_model === "string") {
    updates.tabular_model = resolveModel(
      req.body.tabular_model,
      DEFAULT_TABULAR_MODEL,
    );
  }
  if (req.body.api_keys && typeof req.body.api_keys === "object") {
    const apiKeys = req.body.api_keys as {
      claude?: string | null;
      gemini?: string | null;
    };
    if ("claude" in apiKeys) {
      updates.claude_api_key = encryptApiKey(apiKeys.claude);
    }
    if ("gemini" in apiKeys) {
      updates.gemini_api_key = encryptApiKey(apiKeys.gemini);
    }
  }
  if (req.body.increment_message_credits === true) {
    const { data: current } = await db
      .from("user_profiles")
      .select("message_credits_used")
      .eq("user_id", userId)
      .single();
    updates.message_credits_used =
      ((current?.message_credits_used as number | null) ?? 0) + 1;
  }

  if (Object.keys(updates).length === 0) {
    return void res.status(400).json({ detail: "No supported fields to update" });
  }

  const { data, error } = await db
    .from("user_profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select(
      "display_name, organisation, message_credits_used, credits_reset_date, tier, tabular_model, claude_api_key, gemini_api_key",
    )
    .single();
  if (error || !data)
    return void res
      .status(500)
      .json({ detail: error?.message ?? "Failed to update profile" });
  res.json(safeProfile(data as ProfileRow));
});

// DELETE /user/account
userRouter.delete("/account", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
});
