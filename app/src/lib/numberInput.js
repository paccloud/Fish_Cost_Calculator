/**
 * numberInput.js — read a number the way people type it into a price, weight or yield box.
 *
 * The calculator's fields are text inputs (so a "$" or "lbs" can sit beside the number), which means
 * they accept anything. parseFloat alone gets common entries silently wrong: "$4.50" → NaN, and
 * "1,000" → 1. This reads what people actually type and returns NaN for anything it can't be sure
 * of, so the UI can ask for a number instead of showing a wrong answer.
 */

// "$" in front; "%", "lb" or "lbs" behind
const DECORATION = /^\$\s*|\s*(%|lbs?)$/gi;

/**
 * @param {string|number|null|undefined} raw
 * @returns {number} the amount, or NaN when the text is not a plain non-negative number
 */
export function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : NaN;
  const text = String(raw ?? '').trim().replace(DECORATION, '');

  if (/^\d+,\d{1,2}$/.test(text)) return Number(text.replace(',', '.')); // decimal comma: 4,50
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)) return Number(text.replace(/,/g, '')); // thousands: 1,000.5
  if (/^(\d+\.?\d*|\.\d+)$/.test(text)) return Number(text); // plain: 4, 4.5, 4., .5
  return NaN;
}
