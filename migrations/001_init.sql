-- Better Auth tables (Better Auth creates these automatically, but we define them for D1 migration)
CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE NOT NULL,
    emailVerified INTEGER DEFAULT 0,
    image TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    role TEXT DEFAULT 'fisher'
);

CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expiresAt TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt TEXT,
    refreshTokenExpiresAt TEXT,
    scope TEXT,
    password TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
);

-- App tables
CREATE TABLE IF NOT EXISTS calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
    name TEXT,
    species TEXT,
    product TEXT,
    cost REAL,
    yield REAL,
    result REAL,
    date TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
    species TEXT NOT NULL,
    product TEXT NOT NULL,
    yield REAL NOT NULL,
    source TEXT
);

CREATE TABLE IF NOT EXISTS contributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT UNIQUE REFERENCES user(id) ON DELETE CASCADE,
    display_name TEXT,
    organization TEXT,
    bio TEXT,
    show_on_page INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calculations_user_id ON calculations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data(user_id);
CREATE INDEX IF NOT EXISTS idx_calculations_date ON calculations(date DESC);
