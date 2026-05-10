/**
 * DB client factory.
 *
 * AUTH_MODE=supabase (default): returns the Supabase PostgREST client.
 * AUTH_MODE=local:              returns a PgAdapter backed by DATABASE_URL.
 *
 * Both expose the same .from(table).select/insert/update/delete/upsert chain
 * so all route files work without modification.
 */

import { Pool } from "pg";
import { PgAdapter } from "./pgAdapter";
import { createServerSupabase } from "./supabase";

// Loose interface so both Supabase client and PgAdapter satisfy it without
// TypeScript trying to intersect their complex generic return types.
// Route code already casts `data` to specific types, so `any` here is safe.
export interface DbClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(table: string): any;
}

let _pool: Pool | null = null;

function getPgPool(): Pool {
    if (!_pool) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL must be set when AUTH_MODE=local");
        _pool = new Pool({ connectionString: url });
    }
    return _pool;
}

export function createDb(): DbClient {
    if (process.env.AUTH_MODE === "local") {
        return new PgAdapter(getPgPool());
    }
    return createServerSupabase();
}

// ---------------------------------------------------------------------------
// Auth-level user listing — needed by the workflow sharing feature to resolve
// user emails. In Supabase mode this calls the admin auth API; in local mode
// it queries the users table directly.
// ---------------------------------------------------------------------------

export async function deleteAuthUser(userId: string): Promise<{ error: { message: string } | null }> {
    if (process.env.AUTH_MODE === "local") {
        const pool = getPgPool();
        await pool.query("DELETE FROM users WHERE id = $1", [userId]);
        return { error: null };
    }
    try {
        const { createClient } = await import("@supabase/supabase-js");
        const admin = createClient(
            process.env.SUPABASE_URL ?? "",
            process.env.SUPABASE_SECRET_KEY ?? "",
            { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const { error } = await admin.auth.admin.deleteUser(userId);
        return { error: error ? { message: error.message } : null };
    } catch (err) {
        return { error: { message: err instanceof Error ? err.message : String(err) } };
    }
}

export async function listAuthUsers(): Promise<{ id: string; email: string }[]> {
    if (process.env.AUTH_MODE === "local") {
        const pool = getPgPool();
        const res = await pool.query("SELECT id, email FROM users");
        return res.rows as { id: string; email: string }[];
    }
    try {
        const { createClient } = await import("@supabase/supabase-js");
        const admin = createClient(
            process.env.SUPABASE_URL ?? "",
            process.env.SUPABASE_SECRET_KEY ?? "",
            { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
        return (data?.users ?? []).map((u) => ({ id: u.id, email: u.email ?? "" }));
    } catch {
        return [];
    }
}
