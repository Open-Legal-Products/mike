/**
 * Local Postgres adapter — drop-in replacement for the Supabase client.
 *
 * The rest of the codebase talks to the database through a small subset of
 * the Supabase / PostgREST query-builder API:
 *
 *   db.from(table).select(cols).eq(...).order(...).limit(...)        → { data, error }
 *   db.from(table).select(cols).eq(...).single() / .maybeSingle()
 *   db.from(table).insert(rows).select(cols).single()
 *   db.from(table).update(obj).eq(...).select(...)
 *   db.from(table).delete().eq(...)
 *   db.from(table).upsert(rows, { onConflict })
 *   db.auth.admin.{ getUserById, listUsers, deleteUser }
 *
 * This module reimplements exactly that surface on top of `pg`, pointed at a
 * local Postgres database. `createServerSupabase()` keeps its name and
 * signature so no calling code had to change.
 *
 * Connection string comes from DATABASE_URL, defaulting to the local
 * docker-compose Postgres.
 */

import { Pool, type PoolClient } from "pg";

const DEFAULT_DATABASE_URL = "postgresql://mike:mike@localhost:5432/mike";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    });
  }
  return pool;
}

export type DbError = { message: string; code?: string } | null;

export type DbResult<T = any> = {
  data: T;
  error: DbError;
  count?: number | null;
};

/** Resolved shape of a list query (select / insert / update / delete). */
export type ListResult = {
  data: any[] | null;
  error: DbError;
  count?: number | null;
};

/** Resolved shape of `.single()` / `.maybeSingle()`. */
export type SingleResult = {
  data: any | null;
  error: DbError;
};

type FilterClause = (params: unknown[]) => string;

// ---------------------------------------------------------------------------
// Value / identifier helpers
// ---------------------------------------------------------------------------

function quoteIdent(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "*") return "*";
  return `"${trimmed.replace(/"/g, '""')}"`;
}

function buildColumnList(cols: string | null | undefined): string {
  if (!cols || cols.trim() === "" || cols.trim() === "*") return "*";
  return cols
    .split(",")
    .map((c) => quoteIdent(c))
    .join(", ");
}

/**
 * Push a value as a bound parameter and return its placeholder. Objects and
 * arrays are JSON-encoded and cast to jsonb (every array/object column in the
 * schema is jsonb); Dates become ISO strings; scalars pass through.
 */
