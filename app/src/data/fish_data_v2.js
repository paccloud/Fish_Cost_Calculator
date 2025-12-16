/**
 * Fish Yield Data - Corrected from MAB-37 PDF
 * "Recoveries and Yields from Pacific Fish and Shellfish"
 * Alaska Sea Grant College Program, 2004
 * 
 * Data Structure:
 * - scientific_name: Latin name of species
 * - conversions: Object keyed by "From → To" with yield, range, from, to
 */

// Acronym tooltips for UI
export const ACRONYMS = {
  "D/H-On": "Dressed/Head-On - Fish that has been gutted but head is still attached",
  "D/H-Off": "Dressed/Head-Off - Fish that has been gutted and head removed",
  "S/B": "Skinless/Boneless - Fillet with skin and bones removed",
  "SIB": "Skinless/Boneless - Fillet with skin and bones removed",
  "Round": "Whole fish as caught, before any processing",
  "Fillet": "Side of fish removed from backbone",
  "Fletch": "Large fillet from halibut or similar flatfish",
  "V-cut": "Fillet with belly bones removed in a V shape",
  "J-cut": "Fillet with angled cut to remove bones",
  "Steaks": "Cross-section cuts through the fish including backbone",
  "Smoked": "Cured and smoked product",
  "Roe": "Fish eggs",
  "Mince": "Ground fish meat",
  "Surimi": "Processed fish paste used for imitation crab etc.",
  "Kurimi": "Similar to surimi, processed fish paste"
};

// Helper to calculate default from range
const getDefaultYield = (avg, rangeMin, rangeMax) => ({
  yield: avg,
  range: rangeMin && rangeMax ? [rangeMin, rangeMax] : null,
  rangeMin: rangeMin || null,
  rangeMax: rangeMax || null
});

