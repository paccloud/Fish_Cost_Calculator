-- Neon PostgreSQL Schema for Local Catch Fish Yield Calculator
-- Run this script in your Neon project's SQL Editor

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password TEXT,  -- NULL for Firebase-only users
    role VARCHAR(50) DEFAULT 'user',
    firebase_uid TEXT UNIQUE,
    email TEXT UNIQUE,
    avatar_url TEXT,
    auth_provider VARCHAR(50) DEFAULT 'firebase'
);

-- Calculations table (saved calculation history)
CREATE TABLE IF NOT EXISTS calculations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255),
    species VARCHAR(255),
    product VARCHAR(255),
    cost DECIMAL(10,2),
    yield DECIMAL(5,2),
    result DECIMAL(10,2),
    date TIMESTAMPTZ DEFAULT NOW(),
    client_id TEXT,
    is_private BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User data table (custom yield data)
CREATE TABLE IF NOT EXISTS user_data (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    species VARCHAR(255) NOT NULL,
    product VARCHAR(255) NOT NULL,
    yield DECIMAL(5,2) NOT NULL,
    source VARCHAR(255),
    is_shared BOOLEAN DEFAULT FALSE,
    client_id TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contributors table (public profiles)
CREATE TABLE IF NOT EXISTS contributors (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(255),
    organization VARCHAR(255),
    bio TEXT,
    show_on_page BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_calculations_user_id ON calculations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data(user_id);
CREATE INDEX IF NOT EXISTS idx_calculations_date ON calculations(date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS calculations_user_client_id_unique
    ON calculations (user_id, client_id)
 WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_data_user_client_id_unique
    ON user_data (user_id, client_id)
 WHERE client_id IS NOT NULL;

-- Migration for existing databases (run in order if upgrading)
-- New databases created from this script already include all columns and constraints.
--
-- Step 1: Add auth columns and firebase_uid uniqueness
-- (Safe to rerun; IF NOT EXISTS and the DO block skip already-applied changes.)
--
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'firebase';
-- ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
-- ALTER TABLE user_data ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE;
--
-- Add UNIQUE constraint on firebase_uid as a named constraint (safe to rerun):
-- DO $$ BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_constraint
--     WHERE conname = 'users_firebase_uid_unique' AND conrelid = 'users'::regclass
--   ) THEN
--     ALTER TABLE users ADD CONSTRAINT users_firebase_uid_unique UNIQUE (firebase_uid);
--   END IF;
-- END $$;
--
-- Step 2: Identify and resolve duplicate non-null emails before Step 3.
-- 1. Export a backup first: pg_dump -t users <connection-string> > users_backup.sql
-- 2. Review duplicates:
-- SELECT email, COUNT(*) AS cnt FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;
-- 3. For each duplicate group, determine the canonical account (check firebase_uid or oldest id):
--    - Reassign calculations and user_data rows to the canonical user_id.
--    - For contributors (UNIQUE per user): if only the stale user has a profile, reassign it
--      (UPDATE contributors SET user_id = <canonical> WHERE user_id = <stale>).
--      If both users have a contributor profile, merge fields from the stale profile into the
--      canonical one, then DELETE FROM contributors WHERE user_id = <stale> before deleting the
--      stale user. Attempting to reassign when the canonical already has a row fails with a
--      unique-constraint violation — merge and delete first.
--    - contributors.user_id has ON DELETE CASCADE. Deleting the stale user before removing their
--      contributor row silently deletes that profile. Handle the contributor row explicitly first.
--    - Then delete or null the email on stale user rows.
-- 4. Rerun the query above and confirm zero rows before continuing.
--
-- Step 3: Enforce email uniqueness (run only after Step 2 returns zero rows)
-- Safe to rerun: the DO block skips if the constraint already exists.
-- DO $$ BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_constraint
--     WHERE conname = 'users_email_unique' AND conrelid = 'users'::regclass
--   ) THEN
--     ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
--   END IF;
-- END $$;
