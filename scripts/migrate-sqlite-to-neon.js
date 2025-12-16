#!/usr/bin/env node
/**
 * Migration script to import SQLite data into Neon PostgreSQL
 * Run with: node scripts/migrate-sqlite-to-neon.js
 */

import Database from 'better-sqlite3';
import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from app/.env.development or app/.env.production
dotenv.config({ path: join(__dirname, '../app/.env.development') });

const DATABASE_URL = process.env.DATABASE_URL;
const SQLITE_PATH = join(__dirname, '../server/fish_app.db');

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set in environment');
  process.exit(1);
}

async function migrate() {
  console.log('Starting SQLite to Neon PostgreSQL migration...\n');
  
  // Connect to SQLite
  console.log(`Opening SQLite database: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  
  // Connect to PostgreSQL
  console.log('Connecting to Neon PostgreSQL...');
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('Connected to Neon PostgreSQL successfully!\n');
    
    // Migrate users
    console.log('--- Migrating users ---');
    const users = sqlite.prepare('SELECT * FROM users').all();
    console.log(`Found ${users.length} users in SQLite`);
    
    for (const user of users) {
      try {
        // Check if user already exists
        const existing = await pool.query(
          'SELECT id FROM users WHERE username = $1',
          [user.username]
        );
        
        if (existing.rows.length > 0) {
          console.log(`  User "${user.username}" already exists, skipping`);
          continue;
        }
        
        await pool.query(
          `INSERT INTO users (id, username, password, role, auth_provider)
           VALUES ($1, $2, $3, $4, 'password')
           ON CONFLICT (username) DO NOTHING`,
          [user.id, user.username, user.password, user.role || 'user']
        );
        console.log(`  Migrated user: ${user.username} (id: ${user.id})`);
      } catch (err) {
        console.error(`  Error migrating user ${user.username}:`, err.message);
      }
    }
    
    // Reset sequence to max id
    if (users.length > 0) {
      const maxUserId = Math.max(...users.map(u => u.id));
      await pool.query(`SELECT setval('users_id_seq', $1, true)`, [maxUserId]);
      console.log(`  Reset users_id_seq to ${maxUserId}`);
    }
    
    // Migrate calculations
    console.log('\n--- Migrating calculations ---');
    const calculations = sqlite.prepare('SELECT * FROM calculations').all();
    console.log(`Found ${calculations.length} calculations in SQLite`);
    
    for (const calc of calculations) {
      try {
        // Check if calculation already exists
        const existing = await pool.query(
          'SELECT id FROM calculations WHERE id = $1',
          [calc.id]
        );
        
        if (existing.rows.length > 0) {
          console.log(`  Calculation id ${calc.id} already exists, skipping`);
          continue;
        }
        
        await pool.query(
          `INSERT INTO calculations (id, user_id, name, species, product, cost, yield, result, date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            calc.id,
            calc.user_id,
            calc.name,
            calc.species,
            calc.product,
            calc.cost,
            calc.yield,
            calc.result,
            calc.date ? new Date(calc.date) : new Date()
          ]
        );
        console.log(`  Migrated calculation: "${calc.name}" (id: ${calc.id})`);
      } catch (err) {
        console.error(`  Error migrating calculation ${calc.id}:`, err.message);
      }
    }
    
    // Reset sequence
    if (calculations.length > 0) {
      const maxCalcId = Math.max(...calculations.map(c => c.id));
      await pool.query(`SELECT setval('calculations_id_seq', $1, true)`, [maxCalcId]);
      console.log(`  Reset calculations_id_seq to ${maxCalcId}`);
    }
    
    // Migrate user_data
    console.log('\n--- Migrating user_data ---');
    const userData = sqlite.prepare('SELECT * FROM user_data').all();
    console.log(`Found ${userData.length} user_data records in SQLite`);
    
    for (const data of userData) {
      try {
        await pool.query(
          `INSERT INTO user_data (id, user_id, species, product, yield, source)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [data.id, data.user_id, data.species, data.product, data.yield, data.source]
        );
        console.log(`  Migrated user_data: ${data.species} - ${data.product}`);
      } catch (err) {
        console.error(`  Error migrating user_data ${data.id}:`, err.message);
      }
    }
    
    // Reset sequence
    if (userData.length > 0) {
      const maxDataId = Math.max(...userData.map(d => d.id));
      await pool.query(`SELECT setval('user_data_id_seq', $1, true)`, [maxDataId]);
    }
    
    // Migrate contributors
    console.log('\n--- Migrating contributors ---');
    const contributors = sqlite.prepare('SELECT * FROM contributors').all();
    console.log(`Found ${contributors.length} contributors in SQLite`);
    
    for (const contrib of contributors) {
      try {
        await pool.query(
          `INSERT INTO contributors (id, user_id, display_name, organization, bio, show_on_page, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id) DO NOTHING`,
          [
            contrib.id,
            contrib.user_id,
            contrib.display_name,
            contrib.organization,
            contrib.bio,
            contrib.show_on_page === 1,
            contrib.created_at ? new Date(contrib.created_at) : new Date(),
            contrib.updated_at ? new Date(contrib.updated_at) : new Date()
          ]
        );
        console.log(`  Migrated contributor: ${contrib.display_name}`);
      } catch (err) {
        console.error(`  Error migrating contributor ${contrib.id}:`, err.message);
      }
    }
    
    // Reset sequence
    if (contributors.length > 0) {
      const maxContribId = Math.max(...contributors.map(c => c.id));
      await pool.query(`SELECT setval('contributors_id_seq', $1, true)`, [maxContribId]);
    }
    
    console.log('\n✅ Migration completed successfully!');
    
    // Print summary
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const calcCount = await pool.query('SELECT COUNT(*) FROM calculations');
    const dataCount = await pool.query('SELECT COUNT(*) FROM user_data');
    const contribCount = await pool.query('SELECT COUNT(*) FROM contributors');
    
    console.log('\n--- Neon Database Summary ---');
    console.log(`Users: ${userCount.rows[0].count}`);
    console.log(`Calculations: ${calcCount.rows[0].count}`);
    console.log(`User Data: ${dataCount.rows[0].count}`);
    console.log(`Contributors: ${contribCount.rows[0].count}`);
    
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

migrate();
