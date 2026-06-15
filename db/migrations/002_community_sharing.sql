-- Migration: add community sharing to user_data
-- Run once against the Neon (PostgreSQL) production database.
-- SQLite handles this automatically via ALTER TABLE in server.js startup.

ALTER TABLE user_data ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE;
