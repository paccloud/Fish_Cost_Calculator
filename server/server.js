require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'freshfishfixsecret'; // Fallback for dev

// Middleware
app.use(cors());
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

    // Add is_shared column to user_data if it doesn't exist (safe migration)
    db.run(`ALTER TABLE user_data ADD COLUMN is_shared INTEGER DEFAULT 0`, (err) => {
        // Ignore error if column already exists
    });
});

// Auth Middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Routes

// Register
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function(err) {
            if (err) return res.status(400).json({ error: 'User already exists' });
            res.json({ id: this.lastID, username });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
        
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY);
            res.json({ token, username: user.username });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    });
});

// Save Calculation
app.post('/api/save-calc', authenticate, (req, res) => {
    const { name, species, product, cost, yield: yieldPercent, result } = req.body;
    const date = new Date().toISOString();
    db.run('INSERT INTO calculations (user_id, name, species, product, cost, yield, result, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [req.user.id, name, species, product, cost, yieldPercent, result, date], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Saved successfully' });
        }
    );
});

// Get Calculations
app.get('/api/saved-calcs', authenticate, (req, res) => {
    db.all('SELECT * FROM calculations WHERE user_id = ? ORDER BY date DESC', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Upload Data (Excel/CSV)
const upload = multer({ dest: 'uploads/' });

app.post('/api/upload-data', authenticate, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        // Validate rows before any writes
        const rows = [];
        const skippedRows = [];
        data.forEach((row, idx) => {
            const species = (row['Common name'] || row['Species'] || row['Name'] || '').toString().trim();
            const yieldRaw = row['% Yield'] || row['Yield'];
            const product = (row['Product'] || 'General').toString().trim();

            if (!species || yieldRaw === undefined || yieldRaw === null || yieldRaw === '') {
                skippedRows.push(idx + 2); // 1-indexed + header row
                return;
            }
            let finalYield = parseFloat(yieldRaw);
            if (isNaN(finalYield) || finalYield < 0 || finalYield > 100) {
                if (!isNaN(finalYield) && finalYield > 0 && finalYield <= 1) {
                    finalYield = finalYield * 100; // decimal to percent
                } else {
                    skippedRows.push(idx + 2);
                    return;
                }
            }
            rows.push({ species, product, yield: finalYield, source: req.file.originalname });
        });

        let inserted = 0;
        let updated = 0;
        db.serialize(() => {
            rows.forEach(row => {
                db.get(
                    'SELECT id FROM user_data WHERE user_id = ? AND LOWER(species) = LOWER(?) AND LOWER(product) = LOWER(?)',
                    [req.user.id, row.species, row.product],
                    (err, existing) => {
                        if (err) return;
                        if (existing) {
                            db.run(
                                'UPDATE user_data SET yield = ?, source = ? WHERE id = ?',
                                [row.yield, row.source, existing.id]
                            );
                            updated++;
                        } else {
                            db.run(
                                'INSERT INTO user_data (user_id, species, product, yield, source) VALUES (?, ?, ?, ?, ?)',
                                [req.user.id, row.species, row.product, row.yield, row.source]
                            );
                            inserted++;
                        }
                    }
                );
            });
        });

        // Cleanup temp file
        fs.unlinkSync(req.file.path);

        const parts = [];
        if (inserted > 0) parts.push(`${inserted} added`);
        if (updated > 0) parts.push(`${updated} updated`);
        if (skippedRows.length > 0) parts.push(`${skippedRows.length} skipped (invalid rows)`);
        res.json({ message: parts.length ? parts.join(', ') : 'No valid records found', inserted, updated, skipped: skippedRows.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get User Custom Data
app.get('/api/user-data', authenticate, (req, res) => {
    db.all('SELECT id, species, product, yield, source FROM user_data WHERE user_id = ?', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add Single User Data Entry
app.post('/api/user-data', authenticate, (req, res) => {
    const { species, product, yield: yieldVal, source } = req.body;
    if (!species || !product || yieldVal === undefined) {
        return res.status(400).json({ error: 'Species, product, and yield are required' });
    }
    
    db.run(
        'INSERT INTO user_data (user_id, species, product, yield, source) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, species, product, yieldVal, source || 'User Input'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Added successfully' });
        }
    );
});

// Update User Data Entry
app.put('/api/user-data/:id', authenticate, (req, res) => {
    const { id } = req.params;
    const { species, product, yield: yieldVal, source } = req.body;
    
    // Verify ownership
    db.get('SELECT * FROM user_data WHERE id = ? AND user_id = ?', [id, req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Entry not found or not owned by user' });
        
        db.run(
            'UPDATE user_data SET species = ?, product = ?, yield = ?, source = ? WHERE id = ? AND user_id = ?',
            [species || row.species, product || row.product, yieldVal !== undefined ? yieldVal : row.yield, source || row.source, id, req.user.id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Updated successfully' });
            }
        );
    });
});

// Delete User Data Entry
app.delete('/api/user-data/:id', authenticate, (req, res) => {
    const { id } = req.params;

    // Verify ownership before delete
    db.get('SELECT * FROM user_data WHERE id = ? AND user_id = ?', [id, req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Entry not found or not owned by user' });

        db.run('DELETE FROM user_data WHERE id = ? AND user_id = ?', [id, req.user.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Deleted successfully' });
        });
    });
});

// Export Calculations as CSV
app.get('/api/export-calcs', authenticate, (req, res) => {
    db.all('SELECT * FROM calculations WHERE user_id = ? ORDER BY date DESC', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Create CSV content
        const headers = 'Date,Species,Conversion,Cost,Yield (%),Result\n';
        const csvRows = rows.map(row => {
            const date = new Date(row.date).toLocaleDateString();
            return `"${date}","${row.species}","${row.product}","${row.cost}","${row.yield}","${row.result}"`;
        }).join('\n');

        const csv = headers + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="calculations.csv"');
        res.send(csv);
    });
});

// Export User Data as CSV
app.get('/api/export-user-data', authenticate, (req, res) => {
    db.all('SELECT * FROM user_data WHERE user_id = ?', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Create CSV content
        const headers = 'Species,Product,Yield (%),Source\n';
        const csvRows = rows.map(row => {
            return `"${row.species}","${row.product}","${row.yield}","${row.source || ''}"`;
        }).join('\n');

        const csv = headers + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="custom-yield-data.csv"');
        res.send(csv);
    });
});

// Get all visible contributors (public)
app.get('/api/contributors', (req, res) => {
    const query = `
        SELECT c.*, u.username, COUNT(ud.id) as contribution_count
        FROM contributors c
        JOIN users u ON c.user_id = u.id
        LEFT JOIN user_data ud ON c.user_id = ud.user_id
        WHERE c.show_on_page = 1
        GROUP BY c.id
        ORDER BY contribution_count DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get current user's contributor profile
app.get('/api/contributor/me', authenticate, (req, res) => {
    db.get('SELECT * FROM contributors WHERE user_id = ?', [req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Profile not found' });
        res.json(row);
    });
});

// Create or update contributor profile
app.post('/api/contributor', authenticate, (req, res) => {
    const { display_name, organization, bio, show_on_page } = req.body;
    const now = new Date().toISOString();

    // Check if profile exists
    db.get('SELECT * FROM contributors WHERE user_id = ?', [req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            // Update existing profile
            db.run(
                `UPDATE contributors
                 SET display_name = ?, organization = ?, bio = ?, show_on_page = ?, updated_at = ?
                 WHERE user_id = ?`,
                [display_name, organization, bio, show_on_page ? 1 : 0, now, req.user.id],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Profile updated successfully' });
                }
            );
        } else {
            // Create new profile
            db.run(
                `INSERT INTO contributors (user_id, display_name, organization, bio, show_on_page, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, display_name, organization, bio, show_on_page ? 1 : 0, now, now],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ id: this.lastID, message: 'Profile created successfully' });
                }
            );
        }
    });
});

