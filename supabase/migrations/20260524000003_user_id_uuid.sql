-- Convert user_id columns from text to uuid with FK to auth.users on all
-- tables that still use text.  (PR #113 — bmersereau)
--
-- WHY THIS MATTERS
-- ================
-- Supabase Auth always issues UUIDs for user IDs, so storing them as `text`
-- is purely a missed type constraint:
--
--   1. TYPE SAFETY: A `text` column accepts any string — a typo, a blank,
--      or a completely invalid ID passes silently and causes silent data
--      corruption.  A `uuid` column rejects non-UUID values at the DB level.
--
--   2. REFERENTIAL INTEGRITY: Without a FK constraint, deleting a Supabase
--      auth user leaves orphaned rows in every downstream table.  With
--      `ON DELETE CASCADE` those rows are automatically cleaned up;
--      with `ON DELETE SET NULL` (for workflows, which are shareable and
--      should outlive individual accounts) the user_id is simply nulled.
--
--   3. STORAGE & INDEX SIZE: Postgres stores a UUID in 16 bytes vs. 36 bytes
--      for the text representation.  The difference compounds across millions
--      of rows and their indexes.
--
-- SAFETY
-- ======
-- The `ALTER COLUMN … USING user_id::uuid` cast will FAIL if any existing
-- row contains a non-UUID string in `user_id`.  Because every row was
-- inserted by the application (which always receives UUIDs from Supabase
-- Auth), this should never happen in practice.  The migration is wrapped
-- in a transaction so a partial failure rolls back cleanly — no silent
-- half-migration.
--
-- If you need to verify first:
--   SELECT user_id FROM public.projects WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
-- All tables use this same pattern.
--
-- TABLES AFFECTED (9)
-- ===================
--   projects                    user_id → ON DELETE CASCADE
--   project_subfolders          user_id → ON DELETE CASCADE
--   documents                   user_id → ON DELETE CASCADE
--   workflows                   user_id → ON DELETE SET NULL  (shared workflows survive account deletion)
--   hidden_workflows            user_id → ON DELETE CASCADE
--   workflow_shares             shared_by_user_id → ON DELETE CASCADE
--   chats                       user_id → ON DELETE CASCADE
--   tabular_reviews             user_id → ON DELETE CASCADE
--   tabular_review_chats        user_id → ON DELETE CASCADE

BEGIN;

-- ── projects ────────────────────────────────────────────────────────────────

ALTER TABLE public.projects
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.projects
    ADD CONSTRAINT projects_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ── project_subfolders ───────────────────────────────────────────────────────

ALTER TABLE public.project_subfolders
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.project_subfolders
    ADD CONSTRAINT project_subfolders_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ── documents ────────────────────────────────────────────────────────────────

ALTER TABLE public.documents
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.documents
    ADD CONSTRAINT documents_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ── workflows ────────────────────────────────────────────────────────────────
-- user_id is nullable (system/shared workflows have user_id IS NULL).
-- ON DELETE SET NULL preserves the workflow when the author deletes their account.

ALTER TABLE public.workflows
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.workflows
    ADD CONSTRAINT workflows_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE SET NULL;

-- ── hidden_workflows ──────────────────────────────────────────────────────────

ALTER TABLE public.hidden_workflows
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.hidden_workflows
    ADD CONSTRAINT hidden_workflows_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ── workflow_shares ───────────────────────────────────────────────────────────
-- The sharer's user_id is stored as shared_by_user_id.

ALTER TABLE public.workflow_shares
    ALTER COLUMN shared_by_user_id TYPE uuid USING shared_by_user_id::uuid;

ALTER TABLE public.workflow_shares
    ADD CONSTRAINT workflow_shares_shared_by_user_id_fkey
    FOREIGN KEY (shared_by_user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ── chats ────────────────────────────────────────────────────────────────────

ALTER TABLE public.chats
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.chats
    ADD CONSTRAINT chats_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ── tabular_reviews ───────────────────────────────────────────────────────────

ALTER TABLE public.tabular_reviews
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.tabular_reviews
    ADD CONSTRAINT tabular_reviews_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ── tabular_review_chats ──────────────────────────────────────────────────────

ALTER TABLE public.tabular_review_chats
    ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.tabular_review_chats
    ADD CONSTRAINT tabular_review_chats_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

COMMIT;
