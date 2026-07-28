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
    date TIMESTAMPTZ DEFAULT NOW()
);

-- User data table (custom yield data)
CREATE TABLE IF NOT EXISTS user_data (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    species VARCHAR(255) NOT NULL,
    product VARCHAR(255) NOT NULL,
    yield DECIMAL(5,2) NOT NULL,
    source VARCHAR(255),
    is_shared BOOLEAN DEFAULT FALSE
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

-- Migration for existing databases (run in order if upgrading)
-- Step 1: Add auth columns
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT UNIQUE;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'firebase';
-- ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
-- ALTER TABLE user_data ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE;
--
-- Step 2: Identify and resolve duplicate non-null emails before Step 3.
-- SELECT email, COUNT(*) AS cnt FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;
-- (Merge or null conflicting rows until the query above returns zero rows.)
--
-- Step 3: Enforce email uniqueness (run only after Step 2 returns zero rows)
-- ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
