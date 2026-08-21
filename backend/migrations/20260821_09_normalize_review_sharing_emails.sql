-- Migration date: 2026-08-21

-- Normalize legacy tabular_reviews.shared_with entries the way 20260814_01
-- normalized projects.shared_with.
--
-- That migration lowercased only project shares. Review shares have the same
-- jsonb email-list shape and the same indexed containment consumers — the
-- write path normalizes new entries (routes/tabular.ts) and the TypeScript
-- detail check lowercases both sides (ensureReviewAccess), but the list/ids
-- RPCs compare the STORED value against an already-lowercased caller email
-- (tr.shared_with @> jsonb_build_array(p_user_email)). A pre-normalization
-- mixed-case entry is therefore admitted by detail endpoints yet invisible
-- in every list — a review you can open from a link but never find. Data is
-- the right place to fix a data inconsistency: one pass, and the stored form
-- matches what every predicate expects.

with normalized_reviews as (
  select
    tr.id,
    coalesce(
      jsonb_agg(entries.email order by entries.first_position)
        filter (where entries.email is not null),
      '[]'::jsonb
    ) as shared_with
  from public.tabular_reviews tr
  left join lateral (
    select
      lower(trim(raw.value)) as email,
      min(raw.position) as first_position
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(tr.shared_with) = 'array' then tr.shared_with
        else '[]'::jsonb
      end
    ) with ordinality as raw(value, position)
    where trim(raw.value) <> ''
    group by lower(trim(raw.value))
  ) entries on true
  group by tr.id
)
update public.tabular_reviews tr
set shared_with = normalized_reviews.shared_with
from normalized_reviews
where tr.id = normalized_reviews.id
  and tr.shared_with is distinct from normalized_reviews.shared_with;
