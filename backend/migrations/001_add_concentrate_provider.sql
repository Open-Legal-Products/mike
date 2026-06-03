-- Add 'concentrate' as a valid provider in user_api_keys.
--
-- PostgreSQL does not support adding a value to a CHECK constraint directly;
-- the constraint must be dropped and recreated. The table has no data
-- dependency on the old constraint shape — existing rows with provider in
-- ('claude', 'gemini', 'openai') continue to satisfy the new constraint.

ALTER TABLE public.user_api_keys
    DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;

ALTER TABLE public.user_api_keys
    ADD CONSTRAINT user_api_keys_provider_check
    CHECK (provider IN ('claude', 'gemini', 'openai', 'concentrate'));
