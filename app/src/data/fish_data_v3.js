/**
 * Fish Yield Data - Complete from MAB-37 PDF
 * "Recoveries and Yields from Pacific Fish and Shellfish"
 * Alaska Sea Grant College Program, 2004
 * 
 * Data marked with ⚠️ UNCERTAIN in comments needs verification
 */

export const DATA_SOURCE = {
  title: "Recoveries and Yields from Pacific Fish and Shellfish",
  authors: ["Chuck Crapo", "Brian Paust", "Jerry Babbitt"],
  publisher: "Alaska Sea Grant College Program",
  publication: "Marine Advisory Bulletin No. 37",
  year: 2004,
  isbn: "1-56612-012-8"
};

export const ACRONYMS = {
  "D/H-On": "Dressed/Head-On - Gutted, head attached",
  "D/H-Off": "Dressed/Head-Off - Gutted, head removed", 
  "S/B": "Skinless/Boneless",
  "SIB": "Skinless/Boneless",
  "Round": "Whole fish as caught",
  "Fillet": "Side of fish removed from backbone",
  "Fletch": "Large fillet from halibut or flatfish",
  "V-cut": "Fillet with belly bones removed in V shape",
  "J-cut": "Fillet with angled cut to remove bones",
  "Steaks": "Cross-section cuts including backbone",
  "Smoked": "Cured and smoked product",
  "Roe": "Fish eggs",
  "Mince": "Ground fish meat",
  "Surimi": "Processed fish paste",
  "Kurimi": "Similar to surimi"
};

