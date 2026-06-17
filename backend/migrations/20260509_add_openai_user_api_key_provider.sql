-- Migration date: 2026-05-09

-- Allow users to store an OpenAI API key alongside Claude and Gemini keys.
do $$
begin
  alter table public.user_api_keys
    drop constraint if exists user_api_keys_provider_check;

  alter table public.user_api_keys
    add constraint user_api_keys_provider_check
    check (provider in ('claude', 'gemini', 'openai'));
end $$;
