-- Library feature (ported from upstream backend/migrations/20260710_01_library_documents.sql).
--
-- Splits a user's standalone (project_id IS NULL) documents into two
-- collections — "file" and "template" — and gives each an optional folder
-- tree (public.library_folders). Renamed to the fork's 14-digit timestamp
-- convention and extended with the fork's hardening posture: because the
-- one-shot RLS deny-all loop (20260524000000_rls_deny_all.sql) has already
-- run, a table created here would otherwise ship with no policy, so RLS +
-- a deny-all fallback are enabled explicitly for library_folders.

-- ---------------------------------------------------------------------------
-- documents.library_kind
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists library_kind text default 'file';

update public.documents
set library_kind = 'file'
where library_kind is null;

alter table public.documents
  alter column library_kind set default 'file',
  alter column library_kind set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_library_kind_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_library_kind_check
      check (library_kind in ('file', 'template'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- library_folders
-- ---------------------------------------------------------------------------

-- user_id is a uuid FK to auth.users (fork hardening — upstream used bare
-- `text`), matching public.project_subfolders and public.documents.
create table if not exists public.library_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  library_kind text not null default 'file',
  name text not null,
  parent_folder_id uuid references public.library_folders(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_folders_kind_check
    check (library_kind in ('file', 'template'))
);

alter table public.documents
  add column if not exists library_folder_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_library_folder_id_fkey'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_library_folder_id_fkey
      foreign key (library_folder_id)
      references public.library_folders(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_library_folders_user_kind
  on public.library_folders(user_id, library_kind);

create index if not exists idx_library_folders_parent
  on public.library_folders(parent_folder_id);

create index if not exists idx_documents_library_kind_folder
  on public.documents(user_id, library_kind, library_folder_id)
  where project_id is null;

-- ---------------------------------------------------------------------------
-- Grants / RLS (fork hardening)
-- ---------------------------------------------------------------------------

-- The API authenticates as service_role (BYPASSRLS); browser roles never
-- touch this table directly.
revoke all on public.library_folders from anon, authenticated;
grant select, insert, update, delete on public.library_folders to service_role;

alter table public.library_folders enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'library_folders'
  ) then
    create policy deny_all_fallback on public.library_folders
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;
end;
$$;
