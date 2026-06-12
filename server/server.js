require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const {
    assertAllowedImportFile,
    normalizeYieldRows,
    parseImportRows,
} = require('./importRows');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
if (process.env.VERCEL_URL) {
    const vercelOrigin = `https://${process.env.VERCEL_URL}`;
    if (!allowedOrigins.includes(vercelOrigin)) {
        allowedOrigins.push(vercelOrigin);
    }
}
const allowCredentials = process.env.CORS_ALLOW_CREDENTIALS === 'true';
const TOKEN_EXPIRY_SECONDS = Number.parseInt(process.env.JWT_EXPIRES_IN_SECONDS || '86400', 10) || 86400;
const SECRET_KEY = process.env.JWT_SECRET || (process.env.NODE_ENV === 'development'
  ? crypto.randomBytes(32).toString('hex')
  : null);
const apiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many requests. Please try again later.' }),
});

if (!SECRET_KEY) {
  throw new Error('JWT_SECRET is required to start the server');
}

if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET not set; using ephemeral dev secret. Set JWT_SECRET to persist sessions.');
}

// Middleware
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: allowCredentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('/{*splat}', cors(corsOptions));

app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS origin denied' });
  }
  return next(err);
});
app.use('/api', apiRateLimit);
app.use(express.json());

// Database Setup
const db = new sqlite3.Database('./fish_app.db', (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to SQLite database.');
});

// Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user'
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS calculations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        species TEXT,
        product TEXT,
        cost REAL,
        yield REAL,
        result REAL,
        date TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        species TEXT,
        product TEXT,
        yield REAL,
        source TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE,
        display_name TEXT,
        organization TEXT,
        bio TEXT,
        show_on_page INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});

// Auth Middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            const status = err.name === 'TokenExpiredError' ? 401 : 403;
            return res.status(status).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Routes

// Register — delegates to shared handler core (shared/handlers/register.js).
// Dynamic import() bridges the CJS server to the ESM handler core without
// converting server.js to ESM.  The import resolves once and is cached by
// Node's module registry on subsequent requests.
const { makeSqliteAdapter } = require('./adapters/sqliteDb');
app.post('/api/register', async (req, res) => {
    const { handleRegister } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleRegister(req.body ?? {}, dbAdapter);
    return res.status(status).json(body);
});

// Login — delegates to shared handler core (shared/handlers/login.js).
app.post('/api/login', async (req, res) => {
    const { handleLogin } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleLogin(
        req.body ?? {},
        dbAdapter,
        { jwtSecret: SECRET_KEY, tokenExpirySeconds: TOKEN_EXPIRY_SECONDS }
    );
    return res.status(status).json(body);
});

// Save Calculation — delegates to shared handler core.
app.post('/api/save-calc', authenticate, async (req, res) => {
    const { handleSaveCalc } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleSaveCalc(
        { userId: req.user.id, ...req.body },
        dbAdapter
    );
    return res.status(status).json(body);
});

// List Calculations — delegates to shared handler core.
app.get('/api/saved-calcs', authenticate, async (req, res) => {
    const { handleListSavedCalcs } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleListSavedCalcs({ userId: req.user.id }, dbAdapter);
    return res.status(status).json(body);
});

// Delete Calculation — delegates to shared handler core.
app.delete('/api/saved-calcs/:id', authenticate, async (req, res) => {
    const { handleDeleteCalc } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleDeleteCalc(
        { userId: req.user.id, id: req.params.id },
        dbAdapter
    );
    return res.status(status).json(body);
});

// Public Calculations — delegates to shared handler core.
app.get('/api/public-calcs', async (req, res) => {
    const { handleListPublicCalcs } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleListPublicCalcs({}, dbAdapter);
    return res.status(status).json(body);
});

// Fish Data — delegates to shared handler core.
app.get('/api/fish-data', async (req, res) => {
    const { handleGetFishData } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleGetFishData({}, dbAdapter);
    return res.status(status).json(body);
});

// Upload Data (XLSX/CSV)
const MAX_UPLOAD_SIZE_BYTES = 4 * 1024 * 1024; // 4MB

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
        try {
            assertAllowedImportFile(file);
            cb(null, true);
        } catch (error) {
            error.code = 'INVALID_FILE_TYPE';
            cb(error);
        }
    },
});