export const FISH_DATA_V3 = {
  // ============ SALMON ============
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
      "Round → SIB Trim": { yield: 14, range: [12, 16] },
      "Round → Steaks": { yield: 58, range: [53, 65] },
      "Round → Dry-Salt Sides": { yield: 36, range: null },
      "Round → Mild Cure Sides": { yield: 30, range: null },
      "Round → Smoked Sides": { yield: 30, range: null },
      "Round → Roe": { yield: 6, range: [3, 10] },
      "D/H-On → D/H-Off": { yield: 81, range: [72, 90] },
      "D/H-On → Skin-On Fillet (Hand)": { yield: 57, range: [50, 64] },
      "D/H-On → Skin-On Fillet (Machine)": { yield: 55, range: [48, 61] },
      "D/H-On → Skinless Fillet": { yield: 46, range: [43, 55] },
      "D/H-On → SIB Fillet (V-Cut)": { yield: 36, range: [32, 43] },
      "D/H-On → SIB Fillet (Pinboning)": { yield: 44, range: [41, 53] },
      "D/H-On → SIB Trim": { yield: 16, range: [13, 19] },
      "D/H-On → Steaks": { yield: 63, range: [56, 77] },
      "D/H-On → Dry-Salt Sides": { yield: 40, range: null },
      "D/H-On → Mild Cure Sides": { yield: 33, range: null },
      "D/H-On → Smoked Sides": { yield: 33, range: null },
      "D/H-Off → Skin-On Fillet (Hand)": { yield: 74, range: null },
      "D/H-Off → Skin-On Fillet (Machine)": { yield: 71, range: null },
      "D/H-Off → Skinless Fillet": { yield: 58, range: null },
      "D/H-Off → SIB Fillet (V-Cut)": { yield: 45, range: null },
      "D/H-Off → SIB Fillet (Pinboning)": { yield: 55, range: null },
      "D/H-Off → SIB Trim": { yield: 19, range: null },
      "D/H-Off → Steaks": { yield: 80, range: null },
      "D/H-Off → Dry-Salt Sides": { yield: 49, range: null },
      "D/H-Off → Mild Cure Sides": { yield: 41, range: null },
      "D/H-Off → Smoked Sides": { yield: 41, range: [35, 50] },
      "D/H-On (Thawed) → Skin-On Fillet": { yield: 54, range: null },
      "D/H-On (Thawed) → Skinless Fillet": { yield: 45, range: null },
      "D/H-Off (Thawed) → Skin-On Fillet": { yield: 67, range: null },
      "D/H-Off (Thawed) → Skinless Fillet": { yield: 56, range: null }
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
      "Round → SIB Fillet (V-Cut)": { yield: 36, range: [30, 36] },
      "Round → SIB Fillet (Pinboning)": { yield: 48, range: [43, 51] },
      "Round → SIB Trim": { yield: 15, range: [12, 16] },
      "Round → Steaks": { yield: 58, range: [55, 65] },
      "Round → Dry-Salt Sides": { yield: 43, range: null },
      "Round → Mild Cure Sides": { yield: 35, range: null },
      "Round → Smoked Sides": { yield: 35, range: null },
      "Round → Roe": { yield: 8, range: [4, 10] },
      "D/H-On → D/H-Off": { yield: 83, range: [79, 91] },
      "D/H-On → Skin-On Fillet (Hand)": { yield: 67, range: [61, 74] },
      "D/H-On → Skin-On Fillet (Machine)": { yield: 64, range: [58, 66] },
      "D/H-On → Skinless Fillet": { yield: 56, range: [49, 62] },
      "D/H-On → SIB Fillet (V-Cut)": { yield: 43, range: [38, 47] },
      "D/H-On → SIB Fillet (Pinboning)": { yield: 53, range: [47, 59] },
      "D/H-On → SIB Trim": { yield: 17, range: [13, 19] },
      "D/H-On → Steaks": { yield: 65, range: [61, 75] },
      "D/H-On → Dry-Salt Sides": { yield: 48, range: null },
      "D/H-On → Mild Cure Sides": { yield: 39, range: null },
      "D/H-On → Smoked Sides": { yield: 39, range: null },
      "D/H-Off → Skin-On Fillet (Hand)": { yield: 81, range: null },
      "D/H-Off → Skin-On Fillet (Machine)": { yield: 77, range: null },
      "D/H-Off → Skinless Fillet": { yield: 67, range: null },
      "D/H-Off → SIB Fillet (V-Cut)": { yield: 51, range: null },
      "D/H-Off → SIB Fillet (Pinboning)": { yield: 64, range: null },
      "D/H-Off → SIB Trim": { yield: 20, range: null },
      "D/H-Off → Steaks": { yield: 78, range: null },
      "D/H-Off → Dry-Salt Sides": { yield: 58, range: null },
      "D/H-Off → Salted D/H-Off": { yield: 47, range: null },
      "D/H-Off → Smoked Sides": { yield: 55, range: [45, 60] },
      "D/H-On (Thawed) → Skin-On Fillet": { yield: 62, range: null },
      "D/H-On (Thawed) → Skinless Fillet": { yield: 52, range: null },
      "D/H-Off (Thawed) → Skin-On Fillet": { yield: 75, range: null },
      "D/H-Off (Thawed) → Skinless Fillet": { yield: 63, range: null }
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
      "Round → Skin-On Fillet (Machine)": { yield: 51, range: [48, 56] },
      "Round → Skinless Fillet": { yield: 46, range: [41, 49] },
      "Round → SIB Fillet (V-Cut)": { yield: 35, range: [30, 38] },
      "Round → SIB Fillet (Pinboning)": { yield: 45, range: [40, 48] },
      "Round → SIB Trim": { yield: 15, range: [12, 16] },
      "Round → Steaks": { yield: 57, range: [55, 65] },
      "Round → Dry-Salt Sides": { yield: 40, range: null },
      "Round → Mild Cure Sides": { yield: 33, range: null },
      "Round → Smoked Sides": { yield: 33, range: null },
      "Round → Roe": { yield: 4, range: [3, 6] },
      "D/H-On → D/H-Off": { yield: 80, range: [70, 94] },
      "D/H-On → Skin-On Fillet (Hand)": { yield: 57, range: [53, 68] },
      "D/H-On → Skin-On Fillet (Machine)": { yield: 54, range: [49, 62] },
      "D/H-On → Skinless Fillet": { yield: 50, range: [43, 56] },
      "D/H-On → SIB Fillet (V-Cut)": { yield: 38, range: [32, 41] },
      "D/H-On → SIB Fillet (Pinboning)": { yield: 48, range: [42, 54] },
      "D/H-On → SIB Trim": { yield: 16, range: [13, 28] },
      "D/H-On → Steaks": { yield: 62, range: [59, 75] },
      "D/H-On → Dry-Salt Sides": { yield: 44, range: null },
      "D/H-On → Mild Cure Sides": { yield: 36, range: null },
      "D/H-On → Smoked Sides": { yield: 36, range: null },
      "D/H-Off → Skin-On Fillet (Hand)": { yield: 72, range: null },
      "D/H-Off → Skin-On Fillet (Machine)": { yield: 69, range: null },
      "D/H-Off → Skinless Fillet": { yield: 62, range: null },
      "D/H-Off → SIB Fillet (V-Cut)": { yield: 47, range: null },
      "D/H-Off → SIB Fillet (Pinboning)": { yield: 59, range: null },
      "D/H-Off → SIB Trim": { yield: 20, range: null },
      "D/H-Off → Steaks": { yield: 77, range: null },
      "D/H-Off → Dry-Salt Sides": { yield: 54, range: null },
      "D/H-Off → Mild Cure Sides": { yield: 45, range: null },
      "D/H-Off → Smoked Sides": { yield: 45, range: [35, 60] },
      "D/H-On (Thawed) → Skin-On Fillet": { yield: 52, range: null },
      "D/H-On (Thawed) → Skinless Fillet": { yield: 47, range: null },
      "D/H-Off (Thawed) → Skin-On Fillet": { yield: 65, range: null },
      "D/H-Off (Thawed) → Skinless Fillet": { yield: 59, range: null }
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
      "Round → Skin-On Fillet (Machine)": { yield: 55, range: [50, 57] },
      "Round → Skinless Fillet": { yield: 51, range: [46, 56] },
      "Round → SIB Fillet (V-Cut)": { yield: 38, range: [30, 40] },
      "Round → SIB Fillet (Pinboning)": { yield: 49, range: [44, 54] },
      "Round → SIB Trim": { yield: 14, range: [12, 17] },
      "Round → Steaks": { yield: 62, range: [58, 65] },
      "Round → Dry-Salt Sides": { yield: 43, range: null },
      "Round → Mild Cure Sides": { yield: 36, range: null },
      "Round → Smoked Sides": { yield: 36, range: null },
      "Round → Roe": { yield: 7, range: [5, 10] },
      "D/H-On → D/H-Off": { yield: 82, range: [76, 92] },
      "D/H-On → Skin-On Fillet (Hand)": { yield: 62, range: [58, 67] },
      "D/H-On → Skin-On Fillet (Machine)": { yield: 59, range: [56, 63] },
      "D/H-On → Skinless Fillet": { yield: 55, range: [49, 63] },
      "D/H-On → SIB Fillet (V-Cut)": { yield: 41, range: [32, 45] },
      "D/H-On → SIB Fillet (Pinboning)": { yield: 52, range: [46, 60] },
      "D/H-On → SIB Trim": { yield: 15, range: [13, 18] },
      "D/H-On → Steaks": { yield: 66, range: [63, 73] },
      "D/H-On → Dry-Salt Sides": { yield: 47, range: null },
      "D/H-On → Mild Cure Sides": { yield: 39, range: null },
      "D/H-On → Smoked Sides": { yield: 39, range: null },
      "D/H-Off → Skin-On Fillet (Hand)": { yield: 76, range: null },
      "D/H-Off → Skin-On Fillet (Machine)": { yield: 73, range: null },
      "D/H-Off → Skinless Fillet": { yield: 68, range: null },
      "D/H-Off → SIB Fillet (V-Cut)": { yield: 51, range: null },
      "D/H-Off → SIB Fillet (Pinboning)": { yield: 64, range: null },
      "D/H-Off → SIB Trim": { yield: 19, range: null },
      "D/H-Off → Steaks": { yield: 81, range: null },
      "D/H-Off → Dry-Salt Sides": { yield: 57, range: null },
      "D/H-Off → Mild Cure Sides": { yield: 48, range: null },
      "D/H-Off → Smoked Sides": { yield: 48, range: [40, 60] },
      "D/H-On (Thawed) → Skin-On Fillet": { yield: 58, range: null },
      "D/H-On (Thawed) → Skinless Fillet": { yield: 49, range: null },
      "D/H-Off (Thawed) → Skin-On Fillet": { yield: 71, range: null },
      "D/H-Off (Thawed) → Skinless Fillet": { yield: 60, range: null }
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
      "Round → SIB Fillet (V-Cut)": { yield: 36, range: [30, 40] },
      "Round → SIB Fillet (Pinboning)": { yield: 45, range: [40, 48] },
      "Round → SIB Trim": { yield: 14, range: [12, 16] },
      "Round → Steaks": { yield: 58, range: [54, 65] },
      "Round → Dry-Salt Sides": { yield: 40, range: null },
      "Round → Mild Cure Sides": { yield: 34, range: null },
      "Round → Smoked Sides": { yield: 34, range: null },
      "Round → Roe": { yield: 6, range: [3, 10] },
      "D/H-On → D/H-Off": { yield: 82, range: [73, 90] },
      "D/H-On → Skin-On Fillet (Hand)": { yield: 63, range: [55, 73] },
      "D/H-On → Skinless Fillet": { yield: 52, range: [44, 59] },
      "D/H-On → SIB Fillet (V-Cut)": { yield: 41, range: [32, 49] },
      "D/H-On → SIB Fillet (Pinboning)": { yield: 50, range: [42, 57] },
      "D/H-On → SIB Trim": { yield: 16, range: [13, 20] },
      "D/H-On → Steaks": { yield: 66, range: [57, 79] },
      "D/H-On → Dry-Salt Sides": { yield: 46, range: null },
      "D/H-On → Mild Cure Sides": { yield: 39, range: null },
      "D/H-On → Smoked Sides": { yield: 39, range: null },
      "D/H-Off → Skin-On Fillet (Hand)": { yield: 76, range: null },
      "D/H-Off → Skinless Fillet": { yield: 64, range: null },
      "D/H-Off → SIB Fillet (V-Cut)": { yield: 50, range: null },
      "D/H-Off → SIB Fillet (Pinboning)": { yield: 61, range: null },
      "D/H-Off → SIB Trim": { yield: 19, range: null },
      "D/H-Off → Steaks": { yield: 81, range: null },
      "D/H-Off → Dry-Salt Sides": { yield: 56, range: null },
      "D/H-Off → Mild Cure Sides": { yield: 47, range: null },
      "D/H-Off → Smoked Sides": { yield: 47, range: [35, 60] }
    }
  },

  "Norwegian Farmed Salmon": {
    scientific_name: "Salmo salar (farmed)",
    category: "Salmon",
    conversions: {
      "D/H-On → D/H-Off": { yield: 88, range: null },
      "D/H-On → Skin-On Fillet": { yield: 76, range: null },
      "D/H-On → Skinless Fillet": { yield: 68, range: null },
      "D/H-On → Roasts": { yield: 85, range: null }
    }
  },

  "Chilean Farmed Salmon": {
    scientific_name: "Salmo salar (farmed)",
    category: "Salmon",
    conversions: {
      "D/H-On → D/H-Off": { yield: 86, range: null },
      "D/H-On → Skin-On Fillet": { yield: 72, range: null },
      "D/H-On → Skinless Fillet": { yield: 66, range: null },
      "D/H-On → Roasts": { yield: 83, range: null }
    }
  },

  // ============ COD & GROUNDFISH ============
  "Pacific Cod": {
    scientific_name: "Gadus macrocephalus",
    category: "Groundfish",
    conversions: {
      "Round → D/H-On": { yield: 81, range: [72, 90] },
      "Round → D/H-Off": { yield: 63, range: [56, 75] },
      "Round → Skin-On Fillets (V-cut)": { yield: 45, range: [38, 48] },
      "Round → Skinless Fillets (V-cut)": { yield: 39, range: [22, 45] },
      "Round → SIB Fillets (V-cut)": { yield: 33, range: [18, 39] },
      "Round → Skin-On Fillets": { yield: 38, range: null },
      "Round → Skinless Fillets (J-cut)": { yield: 32, range: null },
      "Round → SIB Fillets (J-cut)": { yield: 26, range: null },
      "Round → Steaks": { yield: 62, range: null },
      "Round → Salted D/H-Off": { yield: 45, range: null },
      "Round → Smoked D/H-Off": { yield: 58, range: [50, 65] },
      "Round → Belly Flaps": { yield: 10, range: null },
      "Round → Liver": { yield: 5, range: [3, 7] },
      "Round → Roe": { yield: 4, range: [1, 7] },
      "D/H-On → D/H-Off": { yield: 78, range: null },
      "D/H-On → Skin-On Fillets": { yield: 55, range: [42, 60] },
      "D/H-On → Skinless Fillets": { yield: 48, range: [34, 56] },
      "D/H-On → SIB Fillets": { yield: 41, range: [20, 48] },
      "D/H-Off → Skin-On Fillets": { yield: 71, range: [54, 80] },
      "D/H-Off → Skinless Fillets": { yield: 62, range: [31, 81] },
      "D/H-Off → SIB Fillets": { yield: 52, range: [25, 70] },
      "D/H-Off → Smoked": { yield: 58, range: [50, 65] },
      "Skin-On Fillets → Skinless Fillets": { yield: 87, range: null },
      "Skin-On Fillets → Trim": { yield: 12, range: null },
      "Skin-On Fillets → SIB Fillets": { yield: 73, range: null },
      "Skinless Fillets → SIB Fillets": { yield: 84, range: null },
      "Skinless Fillets → Trim": { yield: 13, range: null },
      "Trim → Mince": { yield: 90, range: [80, 95] }
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
      "Round → Surimi (Traditional)": { yield: 20, range: [15, 22] },
      "Round → Surimi (Decanter)": { yield: 27, range: [26, 32] },
      "Round → Roe": { yield: 7, range: [3, 20] },
      "Skin-On Fillets → Skinless Fillets": { yield: 85, range: null },
      "Trim → Mince": { yield: 87, range: null }
    }
  },

  "Pacific Hake": {
    scientific_name: "Merluccius productus",
    category: "Groundfish",
    conversions: {
      "Round → D/H-On": { yield: 80, range: [70, 85] },
      "Round → D/H-Off": { yield: 60, range: [56, 71] },
      "Round → Skin-On Fillets": { yield: 43, range: null },
      "Round → Skinless Fillets": { yield: 32, range: null },
      "Round → SIB Fillets": { yield: 27, range: null },
      "Round → Surimi (Decanter)": { yield: 27, range: [26, 30] },
      "Round → Roe": { yield: 5, range: [2, 8] }, // ⚠️ UNCERTAIN - range reconstructed
      "D/H-On → Skin-On Fillets": { yield: 54, range: null },
      "D/H-On → Skinless Fillets": { yield: 40, range: null },
      "D/H-On → SIB Fillets": { yield: 34, range: null },
      "Skin-On Fillets → Skinless Fillets": { yield: 74, range: null },
      "Skin-On Fillets → SIB Fillets": { yield: 63, range: null }
    }
  },

  // ============ HALIBUT & FLATFISH ============
  "Pacific Halibut": {
    scientific_name: "Hippoglossus stenolepis",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 92] },
      "Round → D/H-Off": { yield: 72, range: [68, 80] },
      "Round → Steaks": { yield: 62, range: [60, 75] },
      "Round → Skin-On Fillet": { yield: 49, range: [45, 56] },
      "Round → Skinless Fillet (Fletch)": { yield: 41, range: [34, 44] },
      "D/H-On → D/H-Off": { yield: 83, range: [73, 94] },
      "D/H-On → Steaks": { yield: 76, range: [71, 88] },
      "D/H-On → Skin-On Fillet": { yield: 56, range: [47, 64] },
      "D/H-On → Skinless Fillet (Fletch)": { yield: 46, range: [38, 50] },
      "D/H-Off → Steaks": { yield: 79, range: [70, 94] },
      "D/H-Off → Skin-On Fillet": { yield: 68, range: [64, 73] },
      "D/H-Off → Skinless Fillet (Fletch)": { yield: 56, range: [45, 60] },
      "D/H-Off → Roasts": { yield: 84, range: null }
    }
  },

  "Arrowtooth Flounder": {
    scientific_name: "Atheresthes stomias",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 90, range: [84, 94] },
      "Round → D/H-Off": { yield: 74, range: [70, 80] },
      "Round → Skinless Fillet": { yield: 34, range: [25, 39] },
      "Round → Surimi": { yield: 11, range: null },
      "Round → Kurimi": { yield: 48, range: null },
      "Round → SIB fillets": { yield: 25, range: [18, 30] }
    }
  },

  "Starry Flounder": {
    scientific_name: "Platichthys stellatus",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 84, range: [79, 86] },
      "Round → D/H-Off": { yield: 67, range: [63, 69] },
      "Round → Skinless Fillet": { yield: 33, range: [25, 40] }
    }
  },

  "Flathead Sole": {
    scientific_name: "Hippoglossoides elassodon",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 86, range: [80, 94] },
      "Round → D/H-Off": { yield: 67, range: [60, 79] },
      "Round → Skinless Fillet": { yield: 27, range: [25, 32] }
    }
  },

  "Petrale Sole": {
    scientific_name: "Eopsetta jordani",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 86, range: [75, 90] },
      "Round → D/H-Off": { yield: 66, range: [55, 75] },
      "Round → Skinless Fillet": { yield: 29, range: [28, 32] }
    }
  },

  "Dover Sole": {
    scientific_name: "Microstomus pacificus",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 86, range: [75, 90] },
      "Round → D/H-Off": { yield: 65, range: [55, 65] },
      "Round → Skinless Fillet": { yield: 29, range: [26, 32] }
    }
  },

  "Rex Sole": {
    scientific_name: "Glyptocephalus zachirus",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 85, range: [75, 90] },
      "Round → D/H-Off": { yield: 65, range: [55, 75] },
      "Round → Skinless Fillet": { yield: 33, range: [27, 37] }
    }
  },

  "Rock Sole": {
    scientific_name: "Lepidopsetta bilineata",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 87, range: [82, 92] },
      "Round → D/H-Off": { yield: 67, range: [62, 78] },
      "Round → Skinless Fillet": { yield: 28, range: [22, 30] }
    }
  },

  "Yellowfin Sole": {
    scientific_name: "Limanda aspera",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 86, range: [76, 94] },
      "Round → D/H-Off": { yield: 69, range: [60, 83] },
      "Round → Skinless Fillet": { yield: 25, range: [16, 30] },
      "Round → Surimi": { yield: 11, range: null },
      "Round → Kurimi": { yield: 48, range: null }
    }
  },

  "English Sole": {
    scientific_name: "Parophrys vetulus",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 85, range: [79, 94] },
      "Round → D/H-Off": { yield: 65, range: [55, 75] },
      "Round → Skinless Fillet": { yield: 27, range: [25, 28] }
    }
  },

  "Dabs": {
    scientific_name: "Limanda proboscidea",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 85, range: [75, 90] },
      "Round → D/H-Off": { yield: 64, range: [55, 75] },
      "Round → Skinless Fillet": { yield: 23, range: [17, 26] }
    }
  },

  "Alaska Plaice": {
    scientific_name: "Pleuronectes quadrituberculatus",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 84, range: [79, 86] },
      "Round → D/H-Off": { yield: 68, range: [60, 72] },
      "Round → Skinless Fillet": { yield: 35, range: [30, 40] }
    }
  },

  "Greenland Turbot": {
    scientific_name: "Reinhardtius hippoglossoides",
    category: "Flatfish",
    conversions: {
      "Round → D/H-On": { yield: 90, range: null },
      "Round → D/H-Off": { yield: 74, range: [70, 80] },
      "Round → Skinless Fillet": { yield: 30, range: [25, 35] }
    }
  },

  // ============ ROCKFISH (17 species) ============
  // Note: Many rockfish share similar yield data per PDF
  "Black Rockfish": {
    scientific_name: "Sebastes melanops",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → D/H-Off (Eastern)": { yield: 50, range: null },
      "Round → Skin-On Fillet": { yield: 32, range: [30, 36] },
      "Round → Skinless Fillet": { yield: 27, range: [25, 33] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 56, range: null },
      "D/H-On → Skinless Fillet": { yield: 48, range: null }
    }
  },

  "Greenstriped Rockfish": {
    scientific_name: "Sebastes elongatus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 32, range: [30, 36] },
      "Round → Skinless Fillet": { yield: 27, range: [25, 33] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 56, range: null },
      "D/H-On → Skinless Fillet": { yield: 48, range: null }
    }
  },

  "Thornyhead Rockfish": {
    scientific_name: "Sebastes altivelis",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 32, range: [30, 36] },
      "Round → Skinless Fillet": { yield: 27, range: [25, 33] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 56, range: null },
      "D/H-On → Skinless Fillet": { yield: 48, range: null }
    }
  },

  "Canary Rockfish": {
    scientific_name: "Sebastes pinniger",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "China Rockfish": {
    scientific_name: "Sebastes nebulosus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Dusky Rockfish": {
    scientific_name: "Sebastes ciliatus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Quillback Rockfish": {
    scientific_name: "Sebastes maliger",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Redbanded Rockfish": {
    scientific_name: "Sebastes babcocki",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Redstriped Rockfish": {
    scientific_name: "Sebastes proriger",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → D/H-Off (Eastern)": { yield: 50, range: null },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "Skin-On Fillet → Skinless Fillet": { yield: 82, range: null },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Rosethorn Rockfish": {
    scientific_name: "Sebastes helvomaculatus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → D/H-Off (Eastern)": { yield: 50, range: null },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "Skin-On Fillet → Skinless Fillet": { yield: 82, range: null },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Rougheye Rockfish": {
    scientific_name: "Sebastes aleutianus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 32, range: [30, 36] },
      "Round → Skinless Fillet": { yield: 27, range: [25, 33] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 56, range: null },
      "D/H-On → Skinless Fillet": { yield: 48, range: null }
    }
  },

  "Shortraker Rockfish": {
    scientific_name: "Sebastes borealis",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 32, range: [30, 36] },
      "Round → Skinless Fillet": { yield: 27, range: [25, 33] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 56, range: null },
      "D/H-On → Skinless Fillet": { yield: 48, range: null }
    }
  },

  "Silvergray Rockfish": {
    scientific_name: "Sebastes brevispinis",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Tiger Rockfish": {
    scientific_name: "Sebastes nigrocinctus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Widow Rockfish": {
    scientific_name: "Sebastes entomelas",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Yelloweye Rockfish": {
    scientific_name: "Sebastes ruberrimus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Yellowtail Rockfish": {
    scientific_name: "Sebastes flavidus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 91] },
      "Round → D/H-Off": { yield: 57, range: [48, 62] },
      "Round → Skin-On Fillet": { yield: 28, range: [25, 35] },
      "Round → Skinless Fillet": { yield: 23, range: [21, 30] },
      "D/H-On → D/H-Off": { yield: 65, range: null },
      "D/H-On → Skin-On Fillet": { yield: 49, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null }
    }
  },

  "Pacific Ocean Perch": {
    scientific_name: "Sebastes alutus",
    category: "Rockfish",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [82, 94] },
      "Round → D/H-Off": { yield: 62, range: [46, 72] },
      "Round → Skinless Fillet": { yield: 30, range: [27, 32] },
      "D/H-On → D/H-Off": { yield: 71, range: null },
      "D/H-On → Skinless Fillet": { yield: 35, range: null }
    }
  },

  // ============ SHARKS (6 species) ============
  "Salmon Shark": {
    scientific_name: "Lamna ditropis",
    category: "Shark",
    conversions: {
      "Round → D/H-On": { yield: 80, range: null },
      "Round → D/H-Off": { yield: 63, range: [50, 66] },
      "Round → Trunk": { yield: 58, range: [44, 59] },
      "Round → Skin-On Fillet": { yield: 53, range: [39, 57] },
      "Round → Skinless Fillet": { yield: 44, range: [32, 48] },
      "Round → Fins": { yield: 5, range: null }
    }
  },

  "Sevengill Shark": {
    scientific_name: "Notorynchus maculata",
    category: "Shark",
    conversions: {
      "Round → D/H-On": { yield: 86, range: null },
      "Round → D/H-Off": { yield: 55, range: null },
      "Round → Trunk": { yield: 52, range: null },
      "Round → Skin-On Fillet": { yield: 45, range: null },
      "Round → Skinless Fillet": { yield: 35, range: null },
      "Round → Fins": { yield: 5, range: null }
    }
  },

  "Soupfin Shark": {
    scientific_name: "Galeorhinus zyopterus",
    category: "Shark",
    conversions: {
      "Round → D/H-On": { yield: 65, range: null },
      "Round → D/H-Off": { yield: 51, range: null },
      "Round → Trunk": { yield: 45, range: null },
      "Round → Fins": { yield: 4, range: null }
    }
  },

  "Blue Shark": {
    scientific_name: "Prionace glauca",
    category: "Shark",
    conversions: {
      "Round → D/H-On": { yield: 88, range: null },
      "Round → D/H-Off": { yield: 67, range: null },
      "Round → Trunk": { yield: 54, range: null },
      "Round → Skin-On Fillet": { yield: 51, range: null },
      "Round → Skinless Fillet": { yield: 40, range: null },
      "Round → Fins": { yield: 6, range: null }
    }
  },

  "Thresher Shark": {
    scientific_name: "Alopias vulpinus",
    category: "Shark",
    conversions: {
      "Round → D/H-On": { yield: 85, range: null },
      "Round → D/H-Off": { yield: 71, range: null },
      "Round → Trunk": { yield: 57, range: null },
      "Round → Skin-On Fillet": { yield: 49, range: null },
      "Round → Skinless Fillet": { yield: 44, range: null },
      "Round → Fins": { yield: 14, range: null }
    }
  },

  "Blacktip Shark": {
    scientific_name: "Carcharhinus limbatus",
    category: "Shark",
    conversions: {
      "Round → D/H-On": { yield: 82, range: null },
      "Round → D/H-Off": { yield: 62, range: null },
      "Round → Trunk": { yield: 52, range: null },
      "Round → Skin-On Fillet": { yield: 46, range: null },
      "Round → Skinless Fillet": { yield: 36, range: null },
      "Round → Fins": { yield: 10, range: null }
    }
  },

  "Spiny Dogfish": {
    scientific_name: "Squalus acanthias",
    category: "Shark",
    conversions: {
      "Round → D/H-On": { yield: 75, range: [69, 80] },
      "Round → D/H-Off": { yield: 55, range: [41, 68] },
      "Round → Edible Portion": { yield: 36, range: [32, 40] },
      "Round → Backs": { yield: 30, range: null },
      "Round → Belly Flaps": { yield: 5, range: null },
      "Round → Tails and Fins": { yield: 4, range: [4, 6] },
      "Round → Liver": { yield: 13, range: [10, 21] },
      "D/H-On → D/H-Off": { yield: 69, range: null }
    }
  },

  "Sharks General": {
    scientific_name: "Various species",
    category: "Shark",
    conversions: {
      "Round → D/H-On": { yield: 80, range: [62, 90] },
      "Round → D/H-Off": { yield: 58, range: [22, 75] },
      "Round → Trunk": { yield: 51, range: [33, 67] },
      "Round → Skin-On Fillet": { yield: 42, range: [21, 60] },
      "Round → Skinless Fillet": { yield: 32, range: [17, 56] },
      "Round → Fins": { yield: 5, range: [1, 12] },
      "D/H-On → D/H-Off": { yield: 73, range: null },
      "D/H-On → Trunk": { yield: 64, range: null },
      "D/H-On → Skin-On Fillet": { yield: 53, range: null },
      "D/H-On → Skinless Fillet": { yield: 40, range: null },
      "D/H-On → Fins": { yield: 6, range: null },
      "D/H-Off → Trunk": { yield: 88, range: null },
      "D/H-Off → Skin-On Fillet": { yield: 73, range: null },
      "D/H-Off → Skinless Fillet": { yield: 55, range: null },
      "D/H-Off → Fins": { yield: 9, range: null }
    }
  },

  // ============ PACIFIC SAURY ============
  "Pacific Saury": {
    scientific_name: "Cololabis saira",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [83, 92] },
      "Round → D/H-Off": { yield: 76, range: [71, 86] },
      "Round → Skinless Fillet": { yield: 57, range: [54, 61] }
    }
  },

  // ============ SABLEFISH & OTHER ============
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
      "D/H-Off (Eastern) → Skin-On Fillet": { yield: 59, range: null },
      "D/H-Off (Eastern) → Skinless Fillet": { yield: 52, range: null },
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
      "D/H-On → Steaks": { yield: 69, range: null },
      "D/H-Off → Skinless Fillet": { yield: 49, range: null },
      "D/H-Off → Steaks": { yield: 86, range: null }
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
      "Round → D/H-Off": { yield: 70, range: [60, 76] },
      "Round → Skin-On Fillets": { yield: 53, range: [45, 60] },
      "Round → Skinless Fillets": { yield: 49, range: [41, 58] },
      "Round → Salted Round": { yield: 82, range: [79, 88] },
      "Round → Salted Fillets": { yield: 42, range: [35, 47] },
      "Round → Smoked D/H-Off": { yield: 60, range: null },
      "Round → Roe": { yield: 10, range: [3, 18] }
    }
  },

  "Pacific Lamprey": {
    scientific_name: "Lampetra tridentata",
    category: "Other",
    conversions: {
      "Round → D/H-Off": { yield: 77, range: [74, 85] }
    }
  },

  "Capelin": {
    scientific_name: "Mallotus villosus",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 89, range: [84, 93] },
      "Round → D/H-Off": { yield: 78, range: [73, 81] },
      "Round → Belly Flaps": { yield: 10, range: null }
    }
  },

  "Smelt": {
    scientific_name: "Hypomesus sp. / Spirinchus sp.",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 85, range: [82, 90] },
      "Round → D/H-Off": { yield: 71, range: [67, 78] },
      "Round → Skinless Fillet": { yield: 38, range: null },
      "D/H-Off → Salted": { yield: 45, range: null },
      "D/H-Off → Smoked": { yield: 57, range: null }
    }
  },

  "Albacore Tuna": {
    scientific_name: "Thunnus alalunga",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 90, range: null },
      "Round → D/H-Off": { yield: 75, range: null },
      "Round → Skinless Fillet": { yield: 35, range: null },
      "Round → Steaks": { yield: 65, range: null },
      "D/H-On → D/H-Off": { yield: 83, range: null },
      "D/H-On → Skinless Fillet": { yield: 39, range: null },
      "D/H-On → Steaks": { yield: 72, range: null }
    }
  },

  "Sturgeon": {
    scientific_name: "Acipenser sp.",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 85, range: [82, 87] },
      "Round → D/H-Off": { yield: 75, range: [72, 78] },
      "Round → Skin-On Fillet": { yield: 56, range: [50, 59] },
      "Round → Skinless Fillet": { yield: 45, range: null },
      "Round → Steaks": { yield: 62, range: null },
      "Round → Roe": { yield: 10, range: [8, 12] },
      "D/H-On → D/H-Off": { yield: 88, range: null },
      "D/H-On → Skin-On Fillet": { yield: 66, range: null },
      "D/H-On → Skinless Fillet": { yield: 53, range: null },
      "D/H-Off → Salted": { yield: 46, range: null },
      "D/H-Off → Smoked": { yield: 56, range: null }
    }
  },

  "Trout": {
    scientific_name: "Salmo sp. / Salvelinus sp.",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 88, range: null },
      "Round → D/H-Off": { yield: 69, range: null },
      "Round → Skin-On Fillet": { yield: 61, range: [60, 65] },
      "Round → Skinless Fillet": { yield: 55, range: null },
      "Round → Steaks": { yield: 60, range: null },
      "D/H-On → D/H-Off": { yield: 78, range: null },
      "D/H-On → Skin-On Fillet": { yield: 69, range: null },
      "D/H-On → Skinless Fillet": { yield: 63, range: null },
      "D/H-Off → Skin-On Fillet": { yield: 88, range: null },
      "D/H-Off → Skinless Fillet": { yield: 80, range: null },
      "D/H-Off → Smoked": { yield: 54, range: null }
    }
  },

  "Norwegian Farmed Trout": {
    scientific_name: "Oncorhynchus mykiss (farmed)",
    category: "Other",
    conversions: {
      "D/H-On → D/H-Off": { yield: 78, range: null },
      "D/H-On → Skin-On Fillet": { yield: 69, range: null },
      "D/H-On → Skinless Fillet": { yield: 63, range: null }
    }
  },

  "American Shad": {
    scientific_name: "Alosa sapidissima",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 88, range: [85, 92] },
      "Round → D/H-Off": { yield: 74, range: [69, 77] },
      "Round → Skin-On Fillet": { yield: 65, range: [62, 67] },
      "Round → Skinless Fillet": { yield: 54, range: null },
      "Round → Roe": { yield: 10, range: [3, 17] } // ⚠️ UNCERTAIN - range approximated
    }
  },

  "Eels": {
    scientific_name: "Anguilliformes",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 90, range: null },
      "Round → D/H-Off": { yield: 72, range: [70, 75] },
      "Round → Skin-On Flesh": { yield: 62, range: [56, 65] },
      "D/H-Off → Smoked": { yield: 65, range: null }
    }
  },

  "Rat-Tails": {
    scientific_name: "Coryphaenoides sp.",
    category: "Other",
    conversions: {
      "Round → Edible Meat": { yield: 53, range: null }
    }
  },

  // ============ CRAB ============
  "Dungeness Crab": {
    scientific_name: "Cancer magister",
    category: "Crab",
    conversions: {
      "Raw Whole → Raw Sections": { yield: 60, range: null },
      "Raw Whole → Cooked Whole": { yield: 90, range: null },
      "Raw Whole → Cooked Sections": { yield: 52, range: null },
      "Raw Whole → Cooked Meat": { yield: 24, range: [22, 25] },
      "Raw Sections → Cooked Sections": { yield: 87, range: null },
      "Cooked Whole → Cooked Meat": { yield: 27, range: null },
      "Cooked Sections → Cooked Meat": { yield: 46, range: null }
    }
  },

  "King Crab (Red/Brown/Golden)": {
    scientific_name: "Paralithodes camtschatica / Lithodes aequispina",
    category: "Crab",
    conversions: {
      "Raw Whole → Raw Sections": { yield: 69, range: [67, 74] },
      "Raw Whole → Cooked Whole": { yield: 92, range: [90, 95] },
      "Raw Whole → Cooked Sections": { yield: 60, range: [52, 67] },
      "Raw Whole → Cooked Meat": { yield: 25, range: [23, 28] },
      "Raw Sections → Cooked Sections": { yield: 87, range: null },
      "Cooked Whole → Cooked Meat": { yield: 27, range: null },
      "Cooked Sections → Cooked Meat": { yield: 42, range: null }
    }
  },

  "Blue King Crab": {
    scientific_name: "Paralithodes platypus",
    category: "Crab",
    conversions: {
      "Raw Whole → Raw Sections": { yield: 65, range: null },
      "Raw Whole → Cooked Whole": { yield: 90, range: null },
      "Raw Whole → Cooked Sections": { yield: 55, range: [50, 61] },
      "Raw Whole → Cooked Meat": { yield: 20, range: [16, 23] },
      "Raw Sections → Cooked Sections": { yield: 84, range: null },
      "Cooked Whole → Cooked Meat": { yield: 22, range: null },
      "Cooked Sections → Cooked Meat": { yield: 37, range: null }
    }
  },

  "Tanner Crab": {
    scientific_name: "Chionoecetes bairdi / C. opilio",
    category: "Crab",
    conversions: {
      "Raw Whole → Raw Sections": { yield: 68, range: [65, 72] },
      "Raw Whole → Cooked Whole": { yield: 92, range: [90, 95] },
      "Raw Whole → Cooked Sections": { yield: 60, range: [58, 66] },
      "Raw Whole → Cooked Meat": { yield: 17, range: [15, 21] },
      "Raw Sections → Cooked Sections": { yield: 88, range: null },
      "Cooked Whole → Cooked Meat": { yield: 19, range: null },
      "Cooked Sections → Cooked Meat": { yield: 28, range: null }
    }
  },

  // ============ SHRIMP ============
  "Pink Shrimp": {
    scientific_name: "Pandalus sp.",
    category: "Shrimp",
    conversions: {
      "Raw Whole → Raw Headless": { yield: 53, range: null },
      "Raw Whole → Cooked Whole": { yield: 90, range: null },
      "Raw Whole → Raw Peeled": { yield: 36, range: null },
      "Raw Whole → Cooked Peeled": { yield: 25, range: null },
      "Raw Headless → Cooked Peeled": { yield: 69, range: null },
      "Cooked Whole → Cooked Peeled": { yield: 28, range: null }
    }
  },

  "Spot Shrimp": {
    scientific_name: "Pandalus platyceros",
    category: "Shrimp",
    conversions: {
      "Raw Whole → Raw Headless": { yield: 47, range: [45, 49] },
      "Raw Whole → Cooked Whole": { yield: 90, range: null },
      "Raw Whole → Raw Peeled": { yield: 34, range: [30, 38] },
      "Raw Whole → Cooked Peeled": { yield: 26, range: null },
      "Raw Headless → Raw Peeled": { yield: 72, range: null },
      "Cooked Whole → Cooked Peeled": { yield: 29, range: null }
    }
  },

  // ============ SHELLFISH - CLAMS ============
  "Softshell Clams": {
    scientific_name: "Mya sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 57, range: [53, 62] }
    }
  },

  "Macoma Clams": {
    scientific_name: "Macoma sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 53, range: [45, 59] }
    }
  },

  "Cockles": {
    scientific_name: "Clinocardium sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 42, range: [38, 48] }
    }
  },

  "Littleneck Clams": {
    scientific_name: "Protothaca sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 37, range: [31, 46] }
    }
  },

  "Geoduck Clams": {
    scientific_name: "Panope sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 33, range: [32, 35] },
      "Whole → Steaks": { yield: 22, range: [20, 25] },
      "Whole → Necks": { yield: 12, range: [9, 14] }
    }
  },

  "Razor Clams": {
    scientific_name: "Siliqua sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 44, range: [42, 50] }
    }
  },

  "Butter Clams": {
    scientific_name: "Saxidomus sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 45, range: [38, 46] }
    }
  },

  // ============ SHELLFISH - OTHER ============
  "Mussels": {
    scientific_name: "Mytilus sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meat (wild)": { yield: 26, range: [19, 32] },
      "Whole → Edible Meat (cultured)": { yield: 20, range: [11, 27] },
      "Whole → Steamed": { yield: 14, range: [10, 18] }
    }
  },

  "Oysters": {
    scientific_name: "Crassostrea sp.",
    category: "Shellfish",
    conversions: {
      "Raw Whole → Raw Meats": { yield: 10, range: [5, 14] }, // ⚠️ UNCERTAIN - wide range
      "Raw Meats → Cooked Meats": { yield: 61, range: null }
    }
  },

  "Scallops": {
    scientific_name: "Chlamys sp. / Hinnites sp. / Pecten sp.",
    category: "Shellfish",
    conversions: {
      "Raw Whole → Adductor Muscle": { yield: 10, range: [8, 12] },
      "Raw Whole → Viscera": { yield: 22, range: [20, 26] },
      "Raw Meats → Cooked Meats": { yield: 50, range: null }
    }
  },

  "Snails": {
    scientific_name: "Neptunea sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 28, range: [27, 31] }
    }
  },

  "Abalone (Pinto)": {
    scientific_name: "Haliotis kamtschatkana",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Muscle": { yield: 42, range: [40, 45] },
      "Whole → Meat": { yield: 25, range: null },
      "Whole → Trimming": { yield: 16, range: null },
      "Whole → Dried Muscle": { yield: 10, range: null }
    }
  },

  // ============ CEPHALOPODS ============
  "Squid": {
    scientific_name: "Loligo sp.",
    category: "Shellfish",
    conversions: {
      "Whole → Edible Meats": { yield: 71, range: [64, 73] },
      "Whole → Mantle w/Fins": { yield: 52, range: [45, 55] },
      "Whole → Mantle w/o Fins": { yield: 39, range: [36, 42] },
      "Whole → Tentacles": { yield: 17, range: [13, 20] },
      "Whole → Fins": { yield: 12, range: [10, 13] }
    }
  },

  "Octopus": {
    scientific_name: "Octopus dofleini",
    category: "Shellfish",
    conversions: {
      "Whole → Gutted/Skin-On": { yield: 80, range: [80, 85] },
      "Whole → Gutted/Skinned": { yield: 65, range: null },
      "Whole → Viscera": { yield: 20, range: null }
    }
  },

  // ============ OTHER MARINE ============
  "Sea Cucumber": {
    scientific_name: "Cucumaria sp.",
    category: "Other",
    conversions: {
      "Whole → Eviscerated Meat": { yield: 36, range: null },
      "Whole → Edible Meat": { yield: 25, range: null },
      "Whole → Cooked Meat": { yield: 13, range: null },
      "Whole → Dried Meat": { yield: 5, range: null }
    }
  },

  "Sea Urchin (Green)": {
    scientific_name: "Strongylocentrotus sp.",
    category: "Other",
    conversions: {
      "Round → Roe": { yield: 17, range: [5, 30] } // ⚠️ UNCERTAIN - very wide range
    }
  },

  "Sea Urchin (Red)": {
    scientific_name: "Strongylocentrotus sp.",
    category: "Other",
    conversions: {
      "Round → Roe": { yield: 19, range: [8, 30] } // ⚠️ UNCERTAIN - very wide range
    }
  },

  "Skates": {
    scientific_name: "Raja sp.",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 90, range: [75, 95] },
      "Round → D/H-Off": { yield: 39, range: null },
      "Round → Wings": { yield: 23, range: [20, 23] }
    }
  },

  "Sculpin": {
    scientific_name: "Enophrys sp. / Hemilepidotus sp.",
    category: "Other",
    conversions: {
      "Round → D/H-On": { yield: 80, range: [75, 87] },
      "Round → D/H-Off": { yield: 39, range: [25, 51] },
      "Round → Skinless Fillet": { yield: 24, range: [20, 41] }
    }
  }
};

