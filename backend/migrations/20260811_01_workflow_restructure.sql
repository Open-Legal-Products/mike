-- Workflow ownership, defaults, quick actions, add-on catalog, and references.

create table if not exists public.default_workflow_installations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  default_key text not null,
  workflow_id uuid references public.workflows(id) on delete set null,
  installed_at timestamptz not null default now(),
  constraint default_workflow_installations_user_key_unique
    unique(user_id, default_key),
  constraint default_workflow_installations_workflow_unique
    unique(workflow_id)
);

create table if not exists public.quick_actions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  prompt text not null default '',
  document_upload boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quick_actions_user_order_idx
  on public.quick_actions(user_id, sort_order, created_at);

create index if not exists quick_actions_workflow_idx
  on public.quick_actions(workflow_id);

create table if not exists public.workflow_addons (
  id uuid primary key default gen_random_uuid(),
  addon_key text not null unique,
  version text,
  title text not null,
  description text,
  type text not null,
  prompt_md text,
  columns_config jsonb,
  contributors jsonb,
  language text,
  practice text,
  jurisdictions text[],
  content_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_addons_type_check
    check(type in ('assistant', 'tabular'))
);

create index if not exists workflow_addons_active_type_idx
  on public.workflow_addons(active, type, title);

create table if not exists public.workflow_reference_documents (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  user_id text not null,
  filename text not null,
  file_type text not null,
  storage_path text not null,
  size_bytes integer,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflow_reference_documents_workflow_idx
  on public.workflow_reference_documents(workflow_id, created_at);

create index if not exists workflow_reference_documents_user_idx
  on public.workflow_reference_documents(user_id);

create table if not exists public.workflow_addon_reference_files (
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references public.workflow_addons(id) on delete cascade,
  filename text not null,
  file_type text not null,
  storage_path text not null,
  size_bytes integer,
  content_hash text not null,
  created_at timestamptz not null default now(),
  constraint workflow_addon_reference_files_name_unique
    unique(addon_id, filename)
);

-- The backend passes the current default definitions from the generated
-- workflow catalog. One RPC keeps workflow + installation + quick action
-- creation atomic and serializes concurrent first-load requests per user.
create or replace function public.install_missing_default_workflows(
  p_user_id text,
  p_defaults jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  workflow_uuid uuid;
  installed_count integer := 0;
  jurisdiction_values text[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 0));

  for item in select value from jsonb_array_elements(coalesce(p_defaults, '[]'::jsonb))
  loop
    if nullif(trim(item->>'default_key'), '') is null then
      continue;
    end if;

    if exists (
      select 1
      from public.default_workflow_installations dwi
      where dwi.user_id = p_user_id
        and dwi.default_key = item->>'default_key'
    ) then
      continue;
    end if;

    select coalesce(array_agg(value), array['General']::text[])
      into jurisdiction_values
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(item->'jurisdictions') = 'array'
          then item->'jurisdictions'
        else '["General"]'::jsonb
      end
    );

    insert into public.workflows (
      user_id,
      title,
      type,
      prompt_md,
      columns_config,
      language,
      practice,
      jurisdictions
    ) values (
      p_user_id,
      item->>'title',
      item->>'type',
      nullif(item->>'prompt_md', ''),
      case
        when jsonb_typeof(item->'columns_config') = 'array'
          then item->'columns_config'
        else null
      end,
      coalesce(nullif(item->>'language', ''), 'English'),
      coalesce(nullif(item->>'practice', ''), 'General Transactions'),
      jurisdiction_values
    )
    returning id into workflow_uuid;

    insert into public.default_workflow_installations (
      user_id,
      default_key,
      workflow_id
    ) values (
      p_user_id,
      item->>'default_key',
      workflow_uuid
    );

    insert into public.quick_actions (
      user_id,
      workflow_id,
      prompt,
      document_upload,
      enabled,
      sort_order
    ) values (
      p_user_id,
      workflow_uuid,
      coalesce(item->>'quick_action_prompt', ''),
      coalesce((item->>'document_upload')::boolean, false),
      true,
      coalesce((item->>'sort_order')::integer, installed_count)
    );

    installed_count := installed_count + 1;
  end loop;

  return installed_count;
end;
$$;

revoke all on public.default_workflow_installations from anon, authenticated;
revoke all on public.quick_actions from anon, authenticated;
revoke all on public.workflow_addons from anon, authenticated;
revoke all on public.workflow_reference_documents from anon, authenticated;
revoke all on public.workflow_addon_reference_files from anon, authenticated;
revoke all on function public.install_missing_default_workflows(text, jsonb)
  from public, anon, authenticated;

grant select, insert, update, delete
  on public.default_workflow_installations,
     public.quick_actions,
     public.workflow_addons,
     public.workflow_reference_documents,
     public.workflow_addon_reference_files
  to service_role;

grant execute
  on function public.install_missing_default_workflows(text, jsonb)
  to service_role;