const uploadSingle = upload.single('file');

app.post('/api/upload-data', authenticate, (req, res) => {
    uploadSingle(req, res, async (err) => {
        if (err) {
            let message = 'Failed to upload file.';
            if (err.code === 'LIMIT_FILE_SIZE') {
                message = 'File too large. Max 4MB.';
            } else if (err.code === 'INVALID_FILE_TYPE') {
                message = 'Invalid file type. Only .xlsx or .csv files are allowed.';
            }
            return res.status(400).json({ error: message });
        }

        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        try {
            const extension = assertAllowedImportFile(req.file);
            const buffer = req.file.buffer;
            if (!Buffer.isBuffer(buffer)) {
                return res.status(400).json({ error: 'Invalid upload payload' });
            }
            const data = await parseImportRows(buffer, extension);
            const { rows, skippedRows } = normalizeYieldRows(data, 'Uploaded File');

            const { handleUploadUserDataRows } = await import('../shared/handlers/index.js');
            const dbAdapter = makeSqliteAdapter(db);
            const { status, body } = await handleUploadUserDataRows({
                userId: req.user.id,
                rows,
                skippedRows,
            }, dbAdapter);
            res.status(status).json(body);
        } catch (e) {
            const status = /unsupported file|parse csv|no valid/i.test(e.message || '') ? 400 : 500;
            const message = status === 400
                ? e.message
                : 'Failed to process file. Ensure it is a valid spreadsheet.';
            res.status(status).json({ error: message });
        }
    });
});

// Get User Custom Data — delegates to shared handler core.
app.get('/api/user-data', authenticate, async (req, res) => {
    const { handleListUserData } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleListUserData({ userId: req.user.id }, dbAdapter);
    return res.status(status).json(body);
});

// Add Single User Data Entry — delegates to shared handler core.
app.post('/api/user-data', authenticate, async (req, res) => {
    const { handleCreateUserData } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleCreateUserData(
        { userId: req.user.id, ...req.body },
        dbAdapter
    );
    return res.status(status).json(body);
});

// Update User Data Entry — delegates to shared handler core.
app.put('/api/user-data/:id', authenticate, async (req, res) => {
    const { handleUpdateUserData } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleUpdateUserData(
        { userId: req.user.id, id: req.params.id, ...req.body },
        dbAdapter
    );
    return res.status(status).json(body);
});

// Delete User Data Entry — delegates to shared handler core.
app.delete('/api/user-data/:id', authenticate, async (req, res) => {
    const { handleDeleteUserData } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleDeleteUserData(
        { userId: req.user.id, id: req.params.id },
        dbAdapter
    );
    return res.status(status).json(body);
});

// Unified export endpoint — delegates to shared handler core.
app.get('/api/export', authenticate, async (req, res) => {
    const { handleExport } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleExport(
        { userId: req.user.id, type: req.query.type || 'calcs' },
        dbAdapter
    );

    if (status !== 200) {
        return res.status(status).json(body);
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${body.filename}`);
    return res.status(200).send(body.csv);
});

// Get all visible contributors (public) — delegates to shared handler core.
app.get('/api/contributors', async (req, res) => {
    const { handleListContributors } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleListContributors({}, dbAdapter);
    return res.status(status).json(body);
});

const getCurrentContributorProfile = async (req, res) => {
    const { handleGetContributorProfile } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleGetContributorProfile(
        { userId: req.user.id },
        dbAdapter
    );
    return res.status(status).json(body);
};

// Get current user's contributor profile
app.get('/api/contributor', authenticate, getCurrentContributorProfile);
app.get('/api/contributor/me', authenticate, getCurrentContributorProfile);

// Create or update contributor profile
app.post('/api/contributor', authenticate, async (req, res) => {
    const { handleSaveContributorProfile } = await import('../shared/handlers/index.js');
    const dbAdapter = makeSqliteAdapter(db);
    const { status, body } = await handleSaveContributorProfile(
        { userId: req.user.id, ...req.body },
        dbAdapter
    );
    return res.status(status).json(body);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
