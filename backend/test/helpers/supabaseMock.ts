import { vi } from "vitest";

export type SupabaseResult = { data: unknown; error: unknown };

export interface SupabaseMockControl {
  /** The object returned by the mocked `createServerSupabase()`. */
  db: Record<string, unknown>;
  /** Queue one `{ data, error }` to be returned by the next awaited query. */
  queue: (result: SupabaseResult) => SupabaseMockControl;
  /** Queue several results, consumed in order. */
  queueMany: (results: SupabaseResult[]) => SupabaseMockControl;
  /** Result returned once the queue is exhausted (defaults to `{data:null,error:null}`). */
  setDefault: (result: SupabaseResult) => void;
  /** Mock for `db.auth.admin.deleteUser`. */
  authDeleteUser: ReturnType<typeof vi.fn>;
  /** Table names passed to every `from()` call, in order. */
  fromCalls: string[];
  /** Every chain method invoked, in order, for assertions. */
  calls: Array<{ table: string; method: string; args: unknown[] }>;
}

// The Supabase JS client exposes a fluent, chainable query builder whose calls
// (`from().select().eq().maybeSingle()`) only resolve when awaited. We emulate
// that with a builder where every chain/terminal method returns the same
// thenable object, and awaiting it dequeues the next configured result. Route
// handlers issue their DB calls sequentially, so a simple FIFO queue lines up
// results with the order the handler asks for them.
const CHAIN_METHODS = [
  "select", "insert", "update", "upsert", "delete", "eq", "neq", "gt", "gte",
  "lt", "lte", "in", "is", "or", "and", "not", "contains", "containedBy",
  "filter", "match", "like", "ilike", "order", "limit", "range", "onConflict",
  "returns", "overlaps", "textSearch", "throwOnError",
];
const TERMINAL_METHODS = ["single", "maybeSingle", "csv", "geojson"];

export function createSupabaseMock(): SupabaseMockControl {
  const results: SupabaseResult[] = [];
  let defaultResult: SupabaseResult = { data: null, error: null };
  const fromCalls: string[] = [];
  const calls: SupabaseMockControl["calls"] = [];

  const next = (): SupabaseResult =>
    results.length ? results.shift()! : defaultResult;

  function makeBuilder(table: string): Record<string, unknown> {
    const builder: Record<string, unknown> = {
      then: (onF: ((v: SupabaseResult) => unknown) | null, onR?: ((e: unknown) => unknown) | null) =>
        Promise.resolve(next()).then(onF, onR),
      catch: (onR: ((e: unknown) => unknown) | null) =>
        Promise.resolve(next()).catch(onR),
      finally: (onF: (() => void) | null) =>
        Promise.resolve(next()).finally(onF ?? undefined),
    };
    for (const m of [...CHAIN_METHODS, ...TERMINAL_METHODS]) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return builder;
      };
    }
    return builder;
  }

  const authDeleteUser = vi.fn(async () => ({ data: { user: null }, error: null }));

  const db: Record<string, unknown> = {
    from: (table: string) => {
      fromCalls.push(table);
      return makeBuilder(table);
    },
    auth: { admin: { deleteUser: authDeleteUser } },
  };

  const control: SupabaseMockControl = {
    db,
    queue(result) {
      results.push(result);
      return control;
    },
    queueMany(items) {
      results.push(...items);
      return control;
    },
    setDefault(result) {
      defaultResult = result;
    },
    authDeleteUser,
    fromCalls,
    calls,
  };
  return control;
}
