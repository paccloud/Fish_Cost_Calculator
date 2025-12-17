/**
 * Fish Data Validation Script
 * Compares fish_data_v3.js against MAB-37 PDF reference data
 *
 * Run with: node validate_fish_data.js
 */

import { FISH_DATA_V3 } from './fish_data_v3.js';
import { fileURLToPath } from 'url';
import process from 'node:process';

// ============ EXPECTED DATA FROM MAB-37 PDF ============

const EXPECTED_SPECIES = {
  // Salmon
  "Pink Salmon": true,
  "Chum Salmon": true,
  "Sockeye Salmon": true,
  "Coho Salmon": true,
  "Chinook Salmon": true,
  "Norwegian Farmed Salmon": true,
  "Chilean Farmed Salmon": true,

  // Groundfish
  "Pacific Cod": true,
  "Walleye Pollock": true,
  "Pacific Hake": true,

  // Flatfish
  "Pacific Halibut": true,
  "Arrowtooth Flounder": true,
  "Starry Flounder": true,
  "Flathead Sole": true,
  "Petrale Sole": true,
  "Dover Sole": true,
  "Rex Sole": true,
  "Rock Sole": true,
  "Yellowfin Sole": true,
  "English Sole": true,
  "Dabs": true,
  "Alaska Plaice": true,
  "Greenland Turbot": true,

  // Rockfish (all 17)
  "Black Rockfish": true,
  "Greenstriped Rockfish": true,
  "Thornyhead Rockfish": true,
  "Canary Rockfish": true,
  "China Rockfish": true,
  "Dusky Rockfish": true,
  "Quillback Rockfish": true,
  "Redbanded Rockfish": true,
  "Redstriped Rockfish": true,  // Missing
  "Rosethorn Rockfish": true,   // Missing
  "Rougheye Rockfish": true,
  "Shortraker Rockfish": true,
  "Silvergray Rockfish": true,
  "Tiger Rockfish": true,
  "Widow Rockfish": true,
  "Yelloweye Rockfish": true,
  "Yellowtail Rockfish": true,
  "Pacific Ocean Perch": true,

  // Sharks
  "Salmon Shark": true,
  "Sevengill Shark": true,
  "Soupfin Shark": true,
  "Blue Shark": true,
  "Thresher Shark": true,
  "Blacktip Shark": true,
  "Spiny Dogfish": true,
  "Sharks General": true,  // Composite data

  // Other Fish
  "Sablefish": true,
  "Lingcod": true,
  "Atka Mackerel": true,
  "Pacific Herring": true,
  "Pacific Lamprey": true,
  "Pacific Saury": true,
  "Capelin": true,
  "Smelt": true,
  "Albacore Tuna": true,
  "Sturgeon": true,
  "Trout": true,
  "Norwegian Farmed Trout": true,  // Missing
  "American Shad": true,
  "Eels": true,
  "Rat-Tails": true,
  "Skates": true,
  "Sculpin": true,

  // Shellfish
  "Dungeness Crab": true,
  "King Crab (Red/Brown/Golden)": true,
  "Blue King Crab": true,
  "Tanner Crab": true,
  "Pink Shrimp": true,
  "Spot Shrimp": true,
  "Softshell Clams": true,
  "Macoma Clams": true,
  "Cockles": true,
  "Littleneck Clams": true,
  "Geoduck Clams": true,
  "Razor Clams": true,
  "Butter Clams": true,
  "Mussels": true,
  "Oysters": true,
  "Scallops": true,
  "Snails": true,
  "Abalone (Pinto)": true,
  "Squid": true,
  "Octopus": true,
  "Sea Cucumber": true,
  "Sea Urchin (Green)": true,
  "Sea Urchin (Red)": true,
};

