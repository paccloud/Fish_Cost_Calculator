/**
 * formNames.js — say a form of fish the way a person says it across a cutting table.
 *
 * The yield data names forms in trade codes ("Round", "D/H-On"). The style guide's rule is plain
 * words first, trade code second: never make someone decode an acronym, and never drop the code
 * either, because buyers quote it.
 *
 * Every starting form and product in fish_data_v3.js is listed below (formNames.test.js checks
 * that none is missed). Names are sentence case. Where a term's meaning was not certain it keeps
 * its own words, only re-cased: nothing here guesses what a cut is.
 *
 * "SIB" is how the data set spells the source's "S/B" (skinless/boneless, per ACRONYMS). It is
 * shown as the data has it.
 *
 * @module formNames
 */

/**
 * [text in the data, plain name, keep the trade code as a second line?]
 * The code is kept when the plain name replaces a code or an abbreviation a buyer would quote.
 */
const FORMS = [
  // Starting forms
  ['Round', 'Whole fish', true],
  ['D/H-On', 'Gutted, head on', true],
  ['D/H-Off', 'Gutted, head off', true],
  ['D/H-On (Thawed)', 'Gutted, head on, thawed', true],
  ['D/H-Off (Thawed)', 'Gutted, head off, thawed', true],
  ['D/H-Off (Eastern)', 'Gutted, head off, Eastern cut', true],
  ['Whole', 'Whole', false],
  ['Raw Whole', 'Raw whole', false],
  ['Cooked Whole', 'Cooked whole', false],
  ['Raw Sections', 'Raw sections', false],
  ['Cooked Sections', 'Cooked sections', false],
  ['Raw Headless', 'Raw headless', false],
  ['Raw Meats', 'Raw meats', false],
  ['Trim', 'Trim', false],

  // Fillets
  ['Skin-On Fillet', 'Skin-on fillet', false],
  ['Skin-On Fillets', 'Skin-on fillets', false],
  ['Skin-On Fillet (Hand)', 'Skin-on fillet, hand cut', false],
  ['Skin-On Fillet (Machine)', 'Skin-on fillet, machine cut', false],
  ['Skin-On Fillets (V-cut)', 'Skin-on fillets, V-cut', false],
  ['Skinless Fillet', 'Skinless fillet', false],
  ['Skinless Fillets', 'Skinless fillets', false],
  ['Skinless Fillet (Fletch)', 'Skinless fillet (fletch)', false],
  ['Skinless Fillets (V-cut)', 'Skinless fillets, V-cut', false],
  ['Skinless Fillets (J-cut)', 'Skinless fillets, J-cut', false],
  ['SIB Fillet (V-Cut)', 'Skinless, boneless fillet, V-cut', true],
  ['SIB Fillet (Pinboning)', 'Skinless, boneless fillet, pin-boned', true],
  ['SIB Fillets', 'Skinless, boneless fillets', true],
  ['SIB Fillets (V-cut)', 'Skinless, boneless fillets, V-cut', true],
  ['SIB Fillets (J-cut)', 'Skinless, boneless fillets, J-cut', true],
  ['SIB Trim', 'Skinless, boneless trim', true],

  // Other cuts and parts of a fish
  ['Steaks', 'Steaks', false],
  ['Roasts', 'Roasts', false],
  ['Belly Flaps', 'Belly flaps', false],
  ['Roe', 'Roe', false],
  ['Liver', 'Liver', false],
  ['Viscera', 'Viscera', false],
  ['Trunk', 'Trunk', false],
  ['Fins', 'Fins', false],
  ['Tails and Fins', 'Tails and fins', false],
  ['Backs', 'Backs', false],
  ['Wings', 'Wings', false],
  ['Skin-On Flesh', 'Skin-on flesh', false],
  ['Edible Portion', 'Edible portion', false],

  // Cured, smoked, canned and minced
  ['Canned', 'Canned', false],
  ['Smoked', 'Smoked', false],
  ['Smoked Sides', 'Smoked sides', false],
  ['Smoked Fillets', 'Smoked fillets', false],
  ['Smoked D/H-Off', 'Smoked, gutted, head off', true],
  ['Salted', 'Salted', false],
  ['Salted Round', 'Salted whole fish', true],
  ['Salted Fillets', 'Salted fillets', false],
  ['Salted D/H-Off', 'Salted, gutted, head off', true],
  ['Dry-Salt Sides', 'Dry-salt sides', false],
  ['Mild Cure Sides', 'Mild cure sides', false],
  ['Mince', 'Mince', false],
  ['Surimi', 'Surimi', false],
  ['Surimi (Traditional)', 'Surimi (traditional)', false],
  ['Surimi (Decanter)', 'Surimi (decanter)', false],
  ['Kurimi', 'Kurimi', false],

  // Crab, shrimp and other shellfish
  ['Cooked Meat', 'Cooked meat', false],
  ['Cooked Meats', 'Cooked meats', false],
  ['Raw Peeled', 'Raw, peeled', false],
  ['Cooked Peeled', 'Cooked, peeled', false],
  ['Edible Meat', 'Edible meat', false],
  ['Edible Meats', 'Edible meats', false],
  ['Edible Meat (wild)', 'Edible meat (wild)', false],
  ['Edible Meat (cultured)', 'Edible meat (cultured)', false],
  ['Steamed', 'Steamed', false],
  ['Necks', 'Necks', false],
  ['Adductor Muscle', 'Adductor muscle', false],
  ['Edible Muscle', 'Edible muscle', false],
  ['Dried Muscle', 'Dried muscle', false],
  ['Meat', 'Meat', false],
  ['Trimming', 'Trimming', false],
  ['Mantle w/Fins', 'Mantle with fins', false],
  ['Mantle w/o Fins', 'Mantle without fins', false],
  ['Tentacles', 'Tentacles', false],
  ['Gutted/Skin-On', 'Gutted, skin on', false],
  ['Gutted/Skinned', 'Gutted, skinned', false],
  ['Eviscerated Meat', 'Eviscerated meat', false],
  ['Dried Meat', 'Dried meat', false],
];

// Custom yields are typed by hand, so "round" and " D/H-On " should find the same names.
const lookupKey = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

const BY_KEY = new Map(FORMS.map(([code, name, showCode]) => [lookupKey(code), { name, code: showCode ? code : null }]));

/**
 * @typedef {Object} FormName
 * @property {string} name — the plain name to show first, in sentence case
 * @property {string|null} code — the trade code to show as a second line, or null when the plain
 *   name and the code are the same thing
 */

/**
 * The plain name for a starting form or product, with its trade code when it has one.
 *
 *   plainFormName('Round')           → { name: 'Whole fish', code: 'Round' }
 *   plainFormName('D/H-On')          → { name: 'Gutted, head on', code: 'D/H-On' }
 *   plainFormName('Skinless Fillet') → { name: 'Skinless fillet', code: null }
 *   plainFormName('Collars')         → { name: 'Collars', code: null }   (not known: left alone)
 *
 * Matching ignores letter case and extra spaces. A known code comes back spelled as the data set
 * spells it. Text that is not known comes back unchanged, and anything that is not text comes
 * back as an empty name.
 *
 * @param {string} code — a `from` or `to` of a conversion
 * @returns {FormName}
 */
export function plainFormName(code) {
  if (typeof code !== 'string') return { name: '', code: null };
  const known = BY_KEY.get(lookupKey(code));
  return known ? { ...known } : { name: code, code: null };
}
