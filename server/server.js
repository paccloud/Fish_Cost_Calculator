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
        
        let count = 0;
        db.serialize(() => {
            const stmt = db.prepare('INSERT INTO user_data (user_id, species, product, yield, source) VALUES (?, ?, ?, ?, ?)');
            data.forEach(row => {
                // Heuristic mapping - adjust based on user Excel structure ("Common name", "% Yield")
                const species = row['Common name'] || row['Species'] || row['Name'];
                const yieldVal = row['% Yield'] || row['Yield'];
                const product = row['Product'] || 'General';
                
                if (species && yieldVal) {
                    let finalYield = yieldVal;
                    if (finalYield < 1) finalYield = finalYield * 100; // decimal to percent
                    
                    stmt.run(req.user.id, species, product, finalYield, req.file.originalname);
                    count++;
                }
            });
            stmt.finalize();
        });
        
        // Cleanup
        fs.unlinkSync(req.file.path);
        
        res.json({ message: `Imported ${count} records` });
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