// Expected conversions that should exist for key species
const EXPECTED_CONVERSIONS = {
  "Pacific Cod": [
    "Round → D/H-On",
    "Round → D/H-Off",
    "Round → Skin-On Fillets (V-cut)",
    "Round → Skinless Fillets (V-cut)",
    "Round → SIB Fillets (V-cut)",
    "Round → Skin-On Fillets",
    "Round → Skinless Fillets (J-cut)",
    "Round → SIB Fillets (J-cut)",
    "Round → Steaks",
    "Round → Salted D/H-Off",
    "Round → Smoked D/H-Off",
    "Round → Belly Flaps",
    "Round → Liver",
    "Round → Roe",
    "D/H-On → D/H-Off",
    "D/H-On → Skin-On Fillets",
    "D/H-On → Skinless Fillets",
    "D/H-On → SIB Fillets",
    "D/H-Off → Skin-On Fillets",
    "D/H-Off → Skinless Fillets",
    "D/H-Off → SIB Fillets",
    "D/H-Off → Smoked",
    "Skin-On Fillets → Skinless Fillets",
    "Skin-On Fillets → Trim",
    "Skin-On Fillets → SIB Fillets",
    "Skinless Fillets → SIB Fillets",
    "Skinless Fillets → Trim",
    "Trim → Mince",
  ],

  "Pink Salmon": [
    "Round → D/H-On",
    "Round → D/H-Off",
    "Round → Canned",
    "Round → Skin-On Fillet (Hand)",
    "Round → Skin-On Fillet (Machine)",
    "Round → Skinless Fillet",
    "Round → SIB Fillet (V-Cut)",
    "Round → SIB Fillet (Pinboning)",
    "Round → SIB Trim",
    "Round → Steaks",
    "Round → Dry-Salt Sides",
    "Round → Mild Cure Sides",
    "Round → Smoked Sides",
    "Round → Roe",
    "D/H-On → D/H-Off",
    "D/H-On → Skin-On Fillet (Hand)",
    "D/H-On → Skin-On Fillet (Machine)",
    "D/H-On → Skinless Fillet",
    "D/H-On → SIB Fillet (V-Cut)",
    "D/H-On → SIB Fillet (Pinboning)",
    "D/H-On → SIB Trim",
    "D/H-On → Steaks",
    "D/H-On → Dry-Salt Sides",
    "D/H-On → Mild Cure Sides",
    "D/H-On → Smoked Sides",
    "D/H-Off → Skin-On Fillet (Hand)",
    "D/H-Off → Skin-On Fillet (Machine)",
    "D/H-Off → Skinless Fillet",
    "D/H-Off → SIB Fillet (V-Cut)",
    "D/H-Off → SIB Fillet (Pinboning)",
    "D/H-Off → SIB Trim",
    "D/H-Off → Steaks",
    "D/H-Off → Dry-Salt Sides",
    "D/H-Off → Mild Cure Sides",
    "D/H-Off → Smoked Sides",
    // Thawed conversions
    "D/H-On (Thawed) → Skin-On Fillet",
    "D/H-On (Thawed) → Skinless Fillet",
    "D/H-Off (Thawed) → Skin-On Fillet",
    "D/H-Off (Thawed) → Skinless Fillet",
  ],

  "Chum Salmon": [
    "Round → D/H-On",
    "Round → D/H-Off",
    "Round → Canned",
    "Round → Skin-On Fillet (Hand)",
    "Round → Skin-On Fillet (Machine)",
    "Round → Skinless Fillet",
    "Round → SIB Fillet (V-Cut)",
    "Round → SIB Fillet (Pinboning)",
    "Round → SIB Trim",
    "Round → Steaks",
    "Round → Dry-Salt Sides",
    "Round → Mild Cure Sides",
    "Round → Smoked Sides",
    "Round → Roe",
    "D/H-On → D/H-Off",
    "D/H-On → Skin-On Fillet (Hand)",
    "D/H-On → Skin-On Fillet (Machine)",
    "D/H-On → Skinless Fillet",
    "D/H-On → SIB Fillet (V-Cut)",
    "D/H-On → SIB Fillet (Pinboning)",
    "D/H-On → SIB Trim",
    "D/H-On → Steaks",
    "D/H-On → Dry-Salt Sides",
    "D/H-On → Mild Cure Sides",
    "D/H-On → Smoked Sides",
    "D/H-Off → Skin-On Fillet (Hand)",
    "D/H-Off → Skin-On Fillet (Machine)",
    "D/H-Off → Skinless Fillet",
    "D/H-Off → SIB Fillet (V-Cut)",
    "D/H-Off → SIB Fillet (Pinboning)",
    "D/H-Off → SIB Trim",
    "D/H-Off → Steaks",
    "D/H-Off → Dry-Salt Sides",
    "D/H-Off → Salted D/H-Off",
    "D/H-Off → Smoked Sides",
  ],

  "Pacific Halibut": [
    "Round → D/H-On",
    "Round → D/H-Off",
    "Round → Steaks",
    "Round → Skin-On Fillet",
    "Round → Skinless Fillet (Fletch)",
    "D/H-On → D/H-Off",
    "D/H-On → Steaks",
    "D/H-On → Skin-On Fillet",
    "D/H-On → Skinless Fillet (Fletch)",
    "D/H-Off → Skin-On Fillet",
    "D/H-Off → Skinless Fillet (Fletch)",
    "D/H-Off → Steaks",
    "D/H-Off → Roasts",
  ],

  "Lingcod": [
    "Round → D/H-On",
    "Round → D/H-Off",
    "Round → Skinless Fillet",
    "Round → Steaks",
    "D/H-On → D/H-Off",
    "D/H-On → Skinless Fillet",
    "D/H-On → Steaks",
    "D/H-Off → Skinless Fillet",
    "D/H-Off → Steaks",
  ],
};

