/**
 * names.js — what the calculator calls a form of fish, on a tile and in the middle of a sentence.
 *
 * Plain words first and the trade code second (`plainFormName`). One extra case lives here: a
 * person's own yields are stored without a starting form, and the merged data files them under
 * "Custom". The style guide's word for that is "your yield", never "custom".
 */
import { plainFormName } from '../../lib/formNames';

/** The `from` the merged data gives a person's own yields (see fishDataMerge.js). */
export const YOUR_YIELDS_FROM = 'Custom';

/** Where the bundled reference yields come from: Marine Advisory Bulletin No. 37. */
export const REFERENCE_SOURCE = 'MAB-37';

/**
 * The name to show on a tile.
 *
 * @param {string} code — a `from` or `to` of a conversion
 * @returns {{name: string, code: string|null}}
 */
export function tileName(code) {
  if (code === YOUR_YIELDS_FROM) return { name: 'Your yields', code: null };
  return plainFormName(code);
}

// "Skinless fillet" → "skinless fillet"; "D/H-Off" and "SIB Trim" keep their capitals
const lowerFirst = (words) => (/^[A-Z][a-z]/.test(words) ? words[0].toLowerCase() + words.slice(1) : words);

/**
 * The name for the middle of a sentence: "per lb of whole fish".
 *
 * @param {string} code — a `from` or `to` of a conversion
 * @param {string} fallback — what to say before anything is chosen
 * @returns {string}
 */
export function nameInSentence(code, fallback) {
  if (!code) return fallback;
  if (code === YOUR_YIELDS_FROM) return 'the fish you start with';
  return lowerFirst(plainFormName(code).name) || fallback;
}
