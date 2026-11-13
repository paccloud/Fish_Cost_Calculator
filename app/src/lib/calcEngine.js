/**
 * calcEngine.js — Pure calculation module for fish yield cost math.
 *
 * Pure functions: inputs in, result out.
 * No React, no I/O, no hidden state.
 *
 *   calculate         — finished cost per lb, or lbs to buy
 *   costAcrossYields  — that cost at both ends of a yield range
 *   sellPriceAtMargin — what to charge for a given margin
 *   portionCost       — what one portion costs
 *
 * Domain vocabulary:
 *   Round    — whole, un-processed fish
 *   D/H-On   — dressed/head-on (gutted, head attached)
 *   D/H-Off  — dressed/head-off (gutted, head removed)
 *   S/B, SIB — skinless/boneless fillet
 *   yield    — percentage of input weight that becomes output product
 *   range    — [min, max] yield percentages from research data
 *   conversion — one Round-to-product processing step with a yield and range
 *
 * @module calcEngine
 */

/**
 * @typedef {Object} ProcessingStep
 * @property {number|string} timeMinutes   — minutes of labor per pound processed
 * @property {number|string} laborCostPerHour — labor rate in $/hr
 */

/**
 * @typedef {Object} PriceBreak
 * @property {number} minQty   — minimum quantity (lbs) to qualify for this tier
 * @property {number} discount — percentage discount (0–100) applied at this tier
 */

/**
 * @typedef {Object} CalcInputs
 * @property {'cost'|'weight'} mode
 *   'cost'   — compute $/lb of finished product given $/lb of raw input
 *   'weight' — compute lbs of Round needed to achieve a target finished weight
 *
 * @property {number|string} yieldPercent
 *   Yield as a percentage (e.g. 42 for 42%). Falsy or 0 falls back to 100.
 *   NOTE: zero is falsy in JS; passing 0 is treated as "no yield specified" and
 *   falls back to 100% — this preserves the original Calculator.jsx behavior.
 *
 * --- weight-mode inputs ---
 * @property {number|string} [targetWeight=0]
 *   Target finished weight in lbs (weight mode only).
 *
 * --- cost-mode inputs ---
 * @property {number|string} [cost=0]
 *   $/lb of raw input (Round weight).
 * @property {number|string} [processingCost=0]
 *   $/lb processing charge, applied to either incoming or outgoing weight.
 * @property {'incoming'|'outgoing'} [weightType='incoming']
 *   'incoming' — processingCost is divided by yield (applied to Round lbs)
 *   'outgoing' — processingCost is added directly (applied to finished-product lbs)
 * @property {number|string} [coldStorage=0]   $/lb cold-storage addend (finished-product basis)
 * @property {number|string} [shipping=0]      $/lb shipping charge, applied to either incoming or outgoing weight.
 * @property {'incoming'|'outgoing'} [shippingWeightType='outgoing']
 *   'incoming' — shipping the starting fish; divided by yield like incoming processing
 *   'outgoing' — shipping the finished product; added directly
 *
 * @property {boolean} [showTimeTracking=false]
 *   When true, labor costs from processingSteps are summed and added per lb.
 * @property {ProcessingStep[]} [processingSteps=[]]
 *   Each step contributes (timeMinutes/60) * laborCostPerHour to the per-lb cost.
 *
 * @property {boolean} [showEconomyOfScale=false]
 *   When true (and quantity is truthy), bulk discount tiers are evaluated.
 * @property {number|string} [quantity='']
 *   Total purchase quantity in lbs. Evaluated only when showEconomyOfScale is true.
 * @property {PriceBreak[]} [priceBreaks=[]]
 *   Array of discount tiers. The highest qualifying tier is selected.
 */

/**
 * @typedef {Object} CalcResult
 * @property {number} result
 *   cost mode: $/lb of finished product
 *   weight mode: lbs of Round needed
 * @property {number} appliedDiscount
 *   Percentage discount applied (0 when none). Always 0 in weight mode.
 * @property {{fish: number, processing: number, shipping: number, coldStorage: number, labor: number}|null} breakdown
 *   What each part adds per lb of finished product, before any discount (the parts sum to the
 *   undiscounted result). null in weight mode.
 */

