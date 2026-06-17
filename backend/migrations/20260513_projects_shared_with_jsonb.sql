-- Migration date: 2026-05-13

-- Migration: convert projects.shared_with from text[] to jsonb.
-- tabular_reviews.shared_with is already jsonb and is intentionally untouched.

-- Only convert while shared_with is still text[]. Re-running the type change
-- over an already-jsonb column is unnecessary and the guard keeps it a no-op.
do $$
begin
  if (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'shared_with'
  ) = 'ARRAY' then
    alter table public.projects
        alter column shared_with drop default;

    alter table public.projects
        alter column shared_with type jsonb
        using case
            when shared_with is null then '[]'::jsonb
            else to_jsonb(shared_with)
        end;
  end if;
end $$;

alter table public.projects
    alter column shared_with set default '[]'::jsonb;

alter table public.projects
    alter column shared_with set not null;

create index if not exists projects_shared_with_idx
    on public.projects using gin (shared_with);