function placeholder(value: unknown, params: unknown[]): string {
  if (value !== null && value !== undefined && typeof value === "object") {
    if (value instanceof Date) {
      params.push(value.toISOString());
      return `$${params.length}`;
    }
    params.push(JSON.stringify(value));
    return `$${params.length}::jsonb`;
  }
  params.push(value ?? null);
  return `$${params.length}`;
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

type Op = "select" | "insert" | "update" | "delete";

class QueryBuilder implements PromiseLike<ListResult> {
  private op: Op = "select";
  private selectArg: string | null = null;
  private wantsReturning = false;
  private insertRows: Record<string, any>[] = [];
  private updateValues: Record<string, any> = {};
  private conflictColumns: string[] | null = null;
  private ignoreDuplicates = false;
  private filterClauses: FilterClause[] = [];
  private orClause: FilterClause | null = null;
  private orderParts: {
    col: string;
    ascending: boolean;
    nullsFirst?: boolean;
  }[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private singleMode: false | "single" | "maybe" = false;
  private countMode = false;
  private headMode = false;

  constructor(private readonly table: string) {}

  // -- query kind ----------------------------------------------------------

  select(
    cols?: string,
    options?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
  ): this {
    // After a mutation, .select() just requests RETURNING; otherwise it
    // starts a SELECT query.
    this.selectArg = cols ?? "*";
    this.wantsReturning = true;
    if (options?.count) this.countMode = true;
    if (options?.head) this.headMode = true;
    return this;
  }

  insert(rows: Record<string, any> | Record<string, any>[]): this {
    this.op = "insert";
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(values: Record<string, any>): this {
    this.op = "update";
    this.updateValues = values;
    return this;
  }

  delete(): this {
    this.op = "delete";
    return this;
  }

  upsert(
    rows: Record<string, any> | Record<string, any>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.op = "insert";
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    this.conflictColumns = options?.onConflict
      ? options.onConflict.split(",").map((c) => c.trim())
      : [];
    this.ignoreDuplicates = options?.ignoreDuplicates === true;
    return this;
  }

  // -- filters -------------------------------------------------------------

  eq(column: string, value: unknown): this {
    if (value === null) {
      this.filterClauses.push(() => `${quoteIdent(column)} IS NULL`);
    } else {
      this.filterClauses.push(
        (p) => `${quoteIdent(column)} = ${placeholder(value, p)}`,
      );
    }
    return this;
  }

  neq(column: string, value: unknown): this {
    if (value === null) {
      this.filterClauses.push(() => `${quoteIdent(column)} IS NOT NULL`);
    } else {
      this.filterClauses.push(
        (p) => `${quoteIdent(column)} <> ${placeholder(value, p)}`,
      );
    }
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filterClauses.push(
      (p) => `${quoteIdent(column)} > ${placeholder(value, p)}`,
    );
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filterClauses.push(
      (p) => `${quoteIdent(column)} >= ${placeholder(value, p)}`,
    );
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filterClauses.push(
      (p) => `${quoteIdent(column)} < ${placeholder(value, p)}`,
    );
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filterClauses.push(
      (p) => `${quoteIdent(column)} <= ${placeholder(value, p)}`,
    );
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.filterClauses.push((p) => {
      if (!values || values.length === 0) return "1 = 0";
      const placeholders = values.map((v) => placeholder(v, p)).join(", ");
      return `${quoteIdent(column)} IN (${placeholders})`;
    });
    return this;
  }

  is(column: string, value: null | boolean): this {
    this.filterClauses.push(() => {
      if (value === null) return `${quoteIdent(column)} IS NULL`;
      return `${quoteIdent(column)} IS ${value ? "TRUE" : "FALSE"}`;
    });
    return this;
  }

  not(column: string, operator: string, value: null | boolean): this {
    this.filterClauses.push(() => {
      if (operator === "is") {
        if (value === null) return `${quoteIdent(column)} IS NOT NULL`;
        return `${quoteIdent(column)} IS NOT ${value ? "TRUE" : "FALSE"}`;
      }
      // Unused by the codebase beyond `not(col, "is", null)`, but keep a
      // sensible generic fallback.
      return `NOT (${quoteIdent(column)} ${operator} ${value})`;
    });
    return this;
  }

  /**
   * PostgREST-style `filter`. Only the `cs` (contains) operator on jsonb
   * columns is used in this codebase (shared_with membership checks).
   */
  filter(column: string, operator: string, value: string): this {
    this.filterClauses.push((p) => {
      if (operator === "cs") {
        // value is already a JSON string, e.g. '["a@b.com"]'
        return `${quoteIdent(column)} @> ${pushRaw(value, p)}::jsonb`;
      }
      return `${quoteIdent(column)} ${operator} ${pushRaw(value, p)}`;
    });
    return this;
  }

  /**
   * PostgREST `or` filter, e.g. "user_id.eq.X,project_id.in.(a,b,c)".
   */
  or(filterString: string): this {
    this.orClause = (p) => buildOrClause(filterString, p);
    return this;
  }

  // -- modifiers -----------------------------------------------------------

  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): this {
    this.orderParts.push({
      col: column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst,
    });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  // -- terminators ---------------------------------------------------------

  single(): PromiseLike<SingleResult> {
    this.singleMode = "single";
    this.wantsReturning = true;
    return this as unknown as PromiseLike<SingleResult>;
  }

  maybeSingle(): PromiseLike<SingleResult> {
    this.singleMode = "maybe";
    this.wantsReturning = true;
    return this as unknown as PromiseLike<SingleResult>;
  }

  // -- SQL assembly --------------------------------------------------------

  private buildWhere(params: unknown[]): string {
    const clauses = this.filterClauses.map((fn) => fn(params));
    if (this.orClause) clauses.push(this.orClause(params));
    if (clauses.length === 0) return "";
    return ` WHERE ${clauses.join(" AND ")}`;
  }

  private buildOrderLimit(): string {
    let sql = "";
    if (this.orderParts.length > 0) {
      const parts = this.orderParts.map((o) => {
        let part = `${quoteIdent(o.col)} ${o.ascending ? "ASC" : "DESC"}`;
        if (o.nullsFirst !== undefined) {
          part += o.nullsFirst ? " NULLS FIRST" : " NULLS LAST";
        }
        return part;
      });
      sql += ` ORDER BY ${parts.join(", ")}`;
    }
    if (this.limitN !== null) sql += ` LIMIT ${Math.max(0, this.limitN)}`;
    if (this.offsetN !== null) sql += ` OFFSET ${Math.max(0, this.offsetN)}`;
    return sql;
  }

  private buildSql(params: unknown[]): string {
    const table = quoteIdent(this.table);
    const returning = this.wantsReturning
      ? ` RETURNING ${buildColumnList(this.selectArg)}`
      : "";

    if (this.op === "select") {
      return (
        `SELECT ${buildColumnList(this.selectArg)} FROM ${table}` +
        this.buildWhere(params) +
        this.buildOrderLimit()
      );
    }

    if (this.op === "insert") {
      const columnSet = new Set<string>();
      for (const row of this.insertRows) {
        for (const key of Object.keys(row)) columnSet.add(key);
      }
      const columns = Array.from(columnSet);
      if (columns.length === 0) {
        // INSERT of an empty object — fall back to default values.
        return `INSERT INTO ${table} DEFAULT VALUES${returning}`;
      }
      const colSql = columns.map((c) => quoteIdent(c)).join(", ");
      const rowsSql = this.insertRows
        .map(
          (row) =>
            `(${columns
              .map((c) =>
                c in row ? placeholder(row[c], params) : "DEFAULT",
              )
              .join(", ")})`,
        )
        .join(", ");
      let sql = `INSERT INTO ${table} (${colSql}) VALUES ${rowsSql}`;
      if (this.conflictColumns !== null) {
        const conflictCols = this.conflictColumns;
        if (conflictCols.length === 0) {
          sql += ` ON CONFLICT DO NOTHING`;
        } else {
          const updateCols = columns.filter((c) => !conflictCols.includes(c));
          const target = conflictCols.map((c) => quoteIdent(c)).join(", ");
          if (this.ignoreDuplicates || updateCols.length === 0) {
            sql += ` ON CONFLICT (${target}) DO NOTHING`;
          } else {
            const setSql = updateCols
              .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
              .join(", ");
            sql += ` ON CONFLICT (${target}) DO UPDATE SET ${setSql}`;
          }
        }
      }
      return sql + returning;
    }

    if (this.op === "update") {
      const setSql = Object.keys(this.updateValues)
        .map((c) => `${quoteIdent(c)} = ${placeholder(this.updateValues[c], params)}`)
        .join(", ");
      return (
        `UPDATE ${table} SET ${setSql}` + this.buildWhere(params) + returning
      );
    }

    // delete
    return `DELETE FROM ${table}` + this.buildWhere(params) + returning;
  }

  // -- execution -----------------------------------------------------------

  private async run(): Promise<DbResult> {
    // Count queries (select with { count: ... }) run a separate count(*),
    // and optionally the row query too (unless head: true).
    if (this.op === "select" && this.countMode) {
      try {
        const countParams: unknown[] = [];
        const where = this.buildWhere(countParams);
        const countSql = `SELECT count(*)::int AS count FROM ${quoteIdent(
          this.table,
        )}${where}`;
        const countRes = await getPool().query(countSql, countParams);
        const count: number = countRes.rows[0]?.count ?? 0;

        if (this.headMode) return { data: null, count, error: null };

        const rowParams: unknown[] = [];
        const rowsSql =
          `SELECT ${buildColumnList(this.selectArg)} FROM ${quoteIdent(
            this.table,
          )}` +
          this.buildWhere(rowParams) +
          this.buildOrderLimit();
        const rowsRes = await getPool().query(rowsSql, rowParams);
        return { data: rowsRes.rows, count, error: null };
      } catch (err: any) {
        return {
          data: null,
          count: null,
          error: { message: err?.message ?? String(err), code: err?.code },
        };
      }
    }

    const params: unknown[] = [];
    let text: string;
    try {
      text = this.buildSql(params);
    } catch (err: any) {
      return { data: null, error: { message: err?.message ?? String(err) } };
    }

    try {
      const result = await getPool().query(text, params);
      const rows = result.rows ?? [];

      if (this.singleMode === "single") {
        if (rows.length === 1) return { data: rows[0], error: null };
        return {
          data: null,
          error: {
            code: "PGRST116",
            message:
              rows.length === 0
                ? "JSON object requested, multiple (or no) rows returned"
                : "Results contain more than one row",
          },
        };
      }
      if (this.singleMode === "maybe") {
        if (rows.length === 0) return { data: null, error: null };
        if (rows.length === 1) return { data: rows[0], error: null };
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "Results contain more than one row",
          },
        };
      }

      // Mutations without a RETURNING clause resolve to null data (matches
      // supabase-js, where you must chain .select() to get rows back).
      if (this.op !== "select" && !this.wantsReturning) {
        return { data: null, error: null };
      }

      return { data: rows, error: null };
    } catch (err: any) {
      return {
        data: null,
        error: { message: err?.message ?? String(err), code: err?.code },
      };
    }
  }

  then<TResult1 = ListResult, TResult2 = never>(
    onfulfilled?:
      | ((value: ListResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return (this.run() as Promise<ListResult>).then(onfulfilled, onrejected);
  }
}

function pushRaw(value: unknown, params: unknown[]): string {
  params.push(value);
  return `$${params.length}`;
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function buildOrClause(filterString: string, params: unknown[]): string {
  const tokens = splitTopLevel(filterString);
  const clauses = tokens.map((token) => {
    const inMatch = token.match(/^([a-zA-Z0-9_]+)\.in\.\((.*)\)$/);
    if (inMatch) {
      const col = inMatch[1];
      const values = inMatch[2].split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length === 0) return "1 = 0";
      const placeholders = values
        .map((v) => pushRaw(v, params))
        .join(", ");
      return `${quoteIdent(col)} IN (${placeholders})`;
    }
    const m = token.match(/^([a-zA-Z0-9_]+)\.([a-z]+)\.(.*)$/);
    if (!m) return "1 = 0";
    const [, col, op, rawVal] = m;
    const sqlCol = quoteIdent(col);
    switch (op) {
      case "eq":
        return `${sqlCol} = ${pushRaw(rawVal, params)}`;
      case "neq":
        return `${sqlCol} <> ${pushRaw(rawVal, params)}`;
      case "gt":
        return `${sqlCol} > ${pushRaw(rawVal, params)}`;
      case "gte":
        return `${sqlCol} >= ${pushRaw(rawVal, params)}`;
      case "lt":
        return `${sqlCol} < ${pushRaw(rawVal, params)}`;
      case "lte":
        return `${sqlCol} <= ${pushRaw(rawVal, params)}`;
      case "is":
        return rawVal === "null"
          ? `${sqlCol} IS NULL`
          : `${sqlCol} IS ${rawVal.toUpperCase()}`;
      default:
        return "1 = 0";
    }
  });
  return `(${clauses.join(" OR ")})`;
}

// ---------------------------------------------------------------------------
// Auth admin shim (single local user)
// ---------------------------------------------------------------------------

/** Loose stand-in for a Supabase auth user (only id/email are real). */
type LocalAuthUser = {
  id: string;
  email: string;
  factors?: any[];
  [key: string]: any;
};

const authAdmin = {
  async getUserById(
    id: string,
  ): Promise<DbResult<{ user: LocalAuthUser | null }>> {
    try {
      const result = await getPool().query(
        `SELECT id, email FROM auth.users WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return {
        data: { user: row ? { id: row.id, email: row.email ?? "" } : null },
        error: null,
      };
    } catch (err: any) {
      return { data: { user: null }, error: { message: err?.message } };
    }
  },

  async listUsers(_options?: {
    perPage?: number;
    page?: number;
  }): Promise<DbResult<{ users: LocalAuthUser[] }>> {
    try {
      const result = await getPool().query(`SELECT id, email FROM auth.users`);
      return {
        data: {
          users: result.rows.map((r) => ({
            id: r.id,
            email: r.email ?? "",
          })),
        },
        error: null,
      };
    } catch (err: any) {
      return { data: { users: [] }, error: { message: err?.message } };
    }
  },

  async deleteUser(id: string): Promise<DbResult<Record<string, never>>> {
    try {
      // Cascades to user_profiles / user_api_keys via their FKs.
      await getPool().query(`DELETE FROM auth.users WHERE id = $1`, [id]);
      return { data: {}, error: null };
    } catch (err: any) {
      return { data: {}, error: { message: err?.message } };
    }
  },
};

// ---------------------------------------------------------------------------
// Public API — same name/signature as the old Supabase factory
// ---------------------------------------------------------------------------

export function createServerSupabase() {
  return {
    from(table: string): QueryBuilder {
      return new QueryBuilder(table);
    },
    auth: {
      admin: authAdmin,
    },
  };
}

/**
 * Auth is bypassed locally — every request resolves to the single hardcoded
 * local user. Kept for signature compatibility with the previous Supabase
 * helper. See backend/src/middleware/auth.ts for the canonical id.
 */
export const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";
export const LOCAL_USER_EMAIL = "local@localhost";

export async function getUserIdFromRequest(_req: unknown): Promise<string> {
  return LOCAL_USER_ID;
}

/** Exposed for graceful shutdown / tests. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export type { PoolClient };
