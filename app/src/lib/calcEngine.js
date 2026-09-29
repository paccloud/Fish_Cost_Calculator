/**
 * calcEngine.js — Pure calculation module for fish yield cost math.
 *
 * Pure function: inputs object in, result object out.
 * No React, no I/O, no hidden state.
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