// Share a user data entry to the community pool
app.post('/api/user-data/:id/share', authenticate, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM user_data WHERE id = ? AND user_id = ?', [id, req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Entry not found or not owned by user' });

        db.run('UPDATE user_data SET is_shared = 1 WHERE id = ? AND user_id = ?', [id, req.user.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Shared with community' });
        });
    });
});

// Unshare a user data entry
app.post('/api/user-data/:id/unshare', authenticate, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM user_data WHERE id = ? AND user_id = ?', [id, req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Entry not found or not owned by user' });

        db.run('UPDATE user_data SET is_shared = 0 WHERE id = ? AND user_id = ?', [id, req.user.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Removed from community' });
        });
    });
});

// Get community pool data (all shared entries, with contributor info)
app.get('/api/community-data', (req, res) => {
    const query = `
        SELECT ud.id, ud.species, ud.product, ud.yield, ud.source,
               COALESCE(c.display_name, u.username) as contributor,
               c.organization
        FROM user_data ud
        JOIN users u ON ud.user_id = u.id
        LEFT JOIN contributors c ON ud.user_id = c.user_id
        WHERE ud.is_shared = 1
        ORDER BY ud.species ASC, ud.product ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Export community data as CSV
app.get('/api/export-community-data', (req, res) => {
    const query = `
        SELECT ud.species, ud.product, ud.yield, ud.source,
               COALESCE(c.display_name, u.username) as contributor,
               c.organization
        FROM user_data ud
        JOIN users u ON ud.user_id = u.id
        LEFT JOIN contributors c ON ud.user_id = c.user_id
        WHERE ud.is_shared = 1
        ORDER BY ud.species ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const headers = 'Species,Product,Yield (%),Source,Contributor,Organization\n';
        const csvRows = rows.map(row =>
            `"${row.species}","${row.product}","${row.yield}","${row.source || ''}","${row.contributor || ''}","${row.organization || ''}"`
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="community-yield-data.csv"');
        res.send(headers + csvRows);
    });
});

// Legacy export route alias (DataManagement.jsx uses /api/export?type=data)
app.get('/api/export', authenticate, (req, res) => {
    const type = req.query.type;
    if (type === 'data') {
        db.all('SELECT * FROM user_data WHERE user_id = ?', [req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const headers = 'Species,Product,Yield (%),Source\n';
            const csvRows = rows.map(row =>
                `"${row.species}","${row.product}","${row.yield}","${row.source || ''}"`
            ).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="custom-yield-data.csv"');
            res.send(headers + csvRows);
        });
    } else if (type === 'calcs') {
        db.all('SELECT * FROM calculations WHERE user_id = ? ORDER BY date DESC', [req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const headers = 'Date,Species,Conversion,Cost,Yield (%),Result\n';
            const csvRows = rows.map(row => {
                const date = new Date(row.date).toLocaleDateString();
                return `"${date}","${row.species}","${row.product}","${row.cost}","${row.yield}","${row.result}"`;
            }).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="calculations.csv"');
            res.send(headers + csvRows);
        });
    } else {
        res.status(400).json({ error: 'Invalid export type. Use ?type=data or ?type=calcs' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

