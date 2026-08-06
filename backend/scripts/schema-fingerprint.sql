-- Canonical fingerprint of the `public` schema, for CI drift comparison.
--
-- Two databases that should be structurally equivalent — one built from the
-- current backend/schema.sql (a fresh install), one built from an older
-- schema baseline plus the migrations added since (an upgraded deployment) —
-- are each reduced to this deterministic text form and diffed. Run with:
--
--     psql "$DB_URL" -XAtq -f backend/scripts/schema-fingerprint.sql
--
-- Why not just diff `pg_dump --schema-only` output? Two reasons:
--
--   1. Column order. A migration adds new columns at the END of a table,
--      while schema.sql may declare them anywhere. Upgraded and fresh
--      databases therefore legitimately differ in attnum order forever.
--      pg_dump preserves that order; this script sorts columns by name so
--      the benign difference is ignored and every real difference remains.
--   2. Determinism. Every query below has a total ORDER BY, so output never
--      depends on OID assignment or object creation order.
--
-- What "equivalent" means here — everything that affects behaviour or
-- security: tables, columns (type/null/default/identity), constraints,
-- indexes, row-level security + policies, functions (full definition),
-- triggers (including the auth.users signup trigger), views, enum types,
-- and object-level privileges (the ACLs that decide what anon,
-- authenticated, and service_role may do). ACLs are exploded to one row per
-- (object, grantee, privilege) because the raw acl array is ordered by
-- GRANT execution order, which differs between the two build paths.

\echo === tables ===
select 'table|' || c.relname || '|kind=' || c.relkind::text
    || '|rls=' || c.relrowsecurity || '|forcerls=' || c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'S', 'v', 'm')
order by 1;

\echo === columns ===
select 'column|' || c.relname || '|' || a.attname
    || '|' || format_type(a.atttypid, a.atttypmod)
    || '|notnull=' || a.attnotnull
    || '|identity=' || coalesce(nullif(a.attidentity::text, ''), '-')
    || '|generated=' || coalesce(nullif(a.attgenerated::text, ''), '-')
    || '|default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  and a.attnum > 0 and not a.attisdropped
order by 1;

\echo === constraints ===
select 'constraint|' || c.relname || '|' || con.conname
    || '|' || pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by 1;

\echo === indexes ===
select 'index|' || pg_get_indexdef(i.indexrelid)
from pg_index i
join pg_class c on c.oid = i.indrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by 1;

\echo === policies ===
select 'policy|' || tablename || '|' || policyname
    || '|permissive=' || permissive || '|cmd=' || cmd
    || '|roles=' || array_to_string(roles, ',')
    || '|using=' || coalesce(qual, '-')
    || '|check=' || coalesce(with_check, '-')
from pg_policies
where schemaname = 'public'
order by 1;

\echo === functions ===
select 'function|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    || E'\n' || pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by 1;

\echo === triggers ===
-- Includes triggers on auth.users because schema.sql installs the signup
-- trigger there (its function lives in public).
select 'trigger|' || n.nspname || '.' || c.relname || '|' || t.tgname
    || '|' || pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))
order by 1;

\echo === views ===
select 'view|' || c.relname || E'\n' || pg_get_viewdef(c.oid, true)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm')
order by 1;

\echo === enum types ===
select 'enum|' || t.typname || '|' || e.enumlabel || '|pos=' || e.enumsortorder
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
order by 1;

\echo === relation privileges ===
select 'acl|' || c.relname
    || '|grantee=' || case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
    || '|' || acl.privilege_type
    || '|grantable=' || acl.is_grantable
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
-- acldefault's first argument selects which built-in default ACL to
-- synthesize when relacl is null: 'r' for tables/views, 's' for sequences
-- (whose privilege set is USAGE/SELECT/UPDATE, not the table set). The
-- relkind filter admits sequences ('S'), so pick the matching kind per row
-- rather than hard-coding 'r' — otherwise a sequence with a null relacl
-- would be fingerprinted with table privileges it cannot actually hold.
cross join lateral aclexplode(coalesce(c.relacl,
    acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char",
               c.relowner))) acl
where n.nspname = 'public' and c.relkind in ('r', 'p', 'S', 'v', 'm')
order by 1;

\echo === function privileges ===
select 'facl|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    || '|grantee=' || case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
    || '|' || acl.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
where n.nspname = 'public'
order by 1;

\echo === default privileges ===
select 'dacl|objtype=' || d.defaclobjtype::text
    || '|grantee=' || case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
    || '|' || acl.privilege_type
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) acl
where n.nspname = 'public'
order by 1;
