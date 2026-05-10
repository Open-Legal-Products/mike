/**
 * Minimal PostgreSQL query builder that mirrors the subset of the
 * Supabase JS client API used throughout the backend routes.
 *
 * Returns `{ data, error }` (and `count` for COUNT queries) in the same
 * shape as PostgREST, so route code needs zero changes once the db
 * factory returns a PgAdapter instead of the Supabase client.
 */

import { Pool } from "pg";

type Row = Record<string, unknown>;
type QueryResult<T> = { data: T; error: null; count?: number | null } | { data: null; error: { message: string }; count?: null };
type Operation = "select" | "insert" | "update" | "delete" | "upsert";

// Conditions store sql with '?' placeholders plus the corresponding values.
// resolveParams() replaces each '?' with the correct $n at query-build time.
interface Condition {
    sql: string;
    params: unknown[];
}

function resolveParams(conditions: Condition[]): { clauses: string[]; params: unknown[] } {
    const params: unknown[] = [];
    const clauses: string[] = [];
    for (const cond of conditions) {
        let sql = cond.sql;
        for (const p of cond.params) {
            params.push(p);
            sql = sql.replace("?", `$${params.length}`);
        }
        clauses.push(sql);
    }
    return { clauses, params };
}

// PostgREST OR filter syntax: "col.op.val,col.op.(v1,v2)"
function splitOrTokens(filter: string): string[] {
    const tokens: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < filter.length; i++) {
        if (filter[i] === "(") depth++;
        else if (filter[i] === ")") depth--;
        else if (filter[i] === "," && depth === 0) {
            tokens.push(filter.slice(start, i));
            start = i + 1;
        }
    }
    tokens.push(filter.slice(start));
    return tokens;
}

function parseOrFilter(filter: string): Condition {
    const tokens = splitOrTokens(filter);
    const parts: Condition[] = [];
    for (const token of tokens) {
        const firstDot = token.indexOf(".");
        const col = token.slice(0, firstDot);
        const rest = token.slice(firstDot + 1);
        const secondDot = rest.indexOf(".");
        const op = rest.slice(0, secondDot);
        const val = rest.slice(secondDot + 1);
        if (op === "eq") {
            parts.push({ sql: `${col} = ?`, params: [val] });
        } else if (op === "in") {
            const inner = val.slice(1, -1);
            const vals = inner ? inner.split(",") : [];
            if (vals.length === 0) {
                parts.push({ sql: "FALSE", params: [] });
            } else {
                const placeholders = vals.map(() => "?").join(", ");
                parts.push({ sql: `${col} IN (${placeholders})`, params: vals });
            }
        }
    }
    return {
        sql: `(${parts.map((p) => p.sql).join(" OR ")})`,
        params: parts.flatMap((p) => p.params),
    };
}

export class PgQueryBuilder {
    private _pool: Pool;
    private _table: string;
    private _op: Operation = "select";
    private _cols = "*";
    private _countMode = false;
    private _conditions: Condition[] = [];
    private _orderClauses: string[] = [];
    private _limitVal?: number;
    private _singleMode = false;
    private _maybeSingleMode = false;
    private _insertData?: Row | Row[];
    private _updateData?: Row;
    private _upsertConflict?: string;
    private _withReturning = false;
    private _orCond?: Condition;

    constructor(pool: Pool, table: string) {
        this._pool = pool;
        this._table = table;
    }

    select(cols = "*", opts?: { count?: "exact"; head?: boolean }): this {
        if (this._op === "insert" || this._op === "update" || this._op === "upsert") {
            // Chained after a mutation: add RETURNING clause
            this._withReturning = true;
            this._cols = cols;
        } else {
            this._op = "select";
            this._countMode = opts?.count === "exact";
            this._cols = cols;
        }
        return this;
    }

    insert(data: Row | Row[]): this {
        this._op = "insert";
        this._insertData = data;
        return this;
    }

    update(data: Row): this {
        this._op = "update";
        this._updateData = data;
        return this;
    }

    delete(): this {
        this._op = "delete";
        return this;
    }

