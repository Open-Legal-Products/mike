-- Migration date: 2026-04-21

-- Migration: add optional per-user API keys for direct provider access.
-- When set, these keys override the server-wide env keys for that user's
-- requests; callers must fall back to env when null.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS claude_api_key TEXT,
  ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;
