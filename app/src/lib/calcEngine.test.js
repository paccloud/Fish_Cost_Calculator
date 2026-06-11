/**
 * calcEngine test suite — table-driven, interface-only.
 *
 * Expected values are derived from the original Calculator.jsx calculate()
 * function, not from running this module. Do not update expected values to
 * match a broken implementation — fix the implementation instead.
 */

import { describe, it, expect } from 'vitest';
import { calculate } from './calcEngine.js';

// Default price-break tiers matching Calculator.jsx DEFAULT_PRICE_BREAKS
const DEFAULT_PRICE_BREAKS = [
  { minQty: 100, discount: 5 },
  { minQty: 500, discount: 10 },
  { minQty: 1000, discount: 15 },
];

// ---------------------------------------------------------------------------
// Cost mode — basic yield math
// ---------------------------------------------------------------------------

describe('calculate — cost mode', () => {
  const cases = [
    {
      label: '42% yield: $2/lb Round → $4.76/lb finished',
      inputs: { mode: 'cost', yieldPercent: 42, cost: 2 },
      expected: { result: 4.761904761904762, appliedDiscount: 0 },
    },
    {
      label: '100% yield: cost passes through unchanged',
      inputs: { mode: 'cost', yieldPercent: 100, cost: 3.5 },
      expected: { result: 3.5, appliedDiscount: 0 },
    },
    {
      label: '91% yield: $2/lb Round (D/H-On typical)',
      inputs: { mode: 'cost', yieldPercent: 91, cost: 2 },
      expected: { result: 2 / 0.91, appliedDiscount: 0 },
    },
  ];

  cases.forEach(({ label, inputs, expected }) => {
    it(label, () => {
      const actual = calculate(inputs);
      expect(actual.result).toBeCloseTo(expected.result, 10);
      expect(actual.appliedDiscount).toBe(expected.appliedDiscount);
    });
  });
});

// ---------------------------------------------------------------------------
// Weight mode — Round input weight from target finished weight
// ---------------------------------------------------------------------------