// ============ UNCERTAIN DATA FLAGS ============
export const UNCERTAIN_DATA = [
  { species: "Pacific Hake", field: "Roe range", note: "Range reconstructed from partial OCR data" },
  { species: "American Shad", field: "Roe range", note: "Range approximated from PDF scan" },
  { species: "Oysters", field: "Raw Meats yield", note: "Very wide range (5-14%) in source data" },
  { species: "Sea Urchin (Green)", field: "Roe range", note: "Very wide range (5-30%) - varies with season" },
  { species: "Sea Urchin (Red)", field: "Roe range", note: "Very wide range (8-30%) - varies with season" }
];

export const PROCESSING_DATA = {
  "Fish Meal": {
    scientific_name: "Various species",
    category: "Other",
    conversions: {
      "Lean Fish → Meal": { yield: 18, range: [16, 20] },
      "Fatty Fish → Meal": { yield: 22, range: [20, 25] }
    }
  }
};

// ============ EXPORT LEGACY FORMAT ============
// Calculator expects: FISH_DATA[species].conversions[label] = { from, to, yield, range }
export const FISH_DATA = {};
Object.entries(FISH_DATA_V3).forEach(([species, data]) => {
  FISH_DATA[species] = {
    scientific_name: data.scientific_name,
    category: data.category,
    conversions: {}
  };
  Object.entries(data.conversions).forEach(([convKey, conv]) => {
    const parts = convKey.split(" → ");
    const from = parts[0];
    const to = parts[1];
    const fromLabel = from !== "Round" && from !== "Whole" && from !== "Raw Whole" ? `From ${from}: ` : "";
    const label = `${fromLabel}${to}`;
    FISH_DATA[species].conversions[label] = {
      yield: String(conv.yield),
      range: conv.range ? `${conv.range[0]}-${conv.range[1]}` : null,
      from: from,
      to: to
    };
  });
});

export const PROFILES_DATA = {
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

export default { FISH_DATA, FISH_DATA_V3, PROCESSING_DATA, ACRONYMS, PROFILES_DATA, DATA_SOURCE, UNCERTAIN_DATA };
