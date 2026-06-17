-- Migration date: 2026-04-27

-- Migration: capture the user's organisation alongside display_name.
-- Collected on the signup form (optional) and editable from the account
-- page. Used for display only; no business logic depends on it yet.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS organisation TEXT;
