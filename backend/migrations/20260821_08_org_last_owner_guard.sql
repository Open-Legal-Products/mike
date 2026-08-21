-- Migration date: 2026-08-21

-- DB-level guard for the "an organization must keep at least one owner"
-- invariant.
--
-- The application enforces last-owner protection in lib/orgs.ts, but that
-- check is read-then-act: two concurrent requests each demoting/removing a
-- DIFFERENT owner both count two owners, both pass, and the org ends up
-- ownerless — permanently, because granting the owner role itself requires
-- an owner, so no API call can ever repair it. A trigger closes the race by
-- serializing owner departures per org: it locks the organizations row
-- first, so the second transaction re-counts only after the first has
-- committed, sees one owner left, and fails cleanly (23514, which the
-- service layer maps onto the same 409 the sequential path returns).
--
-- Two escape hatches keep legitimate cascades working:
--   * org deletion — by the time the cascade reaches org_members, the
--     organizations row is already gone inside this transaction, so the
--     lock probe finds nothing and the guard steps aside (account cleanup
--     deletes personal/empty orgs this way).
--   * auth.users deletion — org_members.user_id cascades from auth.users;
--     when the departing member's auth row is gone, the membership is being
--     dismantled by user deletion, not violated by an API call. App-level
--     account deletion hands ownership off BEFORE removing the membership
--     (lib/userDataCleanup.ts); this hatch covers direct auth-admin
--     deletions that bypass the app. security definer (same posture as
--     handle_new_user) so the auth.users probe works regardless of the
--     calling role.
create or replace function public.org_members_protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  -- Serialize concurrent owner departures on this org. If the org row is
  -- already deleted in this transaction (delete cascade), stand aside.
  perform 1 from public.organizations where id = old.org_id for update;
  if not found then
    return coalesce(new, old);
  end if;

  -- Member's auth user being deleted (cascade from auth.users): stand aside.
  if tg_op = 'DELETE' and not exists (
    select 1 from auth.users where id = old.user_id
  ) then
    return old;
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = old.org_id and role = 'owner' and user_id <> old.user_id
  ) then
    raise exception 'An organization must keep at least one owner'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists org_members_last_owner_guard on public.org_members;
create trigger org_members_last_owner_guard
  before delete or update of role on public.org_members
  for each row execute procedure public.org_members_protect_last_owner();
