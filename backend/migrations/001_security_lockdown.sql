-- Lock app data behind backend service-role APIs and clean up tabular cells
-- that point at documents outside their review authorization boundary.

delete from public.tabular_cells c
where not exists (
    select 1
    from public.documents d
    where d.id = c.document_id
  )
  or exists (
    select 1
    from public.tabular_reviews r
    left join public.documents d on d.id = c.document_id
    where r.id = c.review_id
      and (
        d.id is null
        or (
          r.project_id is not null
          and d.project_id is distinct from r.project_id
        )
        or (
          r.project_id is null
          and d.user_id is distinct from r.user_id
        )
      )
  );

alter table public.user_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_subfolders enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_edits enable row level security;
alter table public.workflows enable row level security;
alter table public.hidden_workflows enable row level security;
alter table public.workflow_shares enable row level security;
alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;
alter table public.tabular_reviews enable row level security;
alter table public.tabular_cells enable row level security;
alter table public.tabular_review_chats enable row level security;
alter table public.tabular_review_chat_messages enable row level security;

drop policy if exists "Users can view their own profile" on public.user_profiles;
drop policy if exists "Users can update their own profile" on public.user_profiles;

revoke all on public.user_profiles from anon, authenticated;
revoke all on public.projects from anon, authenticated;
revoke all on public.project_subfolders from anon, authenticated;
revoke all on public.documents from anon, authenticated;
revoke all on public.document_versions from anon, authenticated;
revoke all on public.document_edits from anon, authenticated;
revoke all on public.workflows from anon, authenticated;
revoke all on public.hidden_workflows from anon, authenticated;
revoke all on public.workflow_shares from anon, authenticated;
revoke all on public.chats from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
revoke all on public.tabular_reviews from anon, authenticated;
revoke all on public.tabular_cells from anon, authenticated;
revoke all on public.tabular_review_chats from anon, authenticated;
revoke all on public.tabular_review_chat_messages from anon, authenticated;
