#!/usr/bin/env bash
# Initialize the Supabase auth schema and Mike application schema on RDS.
# Run after RDS is available.
#
# This script creates ONLY the auth schema (empty) and required PostgreSQL roles.
# GoTrue creates all tables, types, and functions via its own migration system.
# Do NOT pre-create tables or types — that conflicts with GoTrue migrations.
#
# Usage: ./init-db.sh <db-host> <db-password>
set -euo pipefail

DB_HOST="${1:?Usage: init-db.sh <db-host> <db-password>}"
DB_PW="${2:?Usage: init-db.sh <db-host> <db-password>}"
DB_USER="postgres"
DB_NAME="postgres"
PORT="5432"

echo "==> Creating auth schema (empty) and roles on RDS..."
PGPASSWORD="$DB_PW" psql -h "$DB_HOST" -p "$PORT" -U "$DB_USER" -d "$DB_NAME" <<'SQL'
-- Create auth schema (empty — GoTrue will create tables via migrations)
CREATE SCHEMA IF NOT EXISTS auth;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create roles that GoTrue/PostgREST expect
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END
$$;

-- Grant permissions
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT ALL ON SCHEMA auth TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON SCHEMA public TO service_role;
SQL

echo "Auth schema and roles created. GoTrue will create tables via migrations."

echo ""
echo "==> Applying Mike application schema..."
PGPASSWORD="$DB_PW" psql -h "$DB_HOST" -p "$PORT" -U "$DB_USER" -d "$DB_NAME" -f "$(dirname "$0")/../backend/schema.sql"

echo ""
echo "==> Applying RLS migration (Sprint 3)..."
PGPASSWORD="$DB_PW" psql -h "$DB_HOST" -p "$PORT" -U "$DB_USER" -d "$DB_NAME" -f "$(dirname "$0")/../backend/migrations/20260710_01_rls_all_tables.sql"

echo ""
echo "==> Database initialization complete!"
echo "Verifying..."
PGPASSWORD="$DB_PW" psql -h "$DB_HOST" -p "$PORT" -U "$DB_USER" -d "$DB_NAME" -c "
SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = 'public';
SELECT count(*) as rls_tables FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;
"
