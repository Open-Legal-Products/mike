-- Preserve repository workflow packs as folders in the add-on catalog.

alter table public.workflow_addons
  add column if not exists pack_key text,
  add column if not exists pack_title text,
  add column if not exists pack_description text,
  add column if not exists pack_version text;

create index if not exists workflow_addons_active_pack_idx
  on public.workflow_addons(active, pack_key, title);