    upsert(data: Row | Row[], opts?: { onConflict?: string }): this {
        this._op = "upsert";
        this._insertData = data;
        this._upsertConflict = opts?.onConflict;
        return this;
    }

    eq(col: string, val: unknown): this {
        if (val === null) {
            this._conditions.push({ sql: `${col} IS NULL`, params: [] });
        } else {
            this._conditions.push({ sql: `${col} = ?`, params: [val] });
        }
        return this;
    }

    neq(col: string, val: unknown): this {
        this._conditions.push({ sql: `${col} != ?`, params: [val] });
        return this;
    }

    in(col: string, vals: unknown[]): this {
        if (vals.length === 0) {
            this._conditions.push({ sql: "FALSE", params: [] });
        } else {
            const placeholders = vals.map(() => "?").join(", ");
            this._conditions.push({ sql: `${col} IN (${placeholders})`, params: vals });
        }
        return this;
    }

    is(col: string, val: null | boolean): this {
        if (val === null) {
            this._conditions.push({ sql: `${col} IS NULL`, params: [] });
        } else {
            this._conditions.push({ sql: `${col} IS ${val ? "TRUE" : "FALSE"}`, params: [] });
        }
        return this;
    }

    filter(col: string, op: string, val: unknown): this {
        if (op === "cs") {
            this._conditions.push({ sql: `${col} @> ?::jsonb`, params: [val] });
        }
        return this;
    }

    not(col: string, op: string, val: unknown): this {
        if (op === "is") {
            this._conditions.push({ sql: `${col} IS NOT NULL`, params: [] });
        } else if (op === "eq") {
            this._conditions.push({ sql: `${col} != ?`, params: [val] });
        } else if (op === "in") {
            const vals = Array.isArray(val) ? val : [val];
            const placeholders = vals.map(() => "?").join(", ");
            this._conditions.push({ sql: `${col} NOT IN (${placeholders})`, params: vals });
        }
        return this;
    }

    or(filter: string): this {
        this._orCond = parseOrFilter(filter);
        return this;
    }

    order(col: string, opts?: { ascending?: boolean }): this {
        const dir = opts?.ascending === false ? "DESC" : "ASC";
        this._orderClauses.push(`${col} ${dir}`);
        return this;
    }

    limit(n: number): this {
        this._limitVal = n;
        return this;
    }

