/**
 * The app's reference data.
 *
 * The yields are in mab37_yields.js, which is generated from the bulletin as re-read
 * (research/mab37/). This file adds what the bulletin does not hold: the legend, the
 * source citation, the list of doubtful values and the seafood profiles.
 */
import { MAB37_YIELDS } from './mab37_yields.js';

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
  "Kurimi": "As the bulletin prints it; probably kirimi, a headed, gutted, tail-off cut"
};

// Reference yields: "Species": { scientific_name, category, conversions: { "From → To": { yield, range, row, note?, caution? } } }
export const FISH_DATA_V3 = MAB37_YIELDS;

// ============ DOUBTFUL VALUES ============
// Every value here is what the bulletin prints. These are the ones that still look wrong, with why.
export const UNCERTAIN_DATA = Object.entries(MAB37_YIELDS).flatMap(([species, data]) =>
  Object.entries(data.conversions)
    .filter(([, conv]) => conv.caution)
    .map(([field, conv]) => ({ species, field, note: conv.caution, row: conv.row }))
);

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
  },
  "Tuna, Albacore": {
    description: "Mild, light-colored flesh with a firm texture. Often called 'white tuna' when canned.",
    culinary_uses: "Excellent grilled, seared, or canned. Popular for sashimi when fresh.",
    edible_portions: "Steaks, loins, and fillets."
  }
};

export default { FISH_DATA_V3, PROCESSING_DATA, ACRONYMS, PROFILES_DATA, DATA_SOURCE, UNCERTAIN_DATA };
