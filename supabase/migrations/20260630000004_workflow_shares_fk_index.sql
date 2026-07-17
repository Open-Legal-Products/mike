-- FK index: workflow_shares.shared_by_user_id references auth.users ON DELETE
-- CASCADE; without an index, deleting a user full-scans this table. (workflow_id
-- is already covered by workflow_shares_workflow_id_idx + the unique constraint.)
create index if not exists workflow_shares_shared_by_user_id_idx
  on public.workflow_shares(shared_by_user_id);
