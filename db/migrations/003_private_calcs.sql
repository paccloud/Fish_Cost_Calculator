-- Migration: add private-by-default and idempotent-sync columns to calculations
-- Run once against the Neon (PostgreSQL) production database.
-- SQLite applies equivalent ALTER TABLE statements at server startup (server.js).
--
-- client_id: stable UUID from the client; ensures a retry of the same local
--   record does not create a duplicate on the server.
-- is_private: TRUE by default; existing calcs are backfilled to TRUE so the
--   public feed only shows records explicitly made public.
-- created_at / updated_at: authoritative server timestamps for cross-device
--   reconciliation.  Backfilled from the existing `date` column.

ALTER TABLE calculations ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE calculations ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE calculations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE calculations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Backfill timestamps from the existing `date` column.
UPDATE calculations
   SET created_at = date,
       updated_at = date
 WHERE created_at IS NULL;

-- Ensure all existing calcs are private before any publication controls ship.
UPDATE calculations
   SET is_private = TRUE
 WHERE is_private IS NULL;

-- Unique index prevents duplicate inserts for the same client_id.
-- Partial index excludes NULLs so legacy rows (no client_id) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS calculations_client_id_unique
    ON calculations (client_id)
 WHERE client_id IS NOT NULL;