export const FISH_DATA_V2 = {
  // ========== SALMON ==========
  "Pink Salmon": {
    scientific_name: "Oncorhynchus gorbuscha",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 91, range: [84, 94], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 73, range: [68, 80], from: "Round", to: "D/H-Off" },
      "Round → Canned": { yield: 65, range: [58, 67], from: "Round", to: "Canned" },
      "Round → Skin-On Fillet (Hand)": { yield: 52, range: [47, 58], from: "Round", to: "Skin-On Fillet (Hand)" },
      "Round → Skin-On Fillet (Machine)": { yield: 50, range: [45, 55], from: "Round", to: "Skin-On Fillet (Machine)" },
      "Round → Skinless Fillet": { yield: 42, range: [41, 46], from: "Round", to: "Skinless Fillet" },
      "Round → SIB Fillet (Hand-V-Cut)": { yield: 33, range: [30, 36], from: "Round", to: "SIB Fillet (Hand-V-Cut)" },
      "Round → SIB Fillet (Pinboning)": { yield: 41, range: [40, 44], from: "Round", to: "SIB Fillet (Pinboning)" },
      "Round → SIB Trim": { yield: 14, range: [12, 16], from: "Round", to: "SIB Trim" },
      "Round → Steaks": { yield: 58, range: [53, 65], from: "Round", to: "Steaks" },
      "Round → Dry-Salt Sides": { yield: 36, range: null, from: "Round", to: "Dry-Salt Sides" },
      "Round → Mild Cure Sides": { yield: 30, range: null, from: "Round", to: "Mild Cure Sides" },
      "Round → Smoked Sides": { yield: 30, range: null, from: "Round", to: "Smoked Sides" },
      "Round → Roe": { yield: 6, range: [3, 10], from: "Round", to: "Roe" },
      "D/H-On → D/H-Off": { yield: 81, range: [72, 90], from: "D/H-On", to: "D/H-Off" },
      "D/H-On → Skin-On Fillet (Hand)": { yield: 57, range: [50, 64], from: "D/H-On", to: "Skin-On Fillet (Hand)" },
      "D/H-On → Skin-On Fillet (Machine)": { yield: 55, range: [48, 61], from: "D/H-On", to: "Skin-On Fillet (Machine)" },
      "D/H-On → Skinless Fillet": { yield: 46, range: [43, 55], from: "D/H-On", to: "Skinless Fillet" },
      "D/H-Off → Skin-On Fillet (Hand)": { yield: 74, range: null, from: "D/H-Off", to: "Skin-On Fillet (Hand)" },
      "D/H-Off → Skinless Fillet": { yield: 58, range: null, from: "D/H-Off", to: "Skinless Fillet" },
      "D/H-Off → Smoked Sides": { yield: 41, range: [35, 50], from: "D/H-Off", to: "Smoked Sides" },
    }
  },

  "Chum Salmon": {
    scientific_name: "Oncorhynchus keta",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 89, range: [79, 91], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 74, range: [71, 77], from: "Round", to: "D/H-Off" },
      "Round → Canned": { yield: 67, range: [60, 70], from: "Round", to: "Canned" },
      "Round → Skin-On Fillet (Hand)": { yield: 60, range: [55, 63], from: "Round", to: "Skin-On Fillet (Hand)" },
      "Round → Skin-On Fillet (Machine)": { yield: 57, range: [52, 59], from: "Round", to: "Skin-On Fillet (Machine)" },
      "Round → Skinless Fillet": { yield: 50, range: [45, 53], from: "Round", to: "Skinless Fillet" },
      "Round → SIB Fillet (Hand-V-Cut)": { yield: 36, range: [30, 36], from: "Round", to: "SIB Fillet (Hand-V-Cut)" },
      "Round → SIB Fillet (Pinboning)": { yield: 48, range: [43, 51], from: "Round", to: "SIB Fillet (Pinboning)" },
      "Round → SIB Trim": { yield: 15, range: [12, 16], from: "Round", to: "SIB Trim" },
      "Round → Steaks": { yield: 58, range: [55, 65], from: "Round", to: "Steaks" },
      "Round → Roe": { yield: 8, range: [4, 10], from: "Round", to: "Roe" },
      "D/H-On → D/H-Off": { yield: 83, range: [79, 91], from: "D/H-On", to: "D/H-Off" },
      "D/H-On → Skin-On Fillet (Hand)": { yield: 67, range: [61, 74], from: "D/H-On", to: "Skin-On Fillet (Hand)" },
      "D/H-Off → Smoked Sides": { yield: 55, range: [45, 60], from: "D/H-Off", to: "Smoked Sides" },
    }
  },

  "Sockeye Salmon": {
    scientific_name: "Oncorhynchus nerka",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 92, range: [85, 94], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 74, range: [66, 82], from: "Round", to: "D/H-Off" },
      "Round → Canned": { yield: 67, range: [60, 70], from: "Round", to: "Canned" },
      "Round → Skin-On Fillet (Hand)": { yield: 53, range: [50, 59], from: "Round", to: "Skin-On Fillet (Hand)" },
      "Round → Skin-On Fillet (Machine)": { yield: 51, range: [48, 56], from: "Round", to: "Skin-On Fillet (Machine)" },
      "Round → Skinless Fillet": { yield: 46, range: [41, 49], from: "Round", to: "Skinless Fillet" },
      "Round → SIB Fillet (Hand-V-Cut)": { yield: 35, range: [30, 38], from: "Round", to: "SIB Fillet (Hand-V-Cut)" },
      "Round → SIB Fillet (Pinboning)": { yield: 45, range: [40, 48], from: "Round", to: "SIB Fillet (Pinboning)" },
      "Round → Steaks": { yield: 57, range: [55, 65], from: "Round", to: "Steaks" },
      "Round → Roe": { yield: 4, range: [3, 6], from: "Round", to: "Roe" },
      "D/H-On → D/H-Off": { yield: 80, range: [70, 94], from: "D/H-On", to: "D/H-Off" },
      "D/H-Off → Smoked Sides": { yield: 45, range: [35, 60], from: "D/H-Off", to: "Smoked Sides" },
    }
  },

  "Coho Salmon": {
    scientific_name: "Oncorhynchus kisutch",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 92, range: [87, 94], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 75, range: [70, 83], from: "Round", to: "D/H-Off" },
      "Round → Canned": { yield: 67, range: [60, 70], from: "Round", to: "Canned" },
      "Round → Skin-On Fillet (Hand)": { yield: 57, range: [52, 60], from: "Round", to: "Skin-On Fillet (Hand)" },
      "Round → Skin-On Fillet (Machine)": { yield: 55, range: [50, 57], from: "Round", to: "Skin-On Fillet (Machine)" },
      "Round → Skinless Fillet": { yield: 51, range: [46, 56], from: "Round", to: "Skinless Fillet" },
      "Round → SIB Fillet (Hand-V-Cut)": { yield: 38, range: [30, 40], from: "Round", to: "SIB Fillet (Hand-V-Cut)" },
      "Round → SIB Fillet (Pinboning)": { yield: 49, range: [44, 54], from: "Round", to: "SIB Fillet (Pinboning)" },
      "Round → Steaks": { yield: 62, range: [58, 65], from: "Round", to: "Steaks" },
      "Round → Roe": { yield: 7, range: [5, 10], from: "Round", to: "Roe" },
      "D/H-On → D/H-Off": { yield: 82, range: [76, 92], from: "D/H-On", to: "D/H-Off" },
      "D/H-Off → Smoked Sides": { yield: 48, range: [40, 60], from: "D/H-Off", to: "Smoked Sides" },
    }
  },

  "Chinook Salmon": {
    scientific_name: "Oncorhynchus tshawytscha",
    category: "Salmon",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [82, 94], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 72, range: [68, 74], from: "Round", to: "D/H-Off" },
      "Round → Skin-On Fillet (Hand)": { yield: 55, range: [52, 60], from: "Round", to: "Skin-On Fillet (Hand)" },
      "Round → Skinless Fillet": { yield: 46, range: [41, 49], from: "Round", to: "Skinless Fillet" },
      "Round → SIB Fillet (Hand-V-Cut)": { yield: 36, range: [30, 40], from: "Round", to: "SIB Fillet (Hand-V-Cut)" },
      "Round → SIB Fillet (Pinboning)": { yield: 45, range: [40, 48], from: "Round", to: "SIB Fillet (Pinboning)" },
      "Round → Steaks": { yield: 58, range: [54, 65], from: "Round", to: "Steaks" },
      "Round → Roe": { yield: 6, range: [3, 10], from: "Round", to: "Roe" },
      "D/H-On → D/H-Off": { yield: 82, range: [73, 90], from: "D/H-On", to: "D/H-Off" },
      "D/H-Off → Smoked Sides": { yield: 47, range: [35, 60], from: "D/H-Off", to: "Smoked Sides" },
    }
  },

  // ========== COD & GROUNDFISH ==========
  "Pacific Cod": {
    scientific_name: "Gadus macrocephalus",
    category: "Groundfish",
    conversions: {
      "Round → D/H-On": { yield: 81, range: [72, 90], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 63, range: [56, 75], from: "Round", to: "D/H-Off" },
      "Round → Skin-On Fillets (V-cut)": { yield: 45, range: [38, 48], from: "Round", to: "Skin-On Fillets (V-cut)" },
      "Round → Skinless Fillets (V-cut)": { yield: 39, range: [22, 45], from: "Round", to: "Skinless Fillets (V-cut)" },
      "Round → SIB Fillets (V-cut)": { yield: 33, range: [18, 39], from: "Round", to: "SIB Fillets (V-cut)" },
      "Round → Steaks": { yield: 62, range: null, from: "Round", to: "Steaks" },
      "D/H-On → D/H-Off": { yield: 78, range: null, from: "D/H-On", to: "D/H-Off" },
      "D/H-Off → Skin-On Fillets": { yield: 71, range: [54, 80], from: "D/H-Off", to: "Skin-On Fillets" },
      "D/H-Off → Skinless Fillets": { yield: 62, range: [31, 81], from: "D/H-Off", to: "Skinless Fillets" },
      "D/H-Off → Smoked": { yield: 58, range: [50, 65], from: "D/H-Off", to: "Smoked" },
    }
  },

  "Walleye Pollock": {
    scientific_name: "Theragra chalcogramma",
    category: "Groundfish",
    conversions: {
      "Round → D/H-On": { yield: 79, range: [72, 86], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 62, range: [52, 72], from: "Round", to: "D/H-Off" },
      "Round → Skin-On Fillets": { yield: 40, range: [35, 55], from: "Round", to: "Skin-On Fillets" },
      "Round → Skinless Fillets": { yield: 34, range: [29, 43], from: "Round", to: "Skinless Fillets" },
      "Round → SIB Fillets": { yield: 28, range: [24, 36], from: "Round", to: "SIB Fillets" },
      "Round → Mince": { yield: 50, range: [30, 60], from: "Round", to: "Mince" },
      "Round → Surimi (Traditional)": { yield: 20, range: [15, 22], from: "Round", to: "Surimi (Traditional)" },
      "Round → Surimi (Decanter)": { yield: 27, range: [26, 32], from: "Round", to: "Surimi (Decanter)" },
      "Round → Roe": { yield: 6.5, range: [3, 20], from: "Round", to: "Roe" },
    }
  },

  // ========== HALIBUT & FLATFISH ==========
  "Pacific Halibut": {
    scientific_name: "Hippoglossus stenolepis",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 92], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 72, range: [68, 80], from: "Round", to: "D/H-Off" },
      "Round → Steaks": { yield: 62, range: [60, 75], from: "Round", to: "Steaks" },
      "Round → Skin-On Fillet": { yield: 49, range: [45, 56], from: "Round", to: "Skin-On Fillet" },
      "Round → Skinless Fillet (Fletch)": { yield: 41, range: [34, 44], from: "Round", to: "Skinless Fillet (Fletch)" },
      "D/H-On → D/H-Off": { yield: 83, range: [73, 94], from: "D/H-On", to: "D/H-Off" },
      "D/H-On → Steaks": { yield: 76, range: [71, 88], from: "D/H-On", to: "Steaks" },
      "D/H-On → Skin-On Fillet": { yield: 56, range: [47, 64], from: "D/H-On", to: "Skin-On Fillet" },
      "D/H-Off → Skin-On Fillet": { yield: 68, range: [64, 73], from: "D/H-Off", to: "Skin-On Fillet" },
      "D/H-Off → Skinless Fillet (Fletch)": { yield: 56, range: [45, 60], from: "D/H-Off", to: "Skinless Fillet (Fletch)" },
      "D/H-Off → Steaks": { yield: 79, range: [70, 94], from: "D/H-Off", to: "Steaks" },
      "D/H-Off → Roasts": { yield: 84, range: null, from: "D/H-Off", to: "Roasts" },
    }
  },

  "Flathead Sole": {
    scientific_name: "Hippoglossoides elassodon",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 86, range: [80, 94], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 67, range: [60, 79], from: "Round", to: "D/H-Off" },
      "Round → Skinless Fillet": { yield: 27, range: [25, 32], from: "Round", to: "Skinless Fillet" },
    }
  },

  "Petrale Sole": {
    scientific_name: "Eopsetta jordani",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 86, range: [75, 90], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 66, range: [55, 75], from: "Round", to: "D/H-Off" },
      "Round → Skinless Fillet": { yield: 29, range: [28, 32], from: "Round", to: "Skinless Fillet" },
    }
  },

  "Dover Sole": {
    scientific_name: "Microstomus pacificus",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 86, range: [75, 90], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 65, range: [55, 65], from: "Round", to: "D/H-Off" },
      "Round → Skinless Fillet": { yield: 29, range: [26, 32], from: "Round", to: "Skinless Fillet" },
    }
  },

  "Rex Sole": {
    scientific_name: "Glyptocephalus zachirus",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 85, range: [75, 90], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 65, range: [55, 75], from: "Round", to: "D/H-Off" },
      "Round → Skinless Fillet": { yield: 33, range: [27, 37], from: "Round", to: "Skinless Fillet" },
    }
  },

  // ========== CRAB ==========
  "Dungeness Crab": {
    scientific_name: "Cancer magister",
    category: "Crab",
    conversions: {
      "Raw Whole → Raw Sections": { yield: 60, range: null, from: "Raw Whole", to: "Raw Sections" },
      "Raw Whole → Cooked Whole": { yield: 90, range: null, from: "Raw Whole", to: "Cooked Whole" },
      "Raw Whole → Cooked Sections": { yield: 52, range: null, from: "Raw Whole", to: "Cooked Sections" },
      "Raw Whole → Cooked Meat": { yield: 24, range: [22, 25], from: "Raw Whole", to: "Cooked Meat" },
      "Raw Sections → Cooked Sections": { yield: 87, range: null, from: "Raw Sections", to: "Cooked Sections" },
      "Cooked Whole → Cooked Meat": { yield: 27, range: null, from: "Cooked Whole", to: "Cooked Meat" },
      "Cooked Sections → Cooked Meat": { yield: 46, range: null, from: "Cooked Sections", to: "Cooked Meat" },
    }
  },

  "King Crab (Red/Brown/Golden)": {
    scientific_name: "Paralithodes camtschatica / Lithodes aequispina",
    category: "Crab",
    conversions: {
      "Raw Whole → Raw Sections": { yield: 69, range: [67, 74], from: "Raw Whole", to: "Raw Sections" },
      "Raw Whole → Cooked Whole": { yield: 92, range: [90, 95], from: "Raw Whole", to: "Cooked Whole" },
      "Raw Whole → Cooked Sections": { yield: 60, range: [52, 67], from: "Raw Whole", to: "Cooked Sections" },
      "Raw Whole → Cooked Meat": { yield: 25, range: [23, 28], from: "Raw Whole", to: "Cooked Meat" },
      "Cooked Whole → Cooked Meat": { yield: 27, range: null, from: "Cooked Whole", to: "Cooked Meat" },
      "Cooked Sections → Cooked Meat": { yield: 42, range: null, from: "Cooked Sections", to: "Cooked Meat" },
    }
  },

  "Tanner Crab": {
    scientific_name: "Chionoecetes bairdi / C. opilio",
    category: "Crab",
    conversions: {
      "Raw Whole → Raw Sections": { yield: 68, range: [65, 72], from: "Raw Whole", to: "Raw Sections" },
      "Raw Whole → Cooked Whole": { yield: 92, range: [90, 95], from: "Raw Whole", to: "Cooked Whole" },
      "Raw Whole → Cooked Sections": { yield: 60, range: [58, 66], from: "Raw Whole", to: "Cooked Sections" },
      "Raw Whole → Cooked Meat": { yield: 17, range: [15, 21], from: "Raw Whole", to: "Cooked Meat" },
      "Cooked Whole → Cooked Meat": { yield: 19, range: null, from: "Cooked Whole", to: "Cooked Meat" },
      "Cooked Sections → Cooked Meat": { yield: 28, range: null, from: "Cooked Sections", to: "Cooked Meat" },
    }
  },

  // ========== SABLEFISH & OTHER ==========
  "Sablefish": {
    scientific_name: "Anoplopoma fimbria",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 89, range: [86, 94], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 68, range: [67, 71], from: "Round", to: "D/H-Off" },
      "Round → Skin-On Fillet": { yield: 40, range: [38, 46], from: "Round", to: "Skin-On Fillet" },
      "Round → Skinless Fillet": { yield: 35, range: null, from: "Round", to: "Skinless Fillet" },
      "Round → Steaks": { yield: 62, range: [60, 65], from: "Round", to: "Steaks" },
      "D/H-Off → Skin-On Fillet": { yield: 59, range: null, from: "D/H-Off", to: "Skin-On Fillet" },
      "D/H-Off → Smoked Sides": { yield: 45, range: [40, 49], from: "D/H-Off", to: "Smoked Sides" },
    }
  },

  "Lingcod": {
    scientific_name: "Ophiodon elongatus",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 90, range: [83, 93], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 70, range: [62, 74], from: "Round", to: "D/H-Off" },
      "Round → Skinless Fillet": { yield: 35, range: [29, 38], from: "Round", to: "Skinless Fillet" },
      "Round → Steaks": { yield: 62, range: null, from: "Round", to: "Steaks" },
      "D/H-On → D/H-Off": { yield: 80, range: [67, 89], from: "D/H-On", to: "D/H-Off" },
      "D/H-On → Skinless Fillet": { yield: 39, range: [31, 45], from: "D/H-On", to: "Skinless Fillet" },
      "D/H-Off → Skinless Fillets": { yield: 49, range: null, from: "D/H-Off", to: "Skinless Fillets" },
      "D/H-Off → Steaks": { yield: 86, range: null, from: "D/H-Off", to: "Steaks" },
    }
  },

  "Pacific Ocean Perch": {
    scientific_name: "Sebastes alutus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [82, 94], from: "Round", to: "D/H-On" },
      "Round → D/H-Off": { yield: 62, range: [46, 72], from: "Round", to: "D/H-Off" },
      "Round → Skinless Fillet": { yield: 30, range: [27, 32], from: "Round", to: "Skinless Fillet" },
      "D/H-On → D/H-Off": { yield: 71, range: null, from: "D/H-On", to: "D/H-Off" },
      "D/H-On → Skinless Fillet": { yield: 35, range: null, from: "D/H-On", to: "Skinless Fillet" },
    }
  },

  // ========== SHRIMP ==========
  "Pink Shrimp": {
    scientific_name: "Pandalus sp.",
    category: "Shrimp",
    conversions: {
      "Raw Whole → Raw Headless": { yield: 53, range: null, from: "Raw Whole", to: "Raw Headless" },
      "Raw Whole → Cooked Whole": { yield: 90, range: null, from: "Raw Whole", to: "Cooked Whole" },
      "Raw Whole → Raw Peeled": { yield: 36, range: null, from: "Raw Whole", to: "Raw Peeled" },
      "Raw Whole → Cooked Peeled": { yield: 25, range: null, from: "Raw Whole", to: "Cooked Peeled" },
      "Raw Headless → Cooked Peeled": { yield: 69, range: null, from: "Raw Headless", to: "Cooked Peeled" },
      "Cooked Whole → Cooked Peeled": { yield: 28, range: null, from: "Cooked Whole", to: "Cooked Peeled" },
    }
  },

  "Spot Shrimp": {
    scientific_name: "Pandalus platyceros",
    category: "Shrimp",
    conversions: {
      "Raw Whole → Raw Headless": { yield: 47, range: [45, 49], from: "Raw Whole", to: "Raw Headless" },
      "Raw Whole → Cooked Whole": { yield: 90, range: null, from: "Raw Whole", to: "Cooked Whole" },
      "Raw Whole → Raw Peeled": { yield: 34, range: [30, 38], from: "Raw Whole", to: "Raw Peeled" },
      "Raw Whole → Cooked Peeled": { yield: 26, range: null, from: "Raw Whole", to: "Cooked Peeled" },
      "Raw Headless → Raw Peeled": { yield: 72, range: null, from: "Raw Headless", to: "Raw Peeled" },
      "Cooked Whole → Cooked Peeled": { yield: 29, range: null, from: "Cooked Whole", to: "Cooked Peeled" },
    }
  },
};

