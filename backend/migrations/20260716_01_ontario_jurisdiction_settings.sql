-- ROSS-100: provider-neutral legal research settings with Ontario defaults.
--
-- The released legal_research_us column remains for backwards compatibility.
-- New application code reads the generic fields and derives the legacy flag.

alter table public.user_profiles
  add column if not exists legal_research_enabled boolean not null default true,
  add column if not exists default_country text not null default 'CA',
  add column if not exists default_province text default 'ON',
  add column if not exists enabled_jurisdictions text[] not null
    default array['CA-ON', 'CA', 'US']::text[],
  add column if not exists enabled_source_providers text[] not null
    default array['a2aj-canada', 'ontario-elaws', 'justice-laws-canada', 'courtlistener-us']::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_default_country_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_default_country_check
      check (default_country in ('CA', 'US'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_default_province_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_default_province_check
      check (default_province is null or default_province = 'ON');
  end if;
end;
$$;

-- Respect an existing user's U.S. opt-out while adding Ontario and federal
-- Canada. No existing U.S. entitlement is removed.
update public.user_profiles
set
  enabled_jurisdictions = case
    when legal_research_us then array['CA-ON', 'CA', 'US']::text[]
    else array['CA-ON', 'CA']::text[]
  end,
  enabled_source_providers = case
    when legal_research_us then array['a2aj-canada', 'ontario-elaws', 'justice-laws-canada', 'courtlistener-us']::text[]
    else array['a2aj-canada', 'ontario-elaws', 'justice-laws-canada']::text[]
  end
where enabled_jurisdictions = array['CA-ON', 'CA', 'US']::text[]
  and enabled_source_providers = array['a2aj-canada', 'ontario-elaws', 'justice-laws-canada', 'courtlistener-us']::text[];

alter table public.projects
  add column if not exists jurisdictions text[] not null
    default array['CA-ON', 'CA']::text[];

alter table public.chats
  add column if not exists jurisdictions text[] not null
    default array['CA-ON', 'CA']::text[],
  add column if not exists legal_as_of_date date;

alter table public.workflows
  alter column practice set default 'Civil Litigation',
  alter column jurisdictions set default array['Canada / Ontario']::text[];