// ============ VALIDATION FUNCTIONS ============

function checkMissingSpecies() {
  const missing = [];
  const current = Object.keys(FISH_DATA_V3);

  for (const species of Object.keys(EXPECTED_SPECIES)) {
    if (!current.includes(species)) {
      missing.push(species);
    }
  }

  return missing;
}

function checkMissingConversions(species) {
  if (!FISH_DATA_V3[species]) {
    return { species, exists: false, missing: [] };
  }

  const rawConversions = FISH_DATA_V3[species].conversions;
  const conversions =
    rawConversions && typeof rawConversions === 'object' && !Array.isArray(rawConversions)
      ? rawConversions
      : {};
  const currentConversions = Object.keys(conversions);
  const expectedConversions = EXPECTED_CONVERSIONS[species] || [];

  const missing = expectedConversions.filter(conv => !currentConversions.includes(conv));

  return {
    species,
    exists: true,
    currentCount: currentConversions.length,
    expectedCount: expectedConversions.length,
    missing,
  };
}

function validateYieldChain(species, chain) {
  // chain is array like ["Round", "D/H-On", "D/H-Off"]
  // Validates that compound conversion equals direct conversion
  if (!FISH_DATA_V3[species]) return null;

  const conversions = FISH_DATA_V3[species].conversions;
  let compoundYield = 100;

  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const to = chain[i + 1];
    const key = `${from} → ${to}`;

    if (!conversions[key]) {
      return { valid: null, message: `Missing conversion: ${key}` };
    }

    compoundYield = compoundYield * (conversions[key].yield / 100);
  }

  // Check direct conversion
  const directKey = `${chain[0]} → ${chain[chain.length - 1]}`;
  if (!conversions[directKey]) {
    return { valid: null, message: `No direct conversion for comparison: ${directKey}` };
  }

  const directYield = conversions[directKey].yield;
  const difference = Math.abs(compoundYield - directYield);
  const tolerance = 2; // 2% tolerance

  return {
    valid: difference <= tolerance,
    compound: compoundYield.toFixed(1),
    direct: directYield,
    difference: difference.toFixed(1),
    chain: chain.join(" → "),
    directKey,
  };
}