    // Make the builder awaitable for array-result selects.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then<R>(onfulfilled: (value: any) => R, onrejected?: (reason: unknown) => R): Promise<R> {
        return this._execute().then(onfulfilled, onrejected);
    }

    async single<T = Row>(): Promise<QueryResult<T>> {
        this._singleMode = true;
        return this._execute() as Promise<QueryResult<T>>;
    }

    async maybeSingle<T = Row>(): Promise<QueryResult<T | null>> {
        this._maybeSingleMode = true;
        return this._execute() as Promise<QueryResult<T | null>>;
    }

    private _buildWhere(): { where: string; params: unknown[] } {
        const allConds: Condition[] = [...this._conditions];
        if (this._orCond) allConds.push(this._orCond);
        if (allConds.length === 0) return { where: "", params: [] };
        const { clauses, params } = resolveParams(allConds);
        return { where: `WHERE ${clauses.join(" AND ")}`, params };
    }

    private async _execute(): Promise<QueryResult<unknown>> {
        try {
            return await this._run();
        } catch (err) {
            return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
        }
    }

    private async _run(): Promise<QueryResult<unknown>> {
        const table = `"${this._table}"`;

        if (this._op === "select") {
            const { where, params } = this._buildWhere();
            if (this._countMode) {
                const sql = `SELECT COUNT(*) FROM ${table} ${where}`.trim();
                const res = await this._pool.query(sql, params);
                return { data: null, error: null, count: parseInt(res.rows[0].count, 10) };
            }
            const parts: string[] = [`SELECT ${this._cols} FROM ${table}`];
            if (where) parts.push(where);
            if (this._orderClauses.length) parts.push(`ORDER BY ${this._orderClauses.join(", ")}`);
            if (this._limitVal !== undefined) parts.push(`LIMIT ${this._limitVal}`);
            const res = await this._pool.query(parts.join(" "), params);
            if (this._singleMode) {
                if (res.rows.length === 0) return { data: null, error: { message: "No rows found" } };
                return { data: res.rows[0], error: null };
            }
            if (this._maybeSingleMode) {
                return { data: res.rows[0] ?? null, error: null };
            }
            return { data: res.rows, error: null };
        }

        if (this._op === "insert" || this._op === "upsert") {
            const rows = Array.isArray(this._insertData) ? this._insertData : [this._insertData!];
            const cols = Object.keys(rows[0]);
            const params: unknown[] = [];
            const valueSets = rows.map((row) => {
                const placeholders = cols.map((col) => {
                    // pg formats JS arrays as PostgreSQL array literals {a,b} which is invalid
                    // for jsonb columns. JSON.stringify produces valid JSON for PostgreSQL to parse.
                    const val = row[col];
                    params.push(Array.isArray(val) ? JSON.stringify(val) : val);
                    return `$${params.length}`;
                });
                return `(${placeholders.join(", ")})`;
            });

            const colList = cols.map((c) => `"${c}"`).join(", ");
            let sql = `INSERT INTO ${table} (${colList}) VALUES ${valueSets.join(", ")}`;

            if (this._op === "upsert" && this._upsertConflict) {
                const conflictCols = this._upsertConflict.split(",").map((c) => `"${c.trim()}"`).join(", ");
                const updateCols = cols.filter((c) => !this._upsertConflict!.split(",").map((x) => x.trim()).includes(c));
                const setClauses = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
                sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClauses}`;
            }

            if (this._withReturning) {
                sql += ` RETURNING ${this._cols === "*" ? "*" : this._cols}`;
            }

            const res = await this._pool.query(sql, params);
            if (this._withReturning) {
                if (this._singleMode) {
                    return { data: res.rows[0] ?? null, error: null };
                }
                return { data: res.rows, error: null };
            }
            return { data: null, error: null };
        }

        if (this._op === "update") {
            const entries = Object.entries(this._updateData!);
            const setParams: unknown[] = [];
            const setClauses = entries.map(([col, val]) => {
                setParams.push(Array.isArray(val) ? JSON.stringify(val) : val);
                return `"${col}" = $${setParams.length}`;
            });

            // WHERE conditions need offset by setParams.length
            const allConds: Condition[] = [...this._conditions];
            if (this._orCond) allConds.push(this._orCond);
            const offset = setParams.length;
            const condParams: unknown[] = [];
            const condClauses: string[] = [];
            for (const cond of allConds) {
                let sql = cond.sql;
                for (const p of cond.params) {
                    condParams.push(p);
                    sql = sql.replace("?", `$${offset + condParams.length}`);
                }
                condClauses.push(sql);
            }

            const where = condClauses.length > 0 ? `WHERE ${condClauses.join(" AND ")}` : "";
            const returning = this._withReturning ? ` RETURNING ${this._cols === "*" ? "*" : this._cols}` : "";
            const sql = `UPDATE ${table} SET ${setClauses.join(", ")} ${where}${returning}`.trim();
            const allParams = [...setParams, ...condParams];
            const res = await this._pool.query(sql, allParams);

            if (this._withReturning) {
                if (this._singleMode) return { data: res.rows[0] ?? null, error: null };
                return { data: res.rows, error: null };
            }
            return { data: null, error: null };
        }

        if (this._op === "delete") {
            const { where, params } = this._buildWhere();
            const sql = `DELETE FROM ${table} ${where}`.trim();
            await this._pool.query(sql, params);
            return { data: null, error: null };
        }

        return { data: null, error: { message: `Unsupported operation: ${this._op}` } };
    }
}

export class PgAdapter {
    private _pool: Pool;

    constructor(pool: Pool) {
        this._pool = pool;
    }

    from(table: string): PgQueryBuilder {
        return new PgQueryBuilder(this._pool, table);
    }
}
