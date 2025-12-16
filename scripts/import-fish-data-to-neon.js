#!/usr/bin/env node
/**
 * Import fish yield data from fish_data_v3.js into Neon PostgreSQL
 * Run with: node scripts/import-fish-data-to-neon.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../app/.env.development') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set in environment');
  process.exit(1);
}

// Fish data from fish_data_v3.js (inline to avoid ESM import issues)
const FISH_DATA_V3 = {
  "Pink Salmon": {
    scientific_name: "Oncorhynchus gorbuscha",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 91, range: [84, 94] },
      "Round → D/H-Off": { yield: 73, range: [68, 80] },
      "Round → Canned": { yield: 65, range: [58, 67] },
      "Round → Skin-On Fillet (Hand)": { yield: 52, range: [47, 58] },
      "Round → Skin-On Fillet (Machine)": { yield: 50, range: [45, 55] },
      "Round → Skinless Fillet": { yield: 42, range: [41, 46] },
      "Round → SIB Fillet (V-Cut)": { yield: 33, range: [30, 36] },
      "Round → SIB Fillet (Pinboning)": { yield: 41, range: [40, 44] },
      "Round → Steaks": { yield: 58, range: [53, 65] },
      "Round → Roe": { yield: 6, range: [3, 10] },
      "D/H-On → D/H-Off": { yield: 81, range: [72, 90] },
      "D/H-Off → Smoked Sides": { yield: 41, range: [35, 50] }
    }
  },
  "Chum Salmon": {
    scientific_name: "Oncorhynchus keta",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 89, range: [79, 91] },
      "Round → D/H-Off": { yield: 74, range: [71, 77] },
      "Round → Canned": { yield: 67, range: [60, 70] },
      "Round → Skin-On Fillet (Hand)": { yield: 60, range: [55, 63] },
      "Round → Skin-On Fillet (Machine)": { yield: 57, range: [52, 59] },
      "Round → Skinless Fillet": { yield: 50, range: [45, 53] },
      "Round → Steaks": { yield: 58, range: [55, 65] },
      "Round → Roe": { yield: 8, range: [4, 10] },
      "D/H-On → D/H-Off": { yield: 83, range: [79, 91] },
      "D/H-Off → Smoked Sides": { yield: 55, range: [45, 60] }
    }
  },
  "Sockeye Salmon": {
    scientific_name: "Oncorhynchus nerka",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 92, range: [85, 94] },
      "Round → D/H-Off": { yield: 74, range: [66, 82] },
      "Round → Canned": { yield: 67, range: [60, 70] },
      "Round → Skin-On Fillet (Hand)": { yield: 53, range: [50, 59] },
      "Round → Skinless Fillet": { yield: 46, range: [41, 49] },
      "Round → Steaks": { yield: 57, range: [55, 65] },
      "Round → Roe": { yield: 4, range: [3, 6] },
      "D/H-On → D/H-Off": { yield: 80, range: [70, 94] },
      "D/H-Off → Smoked Sides": { yield: 45, range: [35, 60] }
    }
  },
  "Coho Salmon": {
    scientific_name: "Oncorhynchus kisutch",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 92, range: [87, 94] },
      "Round → D/H-Off": { yield: 75, range: [70, 83] },
      "Round → Canned": { yield: 67, range: [60, 70] },
      "Round → Skin-On Fillet (Hand)": { yield: 57, range: [52, 60] },
      "Round → Skinless Fillet": { yield: 51, range: [46, 56] },
      "Round → Steaks": { yield: 62, range: [58, 65] },
      "Round → Roe": { yield: 7, range: [5, 10] },
      "D/H-On → D/H-Off": { yield: 82, range: [76, 92] },
      "D/H-Off → Smoked Sides": { yield: 48, range: [40, 60] }
    }
  },
  "Chinook Salmon": {
    scientific_name: "Oncorhynchus tshawytscha",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [82, 94] },
      "Round → D/H-Off": { yield: 72, range: [68, 74] },
      "Round → Skin-On Fillet (Hand)": { yield: 55, range: [52, 60] },
      "Round → Skinless Fillet": { yield: 46, range: [41, 49] },
      "Round → Steaks": { yield: 58, range: [54, 65] },
      "Round → Roe": { yield: 6, range: [3, 10] },
      "D/H-On → D/H-Off": { yield: 82, range: [73, 90] },
      "D/H-Off → Smoked Sides": { yield: 47, range: [35, 60] }
    }
  },
  "Pacific Cod": {
    scientific_name: "Gadus macrocephalus",
    category: "Groundfish",
    conversions: {
      "Round → D/H-On": { yield: 81, range: [72, 90] },
      "Round → D/H-Off": { yield: 63, range: [56, 75] },
      "Round → Skin-On Fillets (V-cut)": { yield: 45, range: [38, 48] },
      "Round → Skinless Fillets (V-cut)": { yield: 39, range: [22, 45] },
      "Round → SIB Fillets (V-cut)": { yield: 33, range: [18, 39] },
      "Round → Steaks": { yield: 62, range: null },
      "D/H-On → D/H-Off": { yield: 78, range: null },
      "D/H-Off → Skin-On Fillets": { yield: 71, range: [54, 80] },
      "D/H-Off → Skinless Fillets": { yield: 62, range: [31, 81] },
      "D/H-Off → Smoked": { yield: 58, range: [50, 65] },
      "Round → Liver": { yield: 5, range: [3, 7] },
      "Round → Roe": { yield: 4, range: [1, 7] }
    }
  },
  "Walleye Pollock": {
    scientific_name: "Theragra chalcogramma",
    category: "Groundfish",
    conversions: {
      "Round → D/H-On": { yield: 79, range: [72, 86] },
      "Round → D/H-Off": { yield: 62, range: [52, 72] },
      "Round → Skin-On Fillets": { yield: 40, range: [35, 55] },
      "Round → Skinless Fillets": { yield: 34, range: [29, 43] },
      "Round → SIB Fillets": { yield: 28, range: [24, 36] },
      "Round → Mince": { yield: 50, range: [30, 60] },
      "Round → Surimi": { yield: 22, range: [18, 28] },
      "Round → Roe": { yield: 5, range: [2, 9] },
      "D/H-Off → Skinless Fillets": { yield: 55, range: [47, 69] }
    }
  },
  "Pacific Halibut": {
    scientific_name: "Hippoglossus stenolepis",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 85, range: [80, 90] },
      "Round → D/H-Off": { yield: 75, range: [70, 80] },
      "Round → Skin-On Fletches": { yield: 52, range: [48, 58] },
      "Round → Skinless Fletches": { yield: 45, range: [40, 50] },
      "Round → Steaks": { yield: 67, range: [60, 72] },
      "Round → Cheeks": { yield: 2, range: [1, 3] },
      "D/H-Off → Skin-On Fletches": { yield: 69, range: [64, 75] },
      "D/H-Off → Skinless Fletches": { yield: 60, range: [53, 67] }
    }
  },
  "Sablefish": {
    scientific_name: "Anoplopoma fimbria",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 89, range: [86, 94] },
      "Round → D/H-Off": { yield: 68, range: [67, 71] },
      "Round → D/H-Off (Eastern)": { yield: 62, range: [60, 67] },
      "Round → Skin-On Fillet": { yield: 40, range: [38, 46] },
      "Round → Skinless Fillet": { yield: 35, range: null },
      "Round → Steaks": { yield: 62, range: [60, 65] },
      "D/H-Off → Skin-On Fillet": { yield: 59, range: null },
      "D/H-Off → Smoked Sides": { yield: 45, range: [40, 49] },
      "Skin-On Fillets → Smoked Fillets": { yield: 80, range: null }
    }
  },
  "Lingcod": {
    scientific_name: "Ophiodon elongatus",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 90, range: [83, 93] },
      "Round → D/H-Off": { yield: 70, range: [62, 74] },
      "Round → Skinless Fillet": { yield: 35, range: [29, 38] },
      "Round → Steaks": { yield: 62, range: null },
      "D/H-On → D/H-Off": { yield: 80, range: [67, 89] },
      "D/H-On → Skinless Fillet": { yield: 39, range: [31, 45] },
      "D/H-Off → Skinless Fillets": { yield: 49, range: null },
      "D/H-Off → Steaks": { yield: 86, range: null }
    }
  },
  "Dungeness Crab": {
    scientific_name: "Metacarcinus magister",
    category: "Shellfish",
    conversions: {
      "Raw Whole → Cooked Whole": { yield: 92, range: [90, 95] },
      "Raw Whole → Cooked Sections": { yield: 60, range: [52, 67] },
      "Raw Whole → Cooked Meat": { yield: 24, range: [22, 25] },
      "Cooked Whole → Cooked Sections": { yield: 65, range: [60, 70] },
      "Cooked Sections → Cooked Meat": { yield: 40, range: [35, 45] }
    }
  },
  "King Crab (Red/Brown/Golden)": {
    scientific_name: "Paralithodes spp.",
    category: "Shellfish",
    conversions: {
      "Raw Whole → Cooked Sections": { yield: 55, range: [50, 60] },
      "Raw Whole → Cooked Meat": { yield: 20, range: [18, 24] },
      "Cooked Sections → Cooked Meat": { yield: 37, range: [32, 42] }
    }
  },
  "Snow Crab": {
    scientific_name: "Chionoecetes opilio",
    category: "Shellfish",
    conversions: {
      "Raw Whole → Cooked Sections": { yield: 45, range: [40, 50] },
      "Raw Whole → Cooked Meat": { yield: 17, range: [14, 20] },
      "Cooked Sections → Cooked Meat": { yield: 38, range: [33, 43] }
    }
  },
  "Spot Prawns": {
    scientific_name: "Pandalus platyceros",
    category: "Shellfish",
    conversions: {
      "Whole → Heads-Off": { yield: 65, range: [60, 70] },
      "Whole → Peeled Tail Meat": { yield: 35, range: [30, 40] },
      "Heads-Off → Peeled Tail Meat": { yield: 54, range: [48, 60] }
    }
  },
  "Pacific Oysters": {
    scientific_name: "Crassostrea gigas",
    category: "Shellfish",
    conversions: {
      "Whole (Shell-On) → Shucked Meats": { yield: 10, range: [8, 14] }
    }
  },
  "Geoduck": {
    scientific_name: "Panopea generosa",
    category: "Shellfish",
    conversions: {
      "Whole → Cleaned Meat": { yield: 45, range: [40, 50] },
      "Whole → Siphon Only": { yield: 30, range: [25, 35] }
    }
  },
  "Sea Urchin (Red)": {
    scientific_name: "Mesocentrotus franciscanus",
    category: "Shellfish",
    conversions: {
      "Whole → Roe (Uni)": { yield: 12, range: [8, 18] }
    }
  },
  "Yellowfin Sole": {
    scientific_name: "Limanda aspera",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 82, range: [75, 88] },
      "Round → D/H-Off": { yield: 55, range: [48, 62] },
      "Round → Skinless Fillets": { yield: 28, range: [22, 34] }
    }
  },
  "Rock Sole": {
    scientific_name: "Lepidopsetta bilineata",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 84, range: [78, 90] },
      "Round → D/H-Off": { yield: 58, range: [52, 65] },
      "Round → Skinless Fillets": { yield: 30, range: [25, 36] }
    }
  },
  "Dover Sole": {
    scientific_name: "Microstomus pacificus",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 80, range: [74, 86] },
      "Round → D/H-Off": { yield: 52, range: [45, 60] },
      "Round → Skinless Fillets": { yield: 25, range: [20, 32] }
    }
  },
  "Arrowtooth Flounder": {
    scientific_name: "Atheresthes stomias",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 78, range: [72, 85] },
      "Round → D/H-Off": { yield: 50, range: [44, 58] },
      "Round → Skinless Fillets": { yield: 26, range: [20, 32] }
    }
  },
  "Pacific Hake": {
    scientific_name: "Merluccius productus",
    category: "Groundfish",
    conversions: {
      "Round → D/H-On": { yield: 78, range: [70, 85] },
      "Round → D/H-Off": { yield: 58, range: [50, 66] },
      "Round → Skinless Fillets": { yield: 32, range: [26, 40] },
      "Round → Surimi": { yield: 20, range: [15, 25] }
    }
  },
  "Pacific Ocean Perch": {
    scientific_name: "Sebastes alutus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 85, range: [78, 92] },
      "Round → D/H-Off": { yield: 55, range: [48, 62] },
      "Round → Skinless Fillets": { yield: 30, range: [24, 36] }
    }
  },
  "Yelloweye Rockfish": {
    scientific_name: "Sebastes ruberrimus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [82, 94] },
      "Round → D/H-Off": { yield: 60, range: [54, 68] },
      "Round → Skinless Fillets": { yield: 35, range: [28, 42] }
    }
  },
  "Black Rockfish": {
    scientific_name: "Sebastes melanops",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 86, range: [80, 92] },
      "Round → D/H-Off": { yield: 58, range: [52, 65] },
      "Round → Skinless Fillets": { yield: 32, range: [26, 38] }
    }
  },
  "Atka Mackerel": {
    scientific_name: "Pleurogrammus monopterygius",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 87, range: [83, 93] },
      "Round → D/H-Off": { yield: 68, range: [62, 74] },
      "Round → Skinless Fillet": { yield: 31, range: [29, 33] },
      "Round → Steaks": { yield: 57, range: null },
      "D/H-Off → Salted": { yield: 41, range: null }
    }
  },
  "Pacific Herring": {
    scientific_name: "Clupea harengus pallasi",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 82, range: [78, 87] },
      "Round → Roe": { yield: 12, range: [8, 18] },
      "Round → Pickled": { yield: 55, range: [48, 62] }
    }
  }
};

const PROFILES_DATA = {
  "Lingcod": {
    description: "The raw flesh has a blue-green tint, but turns white when cooked. Meat is tender and firm, with large, soft, moist, mild-tasting flakes.",
    culinary_uses: "Excellent for grilling, baking, or pan-frying. Its firm texture holds up well.",
    edible_portions: "Usually eaten with head and skin removed.",
    url: "https://caseagrant.ucsd.edu/seafood-profiles/lingcod"
  },
  "Pacific Halibut": {
    description: "Mild, sweet flavor with firm, dense white meat. One of the most prized fish in the Pacific.",
    culinary_uses: "Steaks and fillets can be grilled, baked, broiled, or poached. Cheeks are a delicacy.",
    edible_portions: "Steaks, fletches, and cheeks are the primary products."
  },
  "Sablefish": {
    description: "Also known as Black Cod. Rich, buttery flavor with silky texture and high oil content.",
    culinary_uses: "Excellent smoked or grilled. Used in Japanese misoyaki.",
    edible_portions: "Whole fish, steaks, and fillets. High oil content ideal for smoking."
  }
};

async function importData() {
  console.log('Starting fish data import to Neon PostgreSQL...\n');
  
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    await pool.query('SELECT NOW()');
    console.log('Connected to Neon PostgreSQL successfully!\n');
    
    let speciesCount = 0;
    let conversionCount = 0;
    let profileCount = 0;
    
    // Import species and conversions
    for (const [speciesName, data] of Object.entries(FISH_DATA_V3)) {
      try {
        // Insert or get species
        let speciesResult = await pool.query(
          'SELECT id FROM species WHERE name = $1',
          [speciesName]
        );
        
        let speciesId;
        if (speciesResult.rows.length === 0) {
          speciesResult = await pool.query(
            `INSERT INTO species (name, scientific_name, category)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [speciesName, data.scientific_name, data.category]
          );
          speciesId = speciesResult.rows[0].id;
          speciesCount++;
          console.log(`  Added species: ${speciesName}`);
        } else {
          speciesId = speciesResult.rows[0].id;
          console.log(`  Species exists: ${speciesName}`);
        }
        
        // Insert conversions
        for (const [convKey, conv] of Object.entries(data.conversions)) {
          const parts = convKey.split(' → ');
          const fromState = parts[0];
          const toState = parts[1];
          
          try {
            await pool.query(
              `INSERT INTO fish_yields (species_id, from_state, to_state, yield_percent, range_min, range_max)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (species_id, from_state, to_state) DO UPDATE
               SET yield_percent = $4, range_min = $5, range_max = $6`,
              [
                speciesId,
                fromState,
                toState,
                conv.yield,
                conv.range ? conv.range[0] : null,
                conv.range ? conv.range[1] : null
              ]
            );
            conversionCount++;
          } catch (err) {
            console.error(`    Error adding conversion ${convKey}:`, err.message);
          }
        }
      } catch (err) {
        console.error(`Error processing ${speciesName}:`, err.message);
      }
    }
    
    // Import profiles
    console.log('\n--- Importing species profiles ---');
    for (const [speciesName, profile] of Object.entries(PROFILES_DATA)) {
      try {
        const speciesResult = await pool.query(
          'SELECT id FROM species WHERE name = $1',
          [speciesName]
        );
        
        if (speciesResult.rows.length > 0) {
          const speciesId = speciesResult.rows[0].id;
          await pool.query(
            `INSERT INTO species_profiles (species_id, description, culinary_uses, edible_portions, url)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (species_id) DO UPDATE
             SET description = $2, culinary_uses = $3, edible_portions = $4, url = $5`,
            [speciesId, profile.description, profile.culinary_uses, profile.edible_portions, profile.url || null]
          );
          profileCount++;
          console.log(`  Added profile: ${speciesName}`);
        }
      } catch (err) {
        console.error(`Error adding profile for ${speciesName}:`, err.message);
      }
    }
    
    console.log('\n✅ Import completed successfully!');
    console.log(`\n--- Summary ---`);
    console.log(`Species added: ${speciesCount}`);
    console.log(`Conversions added: ${conversionCount}`);
    console.log(`Profiles added: ${profileCount}`);
    
    // Verify counts
    const speciesTotal = await pool.query('SELECT COUNT(*) FROM species');
    const yieldsTotal = await pool.query('SELECT COUNT(*) FROM fish_yields');
    const profilesTotal = await pool.query('SELECT COUNT(*) FROM species_profiles');
    
    console.log(`\n--- Database Totals ---`);
    console.log(`Total species: ${speciesTotal.rows[0].count}`);
    console.log(`Total yield conversions: ${yieldsTotal.rows[0].count}`);
    console.log(`Total profiles: ${profilesTotal.rows[0].count}`);
    
  } catch (err) {
    console.error('Import failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

importData();