function validateSchema(species) {
  const data = FISH_DATA_V3[species];
  const errors = [];

  if (!data) {
    return [`Species "${species}" not found in FISH_DATA_V3`];
  }

  if (!data.scientific_name) {
    errors.push("Missing scientific_name");
  }

  if (!data.category) {
    errors.push("Missing category");
  }

  if (!data.conversions || typeof data.conversions !== 'object') {
    errors.push("Missing or invalid conversions object");
  }

  // Check each conversion
  for (const [key, conv] of Object.entries(data.conversions || {})) {
    if (typeof conv.yield !== 'number') {
      errors.push(`${key}: yield is not a number`);
    }

    if (conv.range !== null && !Array.isArray(conv.range)) {
      errors.push(`${key}: range should be array or null`);
    }

    if (Array.isArray(conv.range)) {
      if (conv.range.length !== 2) {
        errors.push(`${key}: range should have exactly 2 values`);
      }
      if (conv.yield < conv.range[0] || conv.yield > conv.range[1]) {
        errors.push(`${key}: yield ${conv.yield} outside range [${conv.range[0]}, ${conv.range[1]}]`);
      }
    }
  }

  return errors;
}

// ============ MAIN VALIDATION ============

function runValidation() {
  console.log("=".repeat(60));
  console.log("FISH DATA VALIDATION REPORT");
  console.log("=".repeat(60));
  console.log("");

  // 1. Check missing species
  console.log("1. MISSING SPECIES");
  console.log("-".repeat(40));
  const missingSpecies = checkMissingSpecies();
  if (missingSpecies.length === 0) {
    console.log("   All expected species present!");
  } else {
    console.log(`   Found ${missingSpecies.length} missing species:`);
    missingSpecies.forEach(s => console.log(`   - ${s}`));
  }
  console.log("");

  // 2. Check missing conversions for key species
  console.log("2. MISSING CONVERSIONS");
  console.log("-".repeat(40));
  for (const species of Object.keys(EXPECTED_CONVERSIONS)) {
    const result = checkMissingConversions(species);
    if (!result.exists) {
      console.log(`   ${species}: SPECIES NOT FOUND`);
    } else if (result.missing.length > 0) {
      console.log(`   ${species}: ${result.missing.length} missing conversions`);
      result.missing.forEach(c => console.log(`      - ${c}`));
    } else {
      console.log(`   ${species}: All conversions present (${result.currentCount})`);
    }
  }
  console.log("");

  // 3. Validate yield chains
  console.log("3. YIELD CHAIN VALIDATION");
  console.log("-".repeat(40));
  const chains = [
    { species: "Pink Salmon", chain: ["Round", "D/H-On", "D/H-Off"] },
    { species: "Pacific Cod", chain: ["Round", "D/H-On", "D/H-Off"] },
    { species: "Pacific Halibut", chain: ["Round", "D/H-On", "D/H-Off"] },
  ];

  for (const { species, chain } of chains) {
    const result = validateYieldChain(species, chain);
    if (result === null) {
      console.log(`   ${species}: Species not found`);
    } else if (result.valid === null) {
      console.log(`   ${species}: ${result.message}`);
    } else if (result.valid) {
      console.log(`   ${species}: ${result.chain} = ${result.compound}% (direct: ${result.direct}%) OK`);
    } else {
      console.log(`   ${species}: ${result.chain} = ${result.compound}% vs direct ${result.direct}% MISMATCH (${result.difference}%)`);
    }
  }
  console.log("");

  // 4. Schema validation
  console.log("4. SCHEMA VALIDATION");
  console.log("-".repeat(40));
  let schemaErrors = 0;
  for (const species of Object.keys(FISH_DATA_V3)) {
    const errors = validateSchema(species);
    if (errors.length > 0) {
      console.log(`   ${species}: ${errors.length} errors`);
      errors.forEach(e => console.log(`      - ${e}`));
      schemaErrors += errors.length;
    }
  }
  if (schemaErrors === 0) {
    console.log("   All species pass schema validation!");
  }
  console.log("");

  // Summary
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total species in data: ${Object.keys(FISH_DATA_V3).length}`);
  console.log(`Expected species: ${Object.keys(EXPECTED_SPECIES).length}`);
  console.log(`Missing species: ${missingSpecies.length}`);
  console.log(`Schema errors: ${schemaErrors}`);
  console.log("");
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runValidation();
}

export {
  checkMissingSpecies,
  checkMissingConversions,
  validateYieldChain,
  validateSchema,
  EXPECTED_SPECIES,
  EXPECTED_CONVERSIONS,
};
