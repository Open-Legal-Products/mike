-- Migration date: 2026-04-19

-- Migration: Convert tabular_review_chat_messages.content from TEXT to JSONB
-- and add annotations JSONB column.
--
-- User messages:     content TEXT → JSON string  (e.g. "hello" → '"hello"')
-- Assistant messages: content TEXT → events array (e.g. "answer" → '[{"type":"content","text":"answer"}]')
--
-- Only convert while content is still TEXT. Re-running over jsonb content would
-- double-wrap assistant events, so the type check makes this safe to re-run.
DO $$
BEGIN
  IF (
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tabular_review_chat_messages'
      AND column_name = 'content'
  ) = 'text' THEN
    ALTER TABLE tabular_review_chat_messages
      ALTER COLUMN content TYPE jsonb
      USING CASE
        WHEN role = 'user'
          THEN to_jsonb(content)
        ELSE
          jsonb_build_array(jsonb_build_object('type', 'content', 'text', content))
      END;
  END IF;
END $$;

ALTER TABLE tabular_review_chat_messages
  ADD COLUMN IF NOT EXISTS annotations jsonb;
