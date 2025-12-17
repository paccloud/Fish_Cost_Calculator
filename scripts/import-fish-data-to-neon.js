#!/usr/bin/env node
/**
 * Import script to populate Neon PostgreSQL with fish yield data
 * Run with: node scripts/import-fish-data-to-neon.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { FISH_DATA_V3, PROFILES_DATA } from '../app/src/data/fish_data_v3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from app/.env.development or app/.env.production
dotenv.config({ path: join(__dirname, '../app/.env.development') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set in environment');
  process.exit(1);
}

async function createTables(pool) {
  console.log('Creating tables...');

  // Create species table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS species (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      scientific_name VARCHAR(255),
      category VARCHAR(100)
    )
  `);

  // Create fish_yields table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fish_yields (
      id SERIAL PRIMARY KEY,
      species_id INTEGER REFERENCES species(id) ON DELETE CASCADE,
      from_state VARCHAR(255) NOT NULL,
      to_state VARCHAR(255) NOT NULL,
      yield_percent DECIMAL(5,2) NOT NULL,
      range_min DECIMAL(5,2),
      range_max DECIMAL(5,2),
      UNIQUE(species_id, from_state, to_state)
    )
  `);

  // Create indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fish_yields_species_id ON fish_yields(species_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_species_category ON species(category)`);

  // Create profiles table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      description TEXT,
      culinary_uses TEXT,
      edible_portions TEXT
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name)`);

  console.log('Tables created successfully');
}

async function importData(pool) {
  console.log('Starting data import...\n');

  let speciesCount = 0;
  let yieldCount = 0;

  let profileCount = 0;

  if (PROFILES_DATA && typeof PROFILES_DATA === 'object') {
    for (const [profileName, profileData] of Object.entries(PROFILES_DATA)) {
      await pool.query(
        `INSERT INTO profiles (name, description, culinary_uses, edible_portions)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           culinary_uses = EXCLUDED.culinary_uses,
           edible_portions = EXCLUDED.edible_portions`,
        [
          profileName,
          profileData?.description ?? null,
          profileData?.culinary_uses ?? null,
          profileData?.edible_portions ?? null
        ]
      );
      profileCount++;
    }
  }

  for (const [speciesName, speciesData] of Object.entries(FISH_DATA_V3)) {
    // Insert species
    const speciesResult = await pool.query(
      `INSERT INTO species (name, scientific_name, category)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET
         scientific_name = EXCLUDED.scientific_name,
         category = EXCLUDED.category
       RETURNING id`,
      [speciesName, speciesData.scientific_name, speciesData.category]
    );

    const speciesId = speciesResult.rows[0].id;
    speciesCount++;

    console.log(`Processing ${speciesName} (ID: ${speciesId})`);

    // Insert yields
    for (const [conversionKey, conversionData] of Object.entries(speciesData.conversions)) {
      // Parse the conversion key: "From State → To State"
      const parts = conversionKey.split(' → ');
      if (parts.length !== 2) {
        console.warn(`  Skipping invalid conversion key: ${conversionKey}`);
        continue;
      }

      const fromState = parts[0];
      const toState = parts[1];

      await pool.query(
        `INSERT INTO fish_yields (species_id, from_state, to_state, yield_percent, range_min, range_max)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (species_id, from_state, to_state) DO UPDATE SET
           yield_percent = EXCLUDED.yield_percent,
           range_min = EXCLUDED.range_min,
           range_max = EXCLUDED.range_max`,
        [
          speciesId,
          fromState,
          toState,
          conversionData.yield,
          conversionData.range ? conversionData.range[0] : null,
          conversionData.range ? conversionData.range[1] : null
        ]
      );

      yieldCount++;
    }
  }

  console.log(`\n✅ Import completed successfully!`);
  console.log(`Species imported: ${speciesCount}`);
  console.log(`Yield conversions imported: ${yieldCount}`);
  console.log(`Profiles imported: ${profileCount}`);
}

async function main() {
  console.log('Starting fish data import to Neon...\n');
  const sourceSpeciesCount = Object.keys(FISH_DATA_V3).length;
  console.log(`Source species count (FISH_DATA_V3): ${sourceSpeciesCount}\n`);
  const expectedSpeciesCount = process.env.EXPECTED_SPECIES_COUNT
    ? Number(process.env.EXPECTED_SPECIES_COUNT)
    : null;
  if (
    expectedSpeciesCount !== null &&
    Number.isFinite(expectedSpeciesCount) &&
    sourceSpeciesCount !== expectedSpeciesCount
  ) {
    throw new Error(
      `Unexpected FISH_DATA_V3 species count: expected ${expectedSpeciesCount}, got ${sourceSpeciesCount}`
    );
  }

  // Connect to PostgreSQL
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('Connected to Neon PostgreSQL successfully!\n');

    // Create tables
    await createTables(pool);

    // Import data
    await importData(pool);

  } catch (err) {
    console.error('Import failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
