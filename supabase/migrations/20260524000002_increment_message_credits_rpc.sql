-- Atomic counter increment for message credits.
--
-- WHY A STORED FUNCTION:
-- Without this, the application would need to:
--   1. SELECT message_credits_used FROM user_profiles WHERE user_id = $1
--   2. UPDATE user_profiles SET message_credits_used = $old + 1 WHERE user_id = $1
--
-- Under concurrent requests (two chat messages sent simultaneously), both
-- reads could see the same old value and both updates would set it to old+1
-- instead of old+2.  This is a "lost update" race condition.
--
-- A Postgres function using `+= 1` (or the `UPDATE ... SET col = col + 1`)
-- is atomic — the database serialises concurrent increments correctly.

CREATE OR REPLACE FUNCTION increment_message_credits(uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE user_profiles
    SET message_credits_used = COALESCE(message_credits_used, 0) + 1
    WHERE user_id = uid;
END;
$$;
