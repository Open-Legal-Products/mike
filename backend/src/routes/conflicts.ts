import { Router } from "express";
import { requireAuth, requireMfaIfEnrolled } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import {
  conflictRecordInput,
  conflictReviewInput,
  conflictSearchInput,
  escapeLike,
  matchedFields,
  normalizedSearchText,
  searchTerms,
} from "../lib/conflicts";

export const conflictsRouter = Router();
conflictsRouter.use(requireAuth, requireMfaIfEnrolled);

const RECORD_COLUMNS =
  "id, client_name, matter_name, parties, affiliates, created_at, updated_at";

function validationError(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid conflicts-check input";
}

async function audit(
  db: ReturnType<typeof createServerSupabase>,
  ownerUserId: string,
  action: "record.created" | "search.performed" | "review.decided",
  links: { record_id?: string; search_id?: string; detail?: object },
) {
  const { error } = await db.from("conflict_audit_events").insert({
    owner_user_id: ownerUserId,
    actor_user_id: ownerUserId,
    action,
    record_id: links.record_id ?? null,
    search_id: links.search_id ?? null,
    detail: links.detail ?? null,
  });
  if (error) console.error("[conflicts/audit] insert failed:", error.message);
}

conflictsRouter.get("/records", async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { data, error } = await db
    .from("conflict_records")
    .select(RECORD_COLUMNS)
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error)
    return void res
      .status(500)
      .json({ detail: "Unable to load conflict records" });
  res.json({ records: data ?? [] });
});

conflictsRouter.post("/records", async (req, res) => {
  const parsed = conflictRecordInput.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ detail: validationError(parsed.error) });
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const input = parsed.data;
  const { data, error } = await db
    .from("conflict_records")
    .insert({
      owner_user_id: userId,
      client_name: input.clientName,
      matter_name: input.matterName ?? null,
      parties: input.parties,
      affiliates: input.affiliates,
      search_text: normalizedSearchText(input),
    })
    .select(RECORD_COLUMNS)
    .single();
  if (error || !data)
    return void res
      .status(500)
      .json({ detail: "Unable to create conflict record" });
  await audit(db, userId, "record.created", { record_id: data.id });
  res.status(201).json({ record: data });
});

conflictsRouter.post("/searches", async (req, res) => {
  const parsed = conflictSearchInput.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ detail: validationError(parsed.error) });
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const terms = searchTerms(parsed.data);
  // Keep user input in parameter values instead of interpolating it into a
  // PostgREST `.or(...)` expression. Besides escaping LIKE wildcards, this
  // prevents punctuation in a name from changing the filter grammar.
  const termResults = await Promise.all(
    terms.map((term) =>
      db
        .from("conflict_records")
        .select(RECORD_COLUMNS)
        .eq("owner_user_id", userId)
        .ilike("search_text", `%${escapeLike(term)}%`)
        .order("created_at", { ascending: false })
        .limit(50),
    ),
  );
  if (termResults.some((result) => result.error))
    return void res
      .status(500)
      .json({ detail: "Unable to search conflict records" });
  const byId = new Map<string, any>();
  for (const result of termResults) {
    for (const row of result.data ?? []) byId.set(row.id, row);
  }
  const rows = [...byId.values()]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 50);
  const records = (rows ?? []).map((row) => ({
    ...row,
    matched_fields: matchedFields(row, parsed.data),
  }));
  const { data: search, error: insertError } = await db
    .from("conflict_searches")
    .insert({
      owner_user_id: userId,
      search_input: parsed.data,
      matched_record_ids: records.map((record) => record.id),
      result_count: records.length,
      status: "pending_review",
    })
    .select(
      "id, search_input, result_count, status, reviewer_notes, reviewed_at, created_at",
    )
    .single();
  if (insertError || !search)
    return void res
      .status(500)
      .json({ detail: "Unable to record conflict search" });
  await audit(db, userId, "search.performed", {
    search_id: search.id,
    detail: { result_count: records.length },
  });
  res.status(201).json({
    search,
    records,
    disclaimer:
      "Potential matches are search aids only. A qualified human reviewer must decide whether a conflict exists and whether the matter may proceed.",
  });
});

conflictsRouter.get("/searches", async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { data, error } = await db
    .from("conflict_searches")
    .select(
      "id, search_input, result_count, status, reviewer_notes, reviewed_at, created_at",
    )
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error)
    return void res
      .status(500)
      .json({ detail: "Unable to load conflict searches" });
  res.json({ searches: data ?? [] });
});

conflictsRouter.patch("/searches/:searchId/review", async (req, res) => {
  const parsed = conflictReviewInput.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ detail: validationError(parsed.error) });
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { data, error } = await db
    .from("conflict_searches")
    .update({
      status: parsed.data.status,
      reviewer_notes: parsed.data.notes,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.searchId)
    .eq("owner_user_id", userId)
    .select(
      "id, search_input, result_count, status, reviewer_notes, reviewed_at, created_at",
    )
    .maybeSingle();
  if (error)
    return void res
      .status(500)
      .json({ detail: "Unable to record review decision" });
  if (!data)
    return void res.status(404).json({ detail: "Conflict search not found" });
  await audit(db, userId, "review.decided", {
    search_id: data.id,
    detail: { status: parsed.data.status },
  });
  res.json({ search: data });
});

conflictsRouter.get("/audit", async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { data, error } = await db
    .from("conflict_audit_events")
    .select("id, action, record_id, search_id, detail, created_at")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error)
    return void res
      .status(500)
      .json({ detail: "Unable to load conflicts audit history" });
  res.json({ events: data ?? [] });
});
