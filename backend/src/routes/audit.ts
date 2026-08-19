// Audit history — GET /audit (JSON, paginated) + GET /audit/export (CSV).
// Visibility: the caller's own events, plus events in projects they own or
// that are shared with their email.

import { Router } from "express";
import { requireAuth, requireMfaIfEnrolled } from "../middleware/auth";
import { asyncRoute } from "../middleware/asyncRoute";
import { listAccessibleProjectIds } from "../lib/access";
import { createServerSupabase } from "../lib/supabase";
import { normalizeDisplayName } from "../lib/userLookup";

export const auditRouter = Router();
auditRouter.use(requireAuth);

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 2000;
// Clamp the requested page. Without a bound, ?page=99999999999999 produces an
// offset of ~5e15, which PostgREST rejects and surfaces as a 500. Capping the
// page keeps the offset well inside Postgres' integer range.
const MAX_PAGE = 100_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type AuditQuery = {
  q?: string;
  action?: string;
  status?: string;
  surface?: string;
  from?: string;
  to?: string;
  sortBy: AuditSortField;
  sortDirection: "asc" | "desc";
  page: number;
  limit: number;
};

const AUDIT_SORT_FIELDS = [
  "created_at",
  "user_email",
  "title",
  "model",
] as const;
type AuditSortField = (typeof AUDIT_SORT_FIELDS)[number];

export type ParseQueryResult =
  | { ok: true; query: AuditQuery }
  | { ok: false; error: string };

export function escapeLikePattern(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

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
  const requestedSortBy = str(raw.sort_by);
  const requestedSortDirection = str(raw.sort_dir);
  // Date filters come from <input type="date"> and are compared as calendar
  // days. Reject anything that isn't a bare YYYY-MM-DD — a value like
  // "2026-07-30T12:00:00Z" would become "...ZT23:59:59.999Z" (F8) and 500.
  if (from && !DATE_RE.test(from))
    return { ok: false, error: "Invalid 'from' date; expected YYYY-MM-DD" };
  if (to && !DATE_RE.test(to))
    return { ok: false, error: "Invalid 'to' date; expected YYYY-MM-DD" };
  if (
    requestedSortBy &&
    !AUDIT_SORT_FIELDS.includes(requestedSortBy as AuditSortField)
  ) {
    return { ok: false, error: "Invalid audit sort field" };
  }
  if (
    requestedSortDirection &&
    requestedSortDirection !== "asc" &&
    requestedSortDirection !== "desc"
  ) {
    return { ok: false, error: "Invalid audit sort direction" };
  }
  return {
    ok: true,
    query: {
      q: str(raw.q)?.slice(0, 200),
      action: str(raw.action)?.slice(0, 60),
      status: str(raw.status)?.slice(0, 20),
      surface: str(raw.surface)?.slice(0, 30),
      from,
      to,
      sortBy: (requestedSortBy as AuditSortField | undefined) ?? "created_at",
      sortDirection:
        (requestedSortDirection as "asc" | "desc" | undefined) ?? "desc",
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
  resolveDisplayNames = true,
) {
  // Shared with the chat listings: one definition of "projects this user can
  // see" for everything that scopes a collection query. A failure here rejects
  // rather than quietly narrowing the caller's visibility.
  const projectIds = await listAccessibleProjectIds(userId, email, db);
  let query = db
    .from("audit_events")
    .select(
      "id, created_at, user_id, user_email, action, status, title, surface, project_id, chat_id, document_id, review_id, model, detail",
      { count: "exact" },
    );
  query = projectIds.length
    ? query.or(`user_id.eq.${userId},project_id.in.(${projectIds.join(",")})`)
    : query.eq("user_id", userId);
  if (q.action) query = query.eq("action", q.action);
  if (q.status) query = query.eq("status", q.status);
  if (q.surface) query = query.eq("surface", q.surface);
  if (q.q) query = query.ilike("title", `%${escapeLikePattern(q.q)}%`);
  if (q.from) query = query.gte("created_at", q.from);
  if (q.to) query = query.lte("created_at", `${q.to}T23:59:59.999Z`);
  const result = await query
    .order(q.sortBy, {
      ascending: q.sortDirection === "asc",
      nullsFirst: false,
    })
    .range((q.page - 1) * q.limit, q.page * q.limit - 1);

  if (result.error || !result.data?.length) return result;

  const userIds = [
    ...new Set(
      result.data
        .map((event) => event.user_id as string | null)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
  const displayNameByUserId = new Map<string, string | null>();
  if (resolveDisplayNames) {
    const { data: profiles, error: profileError } = await db
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    if (!profileError) {
      for (const profile of profiles ?? []) {
        displayNameByUserId.set(
          profile.user_id as string,
          normalizeDisplayName(profile.display_name),
        );
      }
    }
  }

  return {
    ...result,
    data: result.data.map((row) => {
      const { user_id: userId, ...event } = row;
      return {
        ...event,
        user_display_name: displayNameByUserId.get(userId as string) ?? null,
      };
    }),
  };
}

auditRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const email = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();
    const parsed = parseQuery(req.query as Record<string, unknown>, PAGE_SIZE);
    if (!parsed.ok) return void res.status(400).json({ detail: parsed.error });
    const q = parsed.query;
    const { data, error, count } = await queryEvents(db, userId, email, q);
    if (error) return void res.status(500).json({ detail: error.message });
    res.json({
      events: data ?? [],
      total: count ?? 0,
      page: q.page,
      pageSize: PAGE_SIZE,
    });
  }),
);

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

auditRouter.get(
  "/export",
  requireMfaIfEnrolled,
  asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const email = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();
    const parsed = parseQuery(
      req.query as Record<string, unknown>,
      EXPORT_LIMIT,
    );
    if (!parsed.ok) return void res.status(400).json({ detail: parsed.error });
    const q = parsed.query;
    q.page = 1;
    // Resolve display names here too. Skipping resolution forced every
    // user_display_name to null, so the "user" column silently fell back to
    // the raw email and the export disagreed with the table on screen.
    const { data, error } = await queryEvents(db, userId, email, q);
    if (error) return void res.status(500).json({ detail: error.message });
    const header =
      "created_at,user,action,status,title,application,project_id,model";
    const rows = ((data ?? []) as Record<string, unknown>[]).map((e) =>
      [
        e.created_at,
        e.user_display_name ?? e.user_email,
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
  }),
);
