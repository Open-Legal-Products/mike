// A small stateful in-memory stand-in for the Supabase client, supporting the
// exact query shapes the DMS code uses: select/insert/update/delete/upsert with
// eq/in/gt/is filters, order/limit, and single/maybeSingle terminals plus
// direct-await (thenable). Deliberately minimal — not a general Supabase mock.
import crypto from "crypto";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeDb {
    from(table: string): QueryBuilder;
    _tables: Record<string, Row[]>;
}

class QueryBuilder {
    private filters: Filter[] = [];
    private op: "select" | "insert" | "update" | "delete" | "upsert" =
        "select";
    private payload: Row | Row[] | null = null;
    private onConflict?: string;
    private wantWritten = false;
    private orderSpec: { col: string; asc: boolean } | null = null;
    private limitN: number | null = null;
    private ran: { data: Row[]; error: { message: string } | null } | null =
        null;

    constructor(
        private readonly tables: Record<string, Row[]>,
        private readonly table: string,
    ) {}

    private get rows(): Row[] {
        return (this.tables[this.table] ??= []);
    }

    private match(rows: Row[]): Row[] {
        return rows.filter((r) => this.filters.every((f) => f(r)));
    }

    select(_cols?: string): this {
        if (this.op !== "select") this.wantWritten = true;
        return this;
    }
    insert(payload: Row | Row[]): this {
        this.op = "insert";
        this.payload = payload;
        return this;
    }
    update(payload: Row): this {
        this.op = "update";
        this.payload = payload;
        return this;
    }
    upsert(payload: Row | Row[], opts?: { onConflict?: string }): this {
        this.op = "upsert";
        this.payload = payload;
        this.onConflict = opts?.onConflict;
        return this;
    }
    delete(): this {
        this.op = "delete";
        return this;
    }
    eq(col: string, val: unknown): this {
        this.filters.push((r) => r[col] === val);
        return this;
    }
    neq(col: string, val: unknown): this {
        this.filters.push((r) => r[col] !== val);
        return this;
    }
    in(col: string, vals: unknown[]): this {
        this.filters.push((r) => vals.includes(r[col]));
        return this;
    }
    gt(col: string, val: unknown): this {
        this.filters.push((r) => String(r[col]) > String(val));
        return this;
    }
    lt(col: string, val: unknown): this {
        this.filters.push((r) => String(r[col]) < String(val));
        return this;
    }
    is(col: string, val: unknown): this {
        this.filters.push((r) => r[col] === val);
        return this;
    }
    order(col: string, opts?: { ascending?: boolean }): this {
        this.orderSpec = { col, asc: opts?.ascending !== false };
        return this;
    }
    limit(n: number): this {
        this.limitN = n;
        return this;
    }

    private run(): { data: Row[]; error: { message: string } | null } {
        if (this.ran) return this.ran;
        let result: Row[] = [];
        if (this.op === "select") {
            result = this.match(this.rows);
            if (this.orderSpec) {
                const { col, asc } = this.orderSpec;
                result = [...result].sort((a, b) => {
                    const av = String(a[col] ?? "");
                    const bv = String(b[col] ?? "");
                    return asc ? av.localeCompare(bv) : bv.localeCompare(av);
                });
            }
            if (this.limitN != null) result = result.slice(0, this.limitN);
        } else if (this.op === "insert") {
            const arr = Array.isArray(this.payload)
                ? this.payload
                : [this.payload as Row];
            const inserted = arr.map((r) => stamp(r));
            this.rows.push(...inserted);
            result = this.wantWritten ? inserted : [];
        } else if (this.op === "update") {
            const matched = this.match(this.rows);
            for (const r of matched) Object.assign(r, this.payload);
            result = this.wantWritten ? matched : [];
        } else if (this.op === "upsert") {
            const arr = Array.isArray(this.payload)
                ? this.payload
                : [this.payload as Row];
            const written: Row[] = [];
            for (const r of arr) {
                const key = this.onConflict;
                const idx = key
                    ? this.rows.findIndex((x) => x[key] === r[key])
                    : -1;
                if (idx >= 0) {
                    Object.assign(this.rows[idx], r);
                    written.push(this.rows[idx]);
                } else {
                    const row = stamp(r);
                    this.rows.push(row);
                    written.push(row);
                }
            }
            result = this.wantWritten ? written : [];
        } else if (this.op === "delete") {
            this.tables[this.table] = this.rows.filter(
                (r) => !this.filters.every((f) => f(r)),
            );
            result = [];
        }
        this.ran = { data: result, error: null };
        return this.ran;
    }

    single(): Promise<{ data: Row | null; error: { message: string } | null }> {
        const { data } = this.run();
        if (!data.length) {
            return Promise.resolve({
                data: null,
                error: { message: "No rows found" },
            });
        }
        return Promise.resolve({ data: data[0], error: null });
    }
    maybeSingle(): Promise<{
        data: Row | null;
        error: { message: string } | null;
    }> {
        const { data } = this.run();
        return Promise.resolve({ data: data[0] ?? null, error: null });
    }
    then(
        resolve: (v: {
            data: Row[] | null;
            error: { message: string } | null;
        }) => unknown,
    ) {
        const { data, error } = this.run();
        return Promise.resolve(resolve({ data, error }));
    }
}

function stamp(r: Row): Row {
    const now = new Date().toISOString();
    return {
        id: r.id ?? crypto.randomUUID(),
        created_at: r.created_at ?? now,
        updated_at: r.updated_at ?? now,
        ...r,
    };
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}): FakeDb {
    const tables: Record<string, Row[]> = {};
    for (const [k, v] of Object.entries(seed)) {
        tables[k] = v.map((r) => ({ ...r }));
    }
    return {
        _tables: tables,
        from(table: string) {
            return new QueryBuilder(tables, table);
        },
    };
}
