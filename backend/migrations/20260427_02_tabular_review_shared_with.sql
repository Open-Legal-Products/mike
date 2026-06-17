-- Migration date: 2026-04-27

-- Migration: add shared_with to tabular_reviews so standalone reviews
-- (project_id IS NULL) can be shared by email, mirroring projects.shared_with.
-- Project-scoped reviews continue to inherit access from their parent project.

alter table public.tabular_reviews
    add column if not exists shared_with jsonb not null default '[]';

-- Optional but worth it: a generic GIN index speeds up the contains-query
-- the backend uses to fan out shared-review listings.
create index if not exists tabular_reviews_shared_with_idx
    on public.tabular_reviews using gin (shared_with);
