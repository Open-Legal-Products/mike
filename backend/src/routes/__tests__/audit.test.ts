import { describe, it, expect } from "vitest";
import {
    csvCell,
    parseQuery,
    queryEvents,
    accessibleProjectIds,
} from "../audit";

// ---------------------------------------------------------------------------
// csvCell — spreadsheet formula-injection escaping (F3)
// ---------------------------------------------------------------------------

describe("csvCell", () => {
    it("prefixes a single quote to values that begin with a formula trigger", () => {
        for (const trigger of ["=", "+", "-", "@", "\t", "\r"]) {
            const payload = `${trigger}HYPERLINK("http://evil","x")`;
            const cell = csvCell(payload);
            // Leading quote neutralizes evaluation; the whole value is then
            // quoted because it contains characters requiring CSV quoting.
            expect(cell.startsWith(`"'${trigger}`)).toBe(true);
        }
    });

    it("neutralizes a bare leading = even without other special chars", () => {
        expect(csvCell("=1")).toBe("'=1");
    });

    it("quotes and escapes embedded quotes, commas, and newlines", () => {
        expect(csvCell('a,b')).toBe('"a,b"');
        expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
        expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    });

    it("leaves ordinary values untouched and renders null as empty", () => {
        expect(csvCell("brief.docx")).toBe("brief.docx");
        expect(csvCell(null)).toBe("");
        expect(csvCell(undefined)).toBe("");
    });
});

// ---------------------------------------------------------------------------
// parseQuery — page clamping (F7) + date validation (F8)
// ---------------------------------------------------------------------------

describe("parseQuery", () => {
    it("clamps an absurd page so the offset can't overflow", () => {
        const result = parseQuery({ page: "99999999999999" }, 50);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.query.page).toBe(100_000);
            // offset stays well within Postgres' integer range.
            expect((result.query.page - 1) * result.query.limit).toBeLessThan(
                2_147_483_647,
            );
        }
    });

    it("floors non-positive or non-numeric pages to 1", () => {
        for (const page of ["0", "-5", "abc", ""]) {
            const result = parseQuery({ page }, 50);
            expect(result.ok && result.query.page).toBe(1);
        }
    });

    it("rejects from/to that are not bare YYYY-MM-DD", () => {
        expect(parseQuery({ to: "2026-07-30T12:00:00Z" }, 50)).toEqual({
            ok: false,
            error: expect.stringContaining("to"),
        });
        expect(parseQuery({ from: "not-a-date" }, 50)).toEqual({
            ok: false,
            error: expect.stringContaining("from"),
        });
    });

    it("accepts well-formed dates and trims free-text filters", () => {
        const result = parseQuery(
            { from: "2026-07-01", to: "2026-07-31", q: "  hello  ", action: " chat.message " },
            50,
        );
        expect(result).toMatchObject({
            ok: true,
            query: {
                from: "2026-07-01",
                to: "2026-07-31",
                q: "hello",
                action: "chat.message",
            },
        });
    });
});

// ---------------------------------------------------------------------------
// queryEvents / accessibleProjectIds — visibility scoping
// ---------------------------------------------------------------------------

/**
 * Chainable Supabase mock. `projects` select responses are keyed by whether the
 * query used .eq (owned) or .contains (shared). The audit_events builder
 * records the .or / .eq filter it was given so tests can assert scoping.
 */
function makeDb(owned: string[], shared: string[]) {
    const calls: { or?: string; eq?: [string, unknown] } = {};

    function projectsBuilder() {
        let mode: "owned" | "shared" = "owned";
        const b: any = {
            select: () => b,
            eq: () => {
                mode = "owned";
                return b;
            },
            contains: () => {
                mode = "shared";
                return b;
            },
            then: (resolve: (v: { data: { id: string }[] }) => unknown) =>
                Promise.resolve({
                    data: (mode === "owned" ? owned : shared).map((id) => ({ id })),
                }).then(resolve),
        };
        return b;
    }

    function auditBuilder() {
        const b: any = {
            select: () => b,
            or: (expr: string) => {
                calls.or = expr;
                return b;
            },
            eq: (col: string, val: unknown) => {
                calls.eq = [col, val];
                return b;
            },
            ilike: () => b,
            gte: () => b,
            lte: () => b,
            order: () => b,
            range: () =>
                Promise.resolve({ data: [], error: null, count: 0 }),
        };
        return b;
    }

    const db = {
        from(table: string) {
            return table === "projects" ? projectsBuilder() : auditBuilder();
        },
    };
    return { db: db as any, calls };
}

describe("queryEvents visibility scoping", () => {
    const query = { page: 1, limit: 50 } as const;

    it("scopes to own events OR accessible project events (owned + shared)", async () => {
        const { db, calls } = makeDb(["p-own"], ["p-shared"]);
        await queryEvents(db, "u1", "u1@example.com", query);
        expect(calls.or).toBe("user_id.eq.u1,project_id.in.(p-own,p-shared)");
        expect(calls.eq).toBeUndefined();
    });

    it("falls back to own-events-only when no projects are accessible", async () => {
        const { db, calls } = makeDb([], []);
        await queryEvents(db, "u1", "u1@example.com", query);
        expect(calls.or).toBeUndefined();
        expect(calls.eq).toEqual(["user_id", "u1"]);
    });

    it("de-duplicates owned and shared project ids", async () => {
        const both = await accessibleProjectIds(
            makeDb(["p1", "p2"], ["p2", "p3"]).db,
            "u1",
            "u1@example.com",
        );
        expect([...both].sort()).toEqual(["p1", "p2", "p3"]);
    });
});
