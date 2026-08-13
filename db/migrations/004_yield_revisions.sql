-- Migration: add revisioned sync columns to user_data (custom yield observations)
-- Run once against the Neon (PostgreSQL) production database.
-- SQLite applies equivalent ALTER TABLE statements at server startup (server.js).
--
-- client_id: stable UUID from the client; ensures a retry of the same local
--   record does not create a duplicate on the server.
-- revision: monotonically increasing integer; the server increments it on every
--   successful update. Clients send the last observed revision on update/delete;
--   a mismatched revision returns 409 Conflict.
-- created_at / updated_at: authoritative server timestamps for reconciliation.

ALTER TABLE user_data ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE user_data ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_data ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_data ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill timestamps for existing rows using the current time (no historical date available).
UPDATE user_data
   SET created_at = NOW(),
       updated_at = NOW()
 WHERE created_at IS NULL;

-- Account-scoped unique index: (user_id, client_id) so two users can share a
-- client_id value without blocking each other.  Replace the previously-deployed
-- global index first; IF NOT EXISTS alone would silently retain the old one.
DROP INDEX IF EXISTS user_data_client_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS user_data_user_client_id_unique
    ON user_data (user_id, client_id)
 WHERE client_id IS NOT NULL;
