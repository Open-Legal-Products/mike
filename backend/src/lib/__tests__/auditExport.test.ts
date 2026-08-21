import { describe, it, expect } from "vitest";
import { AUDIT_EXPORT_LIMIT, buildAuditCsv, parseQuery } from "../auditExport";

// Chainable Supabase double: no accessible projects, and one fixed page of
// audit rows for the export query. Enough to exercise CSV assembly.
function makeDb(events: Record<string, unknown>[], error?: { message: string }) {
    const ranges: [number, number][] = [];
    function builder() {
        const b: Record<string, unknown> = {
            select: () => b,
            or: () => b,
            eq: () => b,
            ilike: () => b,
            gte: () => b,
            lte: () => b,
            contains: () => b,
            order: () => b,
            range: (from: number, to: number) => {
                ranges.push([from, to]);
                return Promise.resolve({
                    data: error ? null : events,
                    error: error ?? null,
                    count: events.length,
                });
            },
            then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return b;
    }
    return { db: { from: () => builder() } as never, ranges };
}

const QUERY = parseQuery({}, AUDIT_EXPORT_LIMIT);
const query = QUERY.ok ? QUERY.query : (undefined as never);

describe("buildAuditCsv", () => {
    // Display names are not resolved for the export (queryEvents is called
    // with resolveDisplayNames=false), so the "user" column is the email.
    it("emits the header and one row per event", async () => {
        const { db } = makeDb([
            {
                created_at: "2026-08-10T08:30:00.000Z",
                user_email: "lawyer@example.com",
                action: "document.edited",
                status: "completed",
                title: "Share purchase agreement",
                surface: "project",
                project_id: "p1",
                model: "gpt-5",
            },
        ]);
        const csv = await buildAuditCsv(db, "u1", "u1@example.com", query);
        expect(csv.split("\n")).toEqual([
            "created_at,user,action,status,title,application,project_id,model",
            "2026-08-10T08:30:00.000Z,lawyer@example.com,document.edited,completed,Share purchase agreement,project,p1,gpt-5",
        ]);
    });

    it("neutralizes spreadsheet formulas smuggled in through a title", async () => {
        const { db } = makeDb([
            { title: '=HYPERLINK("http://evil","click")', user_email: "a@b.test" },
        ]);
        const csv = await buildAuditCsv(db, "u1", undefined, query);
        // Leading single quote forces Excel/Sheets to treat it as literal text.
        expect(csv).toContain('"\'=HYPERLINK(""http://evil"",""click"")"');
    });

    it("always reads page 1 — the export is one flat window", async () => {
        const { db, ranges } = makeDb([]);
        await buildAuditCsv(db, "u1", undefined, { ...query, page: 7 });
        expect(ranges).toEqual([[0, AUDIT_EXPORT_LIMIT - 1]]);
    });

    it("throws on a query error so the export job retries", async () => {
        const { db } = makeDb([], { message: "connection reset" });
        await expect(
            buildAuditCsv(db, "u1", undefined, query),
        ).rejects.toThrow("connection reset");
    });
});