/**
 * Calculate fish yield cost or required Round weight.
 *
 * @param {CalcInputs} inputs
 * @returns {CalcResult}
 */
export function calculate(inputs) {
  const {
    mode,
    yieldPercent,
    targetWeight = 0,
    cost = 0,
    processingCost = 0,
    weightType = 'incoming',
    coldStorage = 0,
    shipping = 0,
    shippingWeightType = 'outgoing',
    showTimeTracking = false,
    processingSteps = [],
    showEconomyOfScale = false,
    quantity = '',
    priceBreaks = [],
  } = inputs;

  // Mirrors (parseFloat(yieldPercent) || 100) / 100 from Calculator.jsx.
  // Zero is falsy in JS, so yieldPercent=0 falls back to 100% — preserved as-is.
  const y = (parseFloat(yieldPercent) || 100) / 100;

  // ---------- weight mode ----------
  if (mode === 'weight') {
    const target = parseFloat(targetWeight) || 0;
    return {
      result: y > 0 ? target / y : 0,
      appliedDiscount: 0,
      breakdown: null,
    };
  }

  // ---------- cost mode ----------
  const c = parseFloat(cost) || 0;
  const proc = parseFloat(processingCost) || 0;
  const cold = parseFloat(coldStorage) || 0;
  const ship = parseFloat(shipping) || 0;

  // A per-lb charge on incoming (starting) weight is spread over fewer finished pounds, so it is
  // divided by yield; a charge on outgoing (finished) weight is added as-is.
  const perFinishedLb = (amount, basis) => (basis === 'incoming' ? amount / y : amount);

  // Labor / time-tracking costs: summed across steps, added per lb
  let labor = 0;
  if (showTimeTracking) {
    processingSteps.forEach(step => {
      const time = parseFloat(step.timeMinutes) || 0;
      const laborRate = parseFloat(step.laborCostPerHour) || 0;
      labor += (time / 60) * laborRate;
    });
  }

  const breakdown = {
    fish: c / y,
    processing: perFinishedLb(proc, weightType),
    shipping: perFinishedLb(ship, shippingWeightType),
    coldStorage: cold, // finished-product basis
    labor,
  };
  let baseRes = breakdown.fish + breakdown.processing + breakdown.shipping + breakdown.coldStorage + breakdown.labor;

  // Economy-of-scale discount: find highest qualifying tier
  let appliedDiscount = 0;
  if (showEconomyOfScale && quantity) {
    const qty = parseFloat(quantity) || 0;
    const sortedBreaks = [...priceBreaks].sort((a, b) => b.minQty - a.minQty);
    for (const pb of sortedBreaks) {
      if (qty >= pb.minQty) {
        appliedDiscount = pb.discount;
        break;
      }
    }
  }

  if (appliedDiscount > 0) {
    baseRes = baseRes * (1 - appliedDiscount / 100);
  }

  return { result: baseRes, appliedDiscount, breakdown };
}

// ---------------------------------------------------------------------------
// What the price means: across the yield range, at a margin, per portion.
//
// `calculate` never refuses: text it cannot read counts as 0 and a missing yield counts as 100%,
// and the screen decides whether to show the answer. The helpers below have no screen in front of
// them, so they refuse instead. Each returns null when it cannot stand behind the number, and
// never NaN, Infinity or a zero that only means "nothing was typed". A wrong price is worse than
// none.
// ---------------------------------------------------------------------------

const PLAIN_NUMBER = /^(\d+\.?\d*|\.\d+)$/;

/**
 * A finite number, or text that is nothing but one ("4.50", "46"). Anything else is null, so
 * "$4.50", "1,000" and "" are never guessed at. Read typed text with parseAmount first.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && PLAIN_NUMBER.test(value.trim())) return Number(value.trim());
  return null;
}

/** A yield is a percentage above 0 and up to 100 (CONTEXT.md). */
function toYieldPercent(value) {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 && n <= 100 ? n : null;
}