// Legacy format for backward compatibility
export const FISH_DATA = {};
Object.entries(FISH_DATA_V2).forEach(([species, data]) => {
  FISH_DATA[species] = {};
  Object.entries(data.conversions).forEach(([convKey, conv]) => {
    // Use the "to" product as the key for legacy format
    const productName = conv.to;
    const fromLabel = conv.from !== "Round" && conv.from !== "Raw Whole" ? `From ${conv.from}: ` : "";
    const label = `${fromLabel}${productName}`;
    FISH_DATA[species][label] = {
      yield: String(conv.yield),
      range: conv.range ? `${conv.range[0]}-${conv.range[1]}` : null,
      from: conv.from,
      to: conv.to,
      scientificName: data.scientific_name
    };
  });
});

export const PROFILES_DATA = {
  "Lingcod": {
    description: "The raw flesh has a blue-green tint, but turns white when cooked. Meat is tender and firm, with large, soft, moist, mild-tasting flakes.",
    culinary_uses: "Excellent for grilling, baking, or pan-frying. Its firm texture holds up well to various cooking methods.",
    edible_portions: "Usually eaten with head and skin removed.",
    url: "https://caseagrant.ucsd.edu/seafood-profiles/lingcod"
  },
  "Pacific Halibut": {
    description: "Mild, sweet flavor with firm, dense white meat. One of the most prized fish in the Pacific.",
    culinary_uses: "Steaks and fillets can be grilled, baked, broiled, or poached. Cheeks are a delicacy.",
    edible_portions: "Steaks, fletches (large fillets), and cheeks are the primary products.",
    url: null
  },
  "Sablefish": {
    description: "Also known as Black Cod. Rich, buttery flavor with silky texture and high oil content.",
    culinary_uses: "Excellent smoked or grilled. The Japanese call it 'butterfish' and use it for misoyaki.",
    edible_portions: "Whole fish, steaks, and fillets. The high oil content makes it ideal for smoking.",
    url: null
  }
};

export default { FISH_DATA, FISH_DATA_V2, ACRONYMS, PROFILES_DATA };
