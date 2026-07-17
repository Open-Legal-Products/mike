-- Add HKDF salt column to user_api_keys table.
--
-- WHY: The existing encryption used a single SHA-256 key derived from
-- USER_API_KEYS_ENCRYPTION_SECRET.  All rows shared the same encryption
-- key — compromise of the master secret meant all stored API keys could
-- be decrypted simultaneously.
--
-- The new scheme uses HKDF (RFC 5869) with a random 16-byte salt stored
-- per row.  Each row has a unique derived key.  Compromising one row's
-- key reveals nothing about other rows.
--
-- The `salt` column is nullable to preserve backwards compatibility:
-- existing rows (written without HKDF) have salt = NULL and are decrypted
-- using the legacy SHA-256 path.  New writes always include a salt.
--
-- After deploying this migration, rows will be re-encrypted with HKDF
-- the next time a user saves their API keys.  No bulk re-encryption
-- script is required — the migration is purely additive.

ALTER TABLE user_api_keys
    ADD COLUMN IF NOT EXISTS salt text;

COMMENT ON COLUMN user_api_keys.salt IS
    'Base64-encoded 16-byte HKDF salt. NULL = legacy SHA-256 encryption path.';