// An optional per-lb charge left blank (undefined, null, '' or the NaN parseAmount gives for an
// empty box) counts as 0, exactly as in `calculate`. One that is filled in but is not a plain
// non-negative number would be dropped silently by `calculate`, so it is refused here.
function isBlankOrAmount(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  const n = toFiniteNumber(value);
  return n !== null && n >= 0;
}

/**
 * Finished cost per lb at both ends of a yield range.
 *
 * Runs the same `calculate` path twice with only the yield changed, so the processing and shipping
 * basis, cold storage, labor and any bulk discount are honoured at each end.
 *
 * @param {CalcInputs} inputs — cost-mode inputs, as passed to `calculate`. `yieldPercent` is ignored.
 * @param {[number, number]|null|undefined} range — [lowYield, highYield] in percent, as in the
 *   `range` of a conversion in fish_data_v3.js. Given backwards, it is read the right way round.
 * @returns {{low: number, high: number}|null}
 *   `low` is the cost at the HIGH yield (the fish cut well: cheapest); `high` is the cost at the
 *   LOW yield (it cut badly: dearest). null when there is no range, when either bound is not a
 *   yield above 0 and up to 100, in weight mode, when the price paid is missing or not a
 *   non-negative number, when a processing, shipping or cold-storage charge is filled in with
 *   something that is not one, or when either end does not come out as a finite cost above 0.
 */
export function costAcrossYields(inputs, range) {
  if (!inputs || typeof inputs !== 'object' || inputs.mode === 'weight') return null;
  if (!Array.isArray(range) || range.length !== 2) return null;

  const first = toYieldPercent(range[0]);
  const second = toYieldPercent(range[1]);
  if (first === null || second === null) return null;

  const paid = toFiniteNumber(inputs.cost);
  if (paid === null || paid < 0) return null;
  if (![inputs.processingCost, inputs.shipping, inputs.coldStorage].every(isBlankOrAmount)) return null;

  const costAt = (yieldPercent) => {
    const { result } = calculate({ ...inputs, yieldPercent });
    return Number.isFinite(result) && result > 0 ? result : null;
  };
  const low = costAt(Math.max(first, second));
  const high = costAt(Math.min(first, second));
  return low === null || high === null ? null : { low, high };
}

/**
 * The selling price per lb that leaves a given margin.
 *
 * Margin is on the selling price, the way a seafood counter or a kitchen quotes it:
 * price = cost / (1 - margin / 100). A 35% margin on a $9.78 cost is $15.05, not $13.20 (which
 * would be a 35% markup on cost).
 *
 * @param {number|string} costPerLb — finished cost per lb; must be above 0
 * @param {number|string} marginPct — margin as a percentage, from 0 up to but not including 100
 * @returns {number|null} null unless both are plain finite numbers in those bounds
 */
export function sellPriceAtMargin(costPerLb, marginPct) {
  const cost = toFiniteNumber(costPerLb);
  const margin = toFiniteNumber(marginPct);
  if (cost === null || cost <= 0) return null;
  if (margin === null || margin < 0 || margin >= 100) return null;
  const price = cost / (1 - margin / 100);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * What one portion costs: cost per lb × ounces / 16.
 *
 * @param {number|string} costPerLb — finished cost per lb; must be above 0
 * @param {number|string} ounces — portion size in ounces; must be above 0
 * @returns {number|null} null unless both are plain finite numbers above 0
 */
export function portionCost(costPerLb, ounces) {
  const cost = toFiniteNumber(costPerLb);
  const oz = toFiniteNumber(ounces);
  if (cost === null || cost <= 0) return null;
  if (oz === null || oz <= 0) return null;
  const portion = (cost * oz) / 16;
  return Number.isFinite(portion) && portion > 0 ? portion : null;
}
