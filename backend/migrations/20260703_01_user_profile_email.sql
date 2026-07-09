-- Mirror auth.users.email into user_profiles so backend sharing checks can
-- resolve one email without scanning Supabase Auth users.

alter table public.user_profiles
  add column if not exists email text;

update public.user_profiles up
set email = lower(au.email)
from auth.users au
where up.user_id = au.id
  and au.email is not null
  and (
    up.email is null
    or up.email <> lower(au.email)
  );

create unique index if not exists user_profiles_email_lower_unique
  on public.user_profiles (lower(email))
  where email is not null and btrim(email) <> '';

create index if not exists idx_user_profiles_email
  on public.user_profiles(email);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, email)
  values (new.id, lower(new.email))
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
exception when others then
  -- Never block signup if the profile insert fails.
  return new;
end;
$$;
