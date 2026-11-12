/**
 * priceCard.js — a price as a few lines of plain text, for the share sheet or the clipboard.
 *
 * Plain text only: no markdown and no emoji, so it reads the same in Messages, WhatsApp, an email
 * or a note. It follows the style guide's voice: money has two decimals and a unit ($9.78/lb),
 * yields are written "46% yield", and ranges use an en dash.
 *
 * A line whose value is missing is left out, and nothing is ever printed as $NaN, or as $0.00
 * because a box was empty. What was paid for the fish is left out unless it is asked for: the card
 * is often going to a buyer.
 *
 * @module priceCard
 */

const EN_DASH = '–';
const PLAIN_NUMBER = /^(\d+\.?\d*|\.\d+)$/;

// A finite number, or text that is nothing but one. Anything else is null.
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && PLAIN_NUMBER.test(value.trim())) return Number(value.trim());
  return null;
}

function positive(value) {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// "Skinless fillet" → "skinless fillet" for the middle of a line; "D/H-Off" and "SIB Trim" stay
function lowerFirst(words) {
  return /^[A-Z][a-z]/.test(words) ? words[0].toLowerCase() + words.slice(1) : words;
}

// Whole numbers stay whole and a typed decimal is kept (46.5), without float noise
function round2(n) {
  return Number(n.toFixed(2));
}

/**
 * Dollars with two decimals: 9.7826 → "$9.78", 1234.5 → "$1,234.50", -4.5 → "-$4.50".
 * Rounds the way the on-screen price does (toFixed).
 *
 * @param {number|string} n — a finite number, or text that is nothing but a number ("9.78")
 * @returns {string} '' when `n` is not a number, so a missing amount never prints as "$NaN"
 */
export function formatMoney(n) {
  const value = toNumber(n);
  if (value === null) return '';
  const [whole, decimals] = Math.abs(value).toFixed(2).split('.');
  // From 1e21 up toFixed switches to exponent notation, which has no cents to print
  if (decimals === undefined) return '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const roundsToZero = Number(whole) === 0 && Number(decimals) === 0;
  return `${value < 0 && !roundsToZero ? '-' : ''}$${grouped}.${decimals}`;
}

// An amount worth printing: above 0 and not rounding down to $0.00. '' otherwise.
function price(value) {
  const n = positive(value);
  return n !== null && round2(n) > 0 ? formatMoney(n) : '';
}

// A percentage worth printing, within [min, max] after rounding. '' otherwise.
function percent(value, { min, max, minExclusive = false, maxExclusive = false }) {
  const n = toNumber(value);
  if (n === null) return '';
  const shown = round2(n);
  if (shown < min || (minExclusive && shown === min)) return '';
  if (shown > max || (maxExclusive && shown === max)) return '';
  return `${shown}%`;
}

/**
 * @typedef {Object} PriceCardInput
 * @property {string} [species] — e.g. "Sockeye Salmon"
 * @property {string} [fromName] — plain name of the starting form, e.g. "Whole fish"
 * @property {string} [productName] — plain name of the product, e.g. "Skinless fillet"
 * @property {number} costPerLb — finished cost per lb. Without it there is no card.
 * @property {number} [yieldPct] — yield used, as a percentage above 0 and up to 100
 * @property {number} [sellPrice] — selling price per lb
 * @property {number} [marginPct] — margin behind the selling price, from 0 up to but not including 100
 * @property {{ounces: number, cost: number}} [portion] — portion size and what it costs
 * @property {{low: number, high: number}} [range] — cost per lb across the yield range
 * @property {boolean} [includePurchasePrice=false] — show what was paid for the fish
 * @property {number} [purchasePrice] — what was paid per lb for the starting form
 */

/**
 * Build the card. For the hand-worked Sockeye example, with everything given:
 *
 *   Sockeye Salmon, skinless fillet: $9.78/lb
 *   From whole fish at 46% yield
 *   Range: $9.18–$10.98/lb
 *   Sell price: $15.05/lb at a 35% margin
 *   6 oz portion: $3.67
 *   Paid: $4.50/lb          (only with includePurchasePrice)
 *
 * Numbers may be finite numbers or text that is nothing but a number; anything else counts as
 * missing and its line is left out.
 *
 * @param {PriceCardInput} card
 * @returns {string} lines joined with "\n"; '' when there is no cost per lb to show
 */
export function buildPriceCard(card) {
  const {
    species,
    fromName,
    productName,
    costPerLb,
    yieldPct,
    sellPrice,
    marginPct,
    portion,
    range,
    includePurchasePrice = false,
    purchasePrice,
  } = card ?? {};

  const cost = price(costPerLb);
  if (!cost) return '';

  const lines = [];

  const fish = text(species);
  const product = text(productName);
  const what = [fish, fish ? lowerFirst(product) : product].filter(Boolean).join(', ');
  lines.push(`${what ? `${what}: ` : ''}${cost}/lb`);

  const from = lowerFirst(text(fromName));
  const yieldText = percent(yieldPct, { min: 0, minExclusive: true, max: 100 });
  if (from && yieldText) lines.push(`From ${from} at ${yieldText} yield`);
  else if (from) lines.push(`From ${from}`);
  else if (yieldText) lines.push(`${yieldText} yield`);

  const low = price(Math.min(positive(range?.low) ?? NaN, positive(range?.high) ?? NaN));
  const high = price(Math.max(positive(range?.low) ?? NaN, positive(range?.high) ?? NaN));
  // A range that rounds to one price says nothing the first line has not said
  if (low && high && low !== high) lines.push(`Range: ${low}${EN_DASH}${high}/lb`);

  const sell = price(sellPrice);
  if (sell) {
    const marginText = percent(marginPct, { min: 0, max: 100, maxExclusive: true });
    lines.push(`Sell price: ${sell}/lb${marginText ? ` at a ${marginText} margin` : ''}`);
  }

  const ounces = positive(portion?.ounces);
  const portionPrice = price(portion?.cost);
  if (ounces !== null && round2(ounces) > 0 && portionPrice) {
    lines.push(`${round2(ounces)} oz portion: ${portionPrice}`);
  }

  const paid = price(purchasePrice);
  if (includePurchasePrice === true && paid) lines.push(`Paid: ${paid}/lb`);

  return lines.join('\n');
}
