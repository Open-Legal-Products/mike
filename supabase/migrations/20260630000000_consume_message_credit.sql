-- Atomic message-credit consume/refund to fix the check-then-increment race.
-- The chat routes previously called checkMessageCredits (read) and, after the
-- stream, incrementMessageCredits (write) — concurrent requests from a user at
-- their limit could all pass the read and overspend. consume_message_credit
-- row-locks the profile and increments only when under the limit, in one call.

create or replace function public.consume_message_credit(p_user_id uuid, p_limit integer)
returns table(allowed boolean, used integer, reset_date timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_reset timestamptz;
begin
  select coalesce(message_credits_used, 0), credits_reset_date
    into v_used, v_reset
    from public.user_profiles
   where user_id = p_user_id
   for update;

  if not found then
    return query select true, 0, null::timestamptz;
    return;
  end if;

  if v_reset is null or v_reset <= now() then
    v_used := 0;
    v_reset := coalesce(v_reset, now());
    while v_reset <= now() loop
      v_reset := v_reset + interval '1 month';
    end loop;
  end if;

  if v_used >= p_limit then
    update public.user_profiles
       set message_credits_used = v_used, credits_reset_date = v_reset
     where user_id = p_user_id;
    return query select false, v_used, v_reset;
    return;
  end if;

  v_used := v_used + 1;
  update public.user_profiles
     set message_credits_used = v_used, credits_reset_date = v_reset
   where user_id = p_user_id;
  return query select true, v_used, v_reset;
end;
$$;

create or replace function public.refund_message_credit(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_profiles
     set message_credits_used = greatest(0, coalesce(message_credits_used, 0) - 1)
   where user_id = p_user_id;
end;
$$;
