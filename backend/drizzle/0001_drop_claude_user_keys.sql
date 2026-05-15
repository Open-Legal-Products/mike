-- Bedrock now serves Claude requests with IAM credentials, so the per-user
-- encrypted Claude key column is no longer needed. Purge any existing rows
-- and tighten the provider check constraint to ('gemini', 'openai').
--
-- The 0000_init migration already encodes the narrower constraint, so this
-- migration is only meaningful when applied against a database that was
-- previously seeded from the original Supabase schema.sql (which permitted
-- provider = 'claude'). For greenfield databases this is a no-op.

DELETE FROM "user_api_keys" WHERE "provider" = 'claude';
--> statement-breakpoint
ALTER TABLE "user_api_keys" DROP CONSTRAINT IF EXISTS "user_api_keys_provider_check";
--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_provider_check" CHECK ("user_api_keys"."provider" in ('gemini', 'openai'));
