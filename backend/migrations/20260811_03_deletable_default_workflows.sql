-- Allow users to delete an installed default workflow without reinstalling it.
-- The installation row remains as the durable first-install marker, while
-- quick_actions.workflow_id continues to cascade when the workflow is deleted.

alter table public.default_workflow_installations
  drop constraint if exists default_workflow_installations_workflow_id_fkey;

alter table public.default_workflow_installations
  alter column workflow_id drop not null;

alter table public.default_workflow_installations
  add constraint default_workflow_installations_workflow_id_fkey
  foreign key (workflow_id)
  references public.workflows(id)
  on delete set null;
