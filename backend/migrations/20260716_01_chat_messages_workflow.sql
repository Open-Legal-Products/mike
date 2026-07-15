-- Add chat_messages.workflow.
--
-- The app persists a `workflow` field on user messages
-- (backend/src/routes/chat.ts, projectChat.ts) and reads it back when rendering
-- chat history (frontend ChatView -> UserMessage, to show which workflow the
-- message was sent under). The column was referenced in code but never created
-- by schema.sql or any migration, so every user-message insert failed with
-- PostgREST PGRST204 ("Could not find the 'workflow' column") and was dropped
-- silently — user prompts vanished on reload while the assistant reply
-- persisted. Mirrors the existing content/files jsonb columns.
alter table public.chat_messages
  add column if not exists workflow jsonb;
