-- Per-user practice profile.
--
-- A free-text "playbook" the user maintains (firm positions, house style,
-- escalation matrix, preferred governing law, etc.). It is injected into the
-- assistant system prompt so ported legal workflows can rely on the user's
-- configured positions instead of assuming defaults. Mirrors the per-team
-- CLAUDE.md practice profiles used by the claude-for-legal skill set.
alter table public.user_profiles
  add column if not exists practice_profile text;
