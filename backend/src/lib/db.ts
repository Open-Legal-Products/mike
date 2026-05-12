// Drizzle ORM client for the Mike backend.
//
// Replaces the Supabase data client with a direct Postgres connection. The
// pool is shared process-wide and is configured for RDS Proxy + Aurora
// Serverless v2 in production. `DATABASE_URL` is provisioned via the SST
// Secret declared in Stage B.
//
// Route handlers should import `db` (typed Drizzle client) and only fall back
// to `pool` when they need raw `pg` features (LISTEN/NOTIFY, COPY, …).

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import * as schema from "../db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString,
  max: Number.parseInt(process.env.DB_POOL_MAX ?? "10", 10),
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
export { schema };

/**
 * Run `fn` inside a single Postgres transaction. The callback receives a
 * Drizzle client bound to the checked-out `pg.PoolClient` so that all queries
 * inside the transaction share the same connection.
 *
 * Drizzle's own `db.transaction(...)` helper already handles BEGIN/COMMIT/
 * ROLLBACK plumbing; this wrapper exists so callers can opt into a stable,
 * named entry point and so the helper is greppable across the codebase.
 */
export async function withTransaction<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

/**
 * Escape hatch when callers need a raw `pg.PoolClient` (e.g. to issue ad-hoc
 * SQL that Drizzle doesn't model). Caller is responsible for `release()`.
 */
export async function acquirePoolClient(): Promise<PoolClient> {
  return pool.connect();
}
