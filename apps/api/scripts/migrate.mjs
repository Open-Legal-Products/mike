#!/usr/bin/env node
// Idempotent, ledgered SQL migration runner.
//
// The repo's migrations were previously applied only by the Supabase CLI, which
// an air-gapped deployment drops. This applies the ordered SQL files in
// supabase/migrations/*.sql directly, recording each in a schema_migrations
// ledger so re-runs are a no-op and drift is detected. Intended to run as the
// `migrate` init container AFTER GoTrue has created the auth.* schema (the app
// migrations FK to auth.users), and before PostgREST/the API start.
//
// Config (env):
//   DATABASE_URL      Postgres connection string (required)
//   MIGRATIONS_DIR    override the migrations directory (default: ../../supabase/migrations)
//
// Exit codes: 0 = up to date / applied; 1 = failure (including checksum drift).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error("[migrate] DATABASE_URL is required");
    process.exit(1);
}
const MIGRATIONS_DIR =
    process.env.MIGRATIONS_DIR ||
    join(__dirname, "..", "..", "..", "supabase", "migrations");

const LEDGER_DDL = `
create table if not exists public.schema_migrations (
    version     text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now()
);`;

function sha256(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function migrationFiles() {
    return readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort(); // filenames are timestamp-prefixed → lexical sort = apply order
}

async function main() {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
        await client.query(LEDGER_DDL);
        const { rows } = await client.query(
            "select version, checksum from public.schema_migrations",
        );
        const applied = new Map(rows.map((r) => [r.version, r.checksum]));

        const files = migrationFiles();
        let ran = 0;
        for (const version of files) {
            const sql = readFileSync(join(MIGRATIONS_DIR, version), "utf8");
            const checksum = sha256(sql);
            const prev = applied.get(version);

            if (prev !== undefined) {
                if (prev !== checksum) {
                    throw new Error(
                        `[migrate] checksum drift for already-applied ${version} ` +
                            `(ledger ${prev.slice(0, 12)} != file ${checksum.slice(0, 12)}). ` +
                            "Migrations are immutable once applied.",
                    );
                }
                continue; // already applied, unchanged
            }

            // Apply the migration and record it atomically.
            await client.query("begin");
            try {
                await client.query(sql);
                await client.query(
                    "insert into public.schema_migrations (version, checksum) values ($1, $2)",
                    [version, checksum],
                );
                await client.query("commit");
                console.log(`[migrate] applied ${version}`);
                ran++;
            } catch (err) {
                await client.query("rollback");
                throw new Error(`[migrate] failed on ${version}: ${err.message}`);
            }
        }
        console.log(
            ran === 0
                ? `[migrate] up to date (${files.length} migrations, 0 applied)`
                : `[migrate] done (${ran} applied, ${files.length - ran} already present)`,
        );
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
});