describe('calculate — weight mode', () => {
  const cases = [
    {
      label: '100 lbs target at 42% yield → 238.1 lbs Round needed',
      inputs: { mode: 'weight', yieldPercent: 42, targetWeight: 100 },
      expected: { result: 238.0952380952381, appliedDiscount: 0 },
    },
    {
      label: '50 lbs target at 91% yield → ~54.9 lbs Round needed',
      inputs: { mode: 'weight', yieldPercent: 91, targetWeight: 50 },
      expected: { result: 54.94505494505494, appliedDiscount: 0 },
    },
    {
      label: '100 lbs target at 100% yield → 100 lbs Round needed',
      inputs: { mode: 'weight', yieldPercent: 100, targetWeight: 100 },
      expected: { result: 100, appliedDiscount: 0 },
    },
  ];

  cases.forEach(({ label, inputs, expected }) => {
    it(label, () => {
      const actual = calculate(inputs);
      expect(actual.result).toBeCloseTo(expected.result, 10);
      expect(actual.appliedDiscount).toBe(0);
    });
  });

  it('weight mode always returns appliedDiscount=0', () => {
    const actual = calculate({
      mode: 'weight', yieldPercent: 42, targetWeight: 100,
      showEconomyOfScale: true, quantity: '1200', priceBreaks: DEFAULT_PRICE_BREAKS,
    });
    expect(actual.appliedDiscount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Processing cost — incoming vs outgoing weight basis
// ---------------------------------------------------------------------------

describe('calculate — processing cost application', () => {
  const cases = [
    {
      label: 'incoming basis: proc cost divided by yield (added before yield factor)',
      // cost=2, proc=0.50, yield=50%: (2 + 0.50) / 0.5 = 5.00
      inputs: { mode: 'cost', yieldPercent: 50, cost: 2, processingCost: 0.5, weightType: 'incoming' },
      expected: { result: 5, appliedDiscount: 0 },
    },
    {
      label: 'outgoing basis: proc cost added directly to finished-product $/lb',
      // cost=2, proc=0.50, yield=50%: 2/0.5 + 0.50 = 4.50
      inputs: { mode: 'cost', yieldPercent: 50, cost: 2, processingCost: 0.5, weightType: 'outgoing' },
      expected: { result: 4.5, appliedDiscount: 0 },
    },
    {
      label: 'incoming is the default when weightType is omitted',
      inputs: { mode: 'cost', yieldPercent: 50, cost: 2, processingCost: 0.5 },
      expected: { result: 5, appliedDiscount: 0 },
    },
  ];

  cases.forEach(({ label, inputs, expected }) => {
    it(label, () => {
      const actual = calculate(inputs);
      expect(actual.result).toBeCloseTo(expected.result, 10);
      expect(actual.appliedDiscount).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Cold storage and shipping addends
// ---------------------------------------------------------------------------

describe('calculate — cold storage and shipping addends', () => {
  const cases = [
    {
      label: 'cold storage: $0.10/lb added to finished-product cost',
      // cost=2, yield=50%: 2/0.5 + 0.10 = 4.10
      inputs: { mode: 'cost', yieldPercent: 50, cost: 2, coldStorage: 0.1 },
      expected: { result: 4.1, appliedDiscount: 0 },
    },
    {
      label: 'shipping: $0.20/lb added to finished-product cost',
      // cost=2, yield=50%: 2/0.5 + 0.20 = 4.20
      inputs: { mode: 'cost', yieldPercent: 50, cost: 2, shipping: 0.2 },
      expected: { result: 4.2, appliedDiscount: 0 },
    },
    {
      label: 'cold + shipping combined: both added to finished-product cost',
      // cost=2, yield=50%: 2/0.5 + 0.10 + 0.20 = 4.30
      inputs: { mode: 'cost', yieldPercent: 50, cost: 2, coldStorage: 0.1, shipping: 0.2 },
      expected: { result: 4.3, appliedDiscount: 0 },
    },
  ];

  cases.forEach(({ label, inputs, expected }) => {
    it(label, () => {
      const actual = calculate(inputs);
      expect(actual.result).toBeCloseTo(expected.result, 10);
      expect(actual.appliedDiscount).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Labor / time-tracking costs
// ---------------------------------------------------------------------------

describe('calculate — labor time costs', () => {
  const cases = [
    {
      label: 'single step: 2 min/lb at $30/hr → $1/lb',
      // 2/60 * 30 = 1.0; base = 2/0.5 + 1.0 = 5.0
      inputs: {
        mode: 'cost', yieldPercent: 50, cost: 2, showTimeTracking: true,
        processingSteps: [{ timeMinutes: 2, laborCostPerHour: 30 }],
      },
      expected: { result: 5.0, appliedDiscount: 0 },
    },
    {
      label: 'two steps: 1 min/lb@$30 + 3 min/lb@$20 → $1.50/lb labor',
      // step1: 1/60*30=0.5; step2: 3/60*20=1.0; total=1.5; base=2/0.5+1.5=5.5
      inputs: {
        mode: 'cost', yieldPercent: 50, cost: 2, showTimeTracking: true,
        processingSteps: [
          { timeMinutes: 1, laborCostPerHour: 30 },
          { timeMinutes: 3, laborCostPerHour: 20 },
        ],
      },
      expected: { result: 5.5, appliedDiscount: 0 },
    },
    {
      label: 'showTimeTracking=false: steps are ignored even if present',
      inputs: {
        mode: 'cost', yieldPercent: 50, cost: 2, showTimeTracking: false,
        processingSteps: [{ timeMinutes: 60, laborCostPerHour: 100 }],
      },
      expected: { result: 4, appliedDiscount: 0 },
    },
  ];

  cases.forEach(({ label, inputs, expected }) => {
    it(label, () => {
      const actual = calculate(inputs);
      expect(actual.result).toBeCloseTo(expected.result, 10);
      expect(actual.appliedDiscount).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Economy-of-scale tiers
// ---------------------------------------------------------------------------

describe('calculate — economy of scale tiers', () => {
  const base = { mode: 'cost', yieldPercent: 50, cost: 2 };

  const cases = [
    {
      label: 'qty=50 (below all tiers): no discount',
      inputs: { ...base, showEconomyOfScale: true, quantity: '50', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 4, appliedDiscount: 0 },
    },
    {
      label: 'qty=100 (tier 1 boundary): 5% discount',
      inputs: { ...base, showEconomyOfScale: true, quantity: '100', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 4 * 0.95, appliedDiscount: 5 },
    },
    {
      label: 'qty=150 (inside tier 1): 5% discount',
      inputs: { ...base, showEconomyOfScale: true, quantity: '150', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 3.8, appliedDiscount: 5 },
    },
    {
      label: 'qty=500 (tier 2 boundary): 10% discount',
      inputs: { ...base, showEconomyOfScale: true, quantity: '500', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 4 * 0.90, appliedDiscount: 10 },
    },
    {
      label: 'qty=600 (inside tier 2): 10% discount',
      inputs: { ...base, showEconomyOfScale: true, quantity: '600', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 3.6, appliedDiscount: 10 },
    },
    {
      label: 'qty=1000 (tier 3 boundary): 15% discount',
      inputs: { ...base, showEconomyOfScale: true, quantity: '1000', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 4 * 0.85, appliedDiscount: 15 },
    },
    {
      label: 'qty=1200 (inside tier 3): 15% discount',
      inputs: { ...base, showEconomyOfScale: true, quantity: '1200', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 3.4, appliedDiscount: 15 },
    },
    {
      label: 'showEconomyOfScale=false: discount not applied even with qty',
      inputs: { ...base, showEconomyOfScale: false, quantity: '1200', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 4, appliedDiscount: 0 },
    },
    {
      label: 'quantity empty string: no discount',
      inputs: { ...base, showEconomyOfScale: true, quantity: '', priceBreaks: DEFAULT_PRICE_BREAKS },
      expected: { result: 4, appliedDiscount: 0 },
    },
  ];

  cases.forEach(({ label, inputs, expected }) => {
    it(label, () => {
      const actual = calculate(inputs);
      expect(actual.result).toBeCloseTo(expected.result, 10);
      expect(actual.appliedDiscount).toBe(expected.appliedDiscount);
    });
  });
});

// ---------------------------------------------------------------------------
// Yield-range bounds (min / avg / max quick-select)
// ---------------------------------------------------------------------------

describe('calculate — yield range bounds', () => {
  // Range [41, 46] for Pink Salmon Round → Skinless Fillet (avg 42%)
  const cases = [
    {
      label: 'use range min (41%): higher cost per lb',
      inputs: { mode: 'cost', yieldPercent: 41, cost: 2 },
      expected: { result: 2 / 0.41, appliedDiscount: 0 },
    },
    {
      label: 'use range avg (42%): mid cost',
      inputs: { mode: 'cost', yieldPercent: 42, cost: 2 },
      expected: { result: 2 / 0.42, appliedDiscount: 0 },
    },
    {
      label: 'use range max (46%): lower cost per lb',
      inputs: { mode: 'cost', yieldPercent: 46, cost: 2 },
      expected: { result: 2 / 0.46, appliedDiscount: 0 },
    },
  ];

  cases.forEach(({ label, inputs, expected }) => {
    it(label, () => {
      const actual = calculate(inputs);
      expect(actual.result).toBeCloseTo(expected.result, 10);
    });
  });
});

// ---------------------------------------------------------------------------
// Zero / edge yields — PRESERVED SURPRISING BEHAVIOR
// ---------------------------------------------------------------------------

describe('calculate — zero and edge yield handling', () => {
  /**
   * SURPRISING: Calculator.jsx uses `(parseFloat(yieldPercent) || 100) / 100`.
   * In JavaScript, 0 is falsy, so `parseFloat(0) || 100` evaluates to 100.
   * This means a zero yield silently falls back to 100% rather than producing
   * Infinity or an error. This is preserved exactly as-is.
   */
  it('yieldPercent=0 falls back to 100% (JS falsy zero — preserved from original)', () => {
    const actual = calculate({ mode: 'cost', yieldPercent: 0, cost: 3 });
    // 3 / 1.0 = 3
    expect(actual.result).toBe(3);
  });

  it('yieldPercent=0 in weight mode also falls back to 100%', () => {
    const actual = calculate({ mode: 'weight', yieldPercent: 0, targetWeight: 100 });
    // 100 / 1.0 = 100
    expect(actual.result).toBe(100);
  });

  it('yieldPercent="" (empty string) falls back to 100%', () => {
    // parseFloat('') = NaN, NaN is falsy → || 100 → y = 1.0
    const actual = calculate({ mode: 'cost', yieldPercent: '', cost: 3 });
    expect(actual.result).toBe(3);
  });

  it('yieldPercent=undefined falls back to 100%', () => {
    const actual = calculate({ mode: 'cost', yieldPercent: undefined, cost: 3 });
    expect(actual.result).toBe(3);
  });

  it('very small yield (1%) results in high cost', () => {
    const actual = calculate({ mode: 'cost', yieldPercent: 1, cost: 2 });
    expect(actual.result).toBeCloseTo(200, 10);
  });
});

// ---------------------------------------------------------------------------
// Full combination — all addends together
// ---------------------------------------------------------------------------

describe('calculate — full combination', () => {
  it('proc(incoming) + cold + ship + labor + bulk discount all interact correctly', () => {
    // cost=2, yield=50%, proc=0.50 incoming, cold=0.10, ship=0.20,
    // labor: 2 min/lb@$30/hr = $1/lb
    // base before discount: (2+0.5)/0.5 + 0.10 + 0.20 + 1.0 = 5 + 0.10 + 0.20 + 1.0 = 6.30
    // qty=600 → 10% discount: 6.30 * 0.90 = 5.67
    const actual = calculate({
      mode: 'cost',
      yieldPercent: 50,
      cost: 2,
      processingCost: 0.5,
      weightType: 'incoming',
      coldStorage: 0.1,
      shipping: 0.2,
      showTimeTracking: true,
      processingSteps: [{ timeMinutes: 2, laborCostPerHour: 30 }],
      showEconomyOfScale: true,
      quantity: '600',
      priceBreaks: DEFAULT_PRICE_BREAKS,
    });
    expect(actual.result).toBeCloseTo(5.67, 10);
    expect(actual.appliedDiscount).toBe(10);
  });
});
