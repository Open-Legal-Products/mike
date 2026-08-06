// Audit history — GET /audit (JSON, paginated) + GET /audit/export (CSV).
// Visibility: the caller's own events, plus events in projects they own or
// that are shared with their email.

import { Router } from "express";
import { requireAuth, requireMfaIfEnrolled } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";

export const auditRouter = Router();
auditRouter.use(requireAuth);

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 2000;
// Clamp the requested page. Without a bound, ?page=99999999999999 produces an
// offset of ~5e15, which PostgREST rejects and surfaces as a 500. Capping the
// page keeps the offset well inside Postgres' integer range.
const MAX_PAGE = 100_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function accessibleProjectIds(
  db: ReturnType<typeof createServerSupabase>,
  userId: string,
  email: string | undefined,
): Promise<string[]> {
  const ids = new Set<string>();
  const own = await db.from("projects").select("id").eq("user_id", userId);
  for (const row of (own.data ?? []) as { id: string }[]) ids.add(row.id);
  if (email) {
    const shared = await db
      .from("projects")
      .select("id")
      .contains("shared_with", [email]);
    for (const row of (shared.data ?? []) as { id: string }[]) ids.add(row.id);
  }
  return [...ids];
}

type AuditQuery = {
  q?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
};

export type ParseQueryResult =
  | { ok: true; query: AuditQuery }
  | { ok: false; error: string };

export function parseQuery(
  raw: Record<string, unknown>,
  limit: number,
): ParseQueryResult {
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  // Clamp page into [1, MAX_PAGE] so a huge ?page= can't overflow the offset.
  const parsedPage = Number.parseInt(String(raw.page ?? "1"), 10) || 1;
  const page = Math.min(Math.max(parsedPage, 1), MAX_PAGE);
  const from = str(raw.from);
  const to = str(raw.to);
  // Date filters come from <input type="date"> and are compared as calendar
  // days. Reject anything that isn't a bare YYYY-MM-DD — a value like
  // "2026-07-30T12:00:00Z" would become "...ZT23:59:59.999Z" (F8) and 500.
  if (from && !DATE_RE.test(from))
    return { ok: false, error: "Invalid 'from' date; expected YYYY-MM-DD" };
  if (to && !DATE_RE.test(to))
    return { ok: false, error: "Invalid 'to' date; expected YYYY-MM-DD" };
  return {
    ok: true,
    query: {
      q: str(raw.q)?.slice(0, 200),
      action: str(raw.action)?.slice(0, 60),
      from,
      to,
      page,
      limit,
    },
  };
}

export async function queryEvents(
  db: ReturnType<typeof createServerSupabase>,
  userId: string,
  email: string | undefined,
  q: AuditQuery,
) {
  const projectIds = await accessibleProjectIds(db, userId, email);
  let query = db
    .from("audit_events")
    .select(
      "id, created_at, user_email, action, status, title, surface, project_id, chat_id, document_id, review_id, model, detail",
      { count: "exact" },
    );
  query = projectIds.length
    ? query.or(
        `user_id.eq.${userId},project_id.in.(${projectIds.join(",")})`,
      )
    : query.eq("user_id", userId);
  if (q.action) query = query.eq("action", q.action);
  if (q.q) query = query.ilike("title", `%${q.q.replace(/[%_]/g, "\\$&")}%`);
  if (q.from) query = query.gte("created_at", q.from);
  if (q.to) query = query.lte("created_at", `${q.to}T23:59:59.999Z`);
  return query
    .order("created_at", { ascending: false })
    .range((q.page - 1) * q.limit, q.page * q.limit - 1);
}

auditRouter.get("/", async (req, res) => {
  const userId = res.locals.userId as string;
  const email = res.locals.userEmail as string | undefined;
  const db = createServerSupabase();
  const parsed = parseQuery(req.query as Record<string, unknown>, PAGE_SIZE);
  if (!parsed.ok) return void res.status(400).json({ detail: parsed.error });
  const q = parsed.query;
  const { data, error, count } = await queryEvents(db, userId, email, q);
  if (error) return void res.status(500).json({ detail: error.message });
  res.json({ events: data ?? [], total: count ?? 0, page: q.page, pageSize: PAGE_SIZE });
});

export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralize spreadsheet formula injection: Excel/Sheets evaluate any cell
  // whose text begins with = + - @, a tab or a carriage return as a formula on
  // open. Titles are attacker-controllable across shared projects, so an
  // =HYPERLINK(...) payload would execute in the victim's spreadsheet. Prefix a
  // single quote to force the value to be treated as literal text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

auditRouter.get("/export", requireMfaIfEnrolled, async (req, res) => {
  const userId = res.locals.userId as string;
  const email = res.locals.userEmail as string | undefined;
  const db = createServerSupabase();
  const parsed = parseQuery(req.query as Record<string, unknown>, EXPORT_LIMIT);
  if (!parsed.ok) return void res.status(400).json({ detail: parsed.error });
  const q = parsed.query;
  q.page = 1;
  const { data, error } = await queryEvents(db, userId, email, q);
  if (error) return void res.status(500).json({ detail: error.message });
  const header = "created_at,user,action,status,title,application,project_id,model";
  const rows = ((data ?? []) as Record<string, unknown>[]).map((e) =>
    [
      e.created_at,
      e.user_email,
      e.action,
      e.status,
      e.title,
      e.surface,
      e.project_id,
      e.model,
    ]
      .map(csvCell)
      .join(","),
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="history-export.csv"',
  );
  res.send([header, ...rows].join("\n"));
});
