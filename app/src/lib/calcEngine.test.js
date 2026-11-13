/**
 * calcEngine test suite — table-driven, interface-only.
 *
 * Expected values are derived from the original Calculator.jsx calculate()
 * function, not from running this module. Do not update expected values to
 * match a broken implementation — fix the implementation instead.
 */

import { describe, it, expect } from 'vitest';
import { calculate, costAcrossYields, sellPriceAtMargin, portionCost } from './calcEngine.js';

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
// Shipping — incoming vs outgoing weight basis
// ---------------------------------------------------------------------------

describe('calculate — shipping weight basis', () => {
  const cases = [
    {
      label: 'incoming basis: shipping the starting fish is spread over the finished pounds',
      // cost=2, ship=0.20, yield=50%: 2/0.5 + 0.20/0.5 = 4.40
      inputs: { mode: 'cost', yieldPercent: 50, cost: 2, shipping: 0.2, shippingWeightType: 'incoming' },
      expected: { result: 4.4, appliedDiscount: 0 },
    },
    {
      label: 'outgoing basis: shipping the finished product is added directly',
      // cost=2, ship=0.20, yield=50%: 2/0.5 + 0.20 = 4.20
      inputs: { mode: 'cost', yieldPercent: 50, cost: 2, shipping: 0.2, shippingWeightType: 'outgoing' },
      expected: { result: 4.2, appliedDiscount: 0 },
    },
    {
      label: 'processing and shipping bases are independent',
      // cost=2, proc=0.50 outgoing, ship=0.20 incoming, yield=50%: 4 + 0.50 + 0.40 = 4.90
      inputs: {
        mode: 'cost', yieldPercent: 50, cost: 2,
        processingCost: 0.5, weightType: 'outgoing', shipping: 0.2, shippingWeightType: 'incoming',
      },
      expected: { result: 4.9, appliedDiscount: 0 },
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
// Breakdown — what each cost adds per lb of finished product
// ---------------------------------------------------------------------------

describe('calculate — breakdown', () => {
  it('reports each part per lb of finished product, and the parts add up to the result', () => {
    // cost=2, proc=0.50 incoming, ship=0.20 incoming, cold=0.10, yield=50%
    const actual = calculate({
      mode: 'cost', yieldPercent: 50, cost: 2,
      processingCost: 0.5, weightType: 'incoming', shipping: 0.2, shippingWeightType: 'incoming', coldStorage: 0.1,
    });
    expect(actual.breakdown.fish).toBeCloseTo(4, 10);
    expect(actual.breakdown.processing).toBeCloseTo(1, 10);
    expect(actual.breakdown.shipping).toBeCloseTo(0.4, 10);
    expect(actual.breakdown.coldStorage).toBeCloseTo(0.1, 10);
    expect(actual.breakdown.labor).toBe(0);
    const sum = Object.values(actual.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(actual.result, 10);
  });

  it('is taken before any bulk discount', () => {
    const actual = calculate({
      mode: 'cost', yieldPercent: 50, cost: 2,
      showEconomyOfScale: true, quantity: '100', priceBreaks: DEFAULT_PRICE_BREAKS,
    });
    expect(actual.breakdown.fish).toBeCloseTo(4, 10);
    expect(actual.result).toBeCloseTo(4 * 0.95, 10);
  });

  it('is null in weight mode', () => {
    expect(calculate({ mode: 'weight', yieldPercent: 42, targetWeight: 100 }).breakdown).toBeNull();
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

// ---------------------------------------------------------------------------
// Hand-worked example used across the newer helpers
//
// Sockeye Salmon, Round → Skinless Fillet: yield 46%, range 41–49% (fish_data_v3.js).
// Paid $4.50/lb for the whole fish.
//   cost at 46%:  4.50 / 0.46 = 9.7826…  → $9.78
//   cost at 49%:  4.50 / 0.49 = 9.1836…  → $9.18  (cut well: cheapest)
//   cost at 41%:  4.50 / 0.41 = 10.9756… → $10.98 (cut badly: dearest)
//   35% margin:   9.7826 / 0.65 = 15.0501… → $15.05
//   6 oz portion: 9.7826 × 6 / 16 = 3.6684… → $3.67
// ---------------------------------------------------------------------------

const SOCKEYE = { mode: 'cost', yieldPercent: 46, cost: 4.5 };
const SOCKEYE_RANGE = [41, 49];
const cents = (n) => n.toFixed(2);

describe('hand-worked Sockeye example', () => {
  const cost = calculate(SOCKEYE).result;

  it('costs $9.78/lb as skinless fillet', () => {
    expect(cents(cost)).toBe('9.78');
  });

  it('runs $9.18–$10.98/lb across the 41–49% range', () => {
    const range = costAcrossYields(SOCKEYE, SOCKEYE_RANGE);
    expect(cents(range.low)).toBe('9.18');
    expect(cents(range.high)).toBe('10.98');
  });

  it('sells at $15.05/lb for a 35% margin', () => {
    expect(cents(sellPriceAtMargin(cost, 35))).toBe('15.05');
  });

  it('costs $3.67 for a 6 oz portion', () => {
    expect(cents(portionCost(cost, 6))).toBe('3.67');
  });
});

// ---------------------------------------------------------------------------
// costAcrossYields
// ---------------------------------------------------------------------------

describe('costAcrossYields', () => {
  it('returns the cost at the high yield as low and at the low yield as high', () => {
    const range = costAcrossYields(SOCKEYE, SOCKEYE_RANGE);
    expect(range.low).toBeCloseTo(4.5 / 0.49, 10);
    expect(range.high).toBeCloseTo(4.5 / 0.41, 10);
    expect(range.low).toBeLessThan(range.high);
  });

  it('matches calculate run at each end of the range', () => {
    const inputs = {
      mode: 'cost', yieldPercent: 50, cost: 2,
      processingCost: 0.5, weightType: 'incoming', shipping: 0.2, shippingWeightType: 'incoming', coldStorage: 0.1,
    };
    const range = costAcrossYields(inputs, [40, 60]);
    expect(range.low).toBe(calculate({ ...inputs, yieldPercent: 60 }).result);
    expect(range.high).toBe(calculate({ ...inputs, yieldPercent: 40 }).result);
  });

  it('spreads incoming charges over the yield and adds outgoing charges as they are', () => {
    // cost=2, yields 40% and 50%
    // incoming: (2 + 0.50 + 0.20) / 0.5 = 5.40 and / 0.4 = 6.75
    const incoming = costAcrossYields(
      { mode: 'cost', cost: 2, processingCost: 0.5, weightType: 'incoming', shipping: 0.2, shippingWeightType: 'incoming' },
      [40, 50],
    );
    expect(incoming.low).toBeCloseTo(5.4, 10);
    expect(incoming.high).toBeCloseTo(6.75, 10);
    // outgoing: 2 / 0.5 + 0.70 = 4.70 and 2 / 0.4 + 0.70 = 5.70
    const outgoing = costAcrossYields(
      { mode: 'cost', cost: 2, processingCost: 0.5, weightType: 'outgoing', shipping: 0.2, shippingWeightType: 'outgoing' },
      [40, 50],
    );
    expect(outgoing.low).toBeCloseTo(4.7, 10);
    expect(outgoing.high).toBeCloseTo(5.7, 10);
  });

  it('applies the bulk discount at both ends', () => {
    // 2 / 0.5 = 4 and 2 / 0.4 = 5, less 10% at 600 lbs
    const range = costAcrossYields(
      { mode: 'cost', cost: 2, showEconomyOfScale: true, quantity: '600', priceBreaks: DEFAULT_PRICE_BREAKS },
      [40, 50],
    );
    expect(range.low).toBeCloseTo(3.6, 10);
    expect(range.high).toBeCloseTo(4.5, 10);
  });

  it('ignores the yield in the inputs: only the range decides', () => {
    const expected = costAcrossYields(SOCKEYE, SOCKEYE_RANGE);
    expect(costAcrossYields({ ...SOCKEYE, yieldPercent: 99 }, SOCKEYE_RANGE)).toEqual(expected);
    expect(costAcrossYields({ mode: 'cost', cost: 4.5 }, SOCKEYE_RANGE)).toEqual(expected);
  });

  it('reads a range given backwards the right way round', () => {
    expect(costAcrossYields(SOCKEYE, [49, 41])).toEqual(costAcrossYields(SOCKEYE, [41, 49]));
  });

  it('accepts a yield of exactly 100 and bounds given as plain number text', () => {
    expect(costAcrossYields(SOCKEYE, [50, 100])).toEqual({ low: 4.5, high: 9 });
    expect(costAcrossYields({ mode: 'cost', cost: '4.50' }, ['50', '100'])).toEqual({ low: 4.5, high: 9 });
  });

  it('gives the same figure twice when the range is a single yield', () => {
    const range = costAcrossYields(SOCKEYE, [46, 46]);
    expect(range.low).toBe(range.high);
    expect(range.low).toBe(calculate(SOCKEYE).result);
  });

  it('treats blank optional charges as none, like calculate', () => {
    // parseAmount('') is NaN, which is what the calculator passes for an empty box
    const blank = { ...SOCKEYE, processingCost: NaN, shipping: '', coldStorage: undefined };
    expect(costAcrossYields(blank, SOCKEYE_RANGE)).toEqual(costAcrossYields(SOCKEYE, SOCKEYE_RANGE));
  });

  it('still gives a range when the fish was free but processing was not', () => {
    // 0 / y + 1 / 0.5 = 2 and 1 / 0.4 = 2.5
    const range = costAcrossYields({ mode: 'cost', cost: 0, processingCost: 1, weightType: 'incoming' }, [40, 50]);
    expect(range.low).toBeCloseTo(2, 10);
    expect(range.high).toBeCloseTo(2.5, 10);
  });

  it('never changes the inputs it was given', () => {
    const inputs = { ...SOCKEYE };
    const range = [...SOCKEYE_RANGE];
    costAcrossYields(inputs, range);
    expect(inputs).toEqual(SOCKEYE);
    expect(range).toEqual(SOCKEYE_RANGE);
  });

  describe('returns null', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an empty array', []],
      ['one bound', [41]],
      ['three bounds', [41, 46, 49]],
      ['the text "41-49"', '41-49'],
      ['an object', { low: 41, high: 49 }],
    ])('when the range is %s', (_label, range) => {
      expect(costAcrossYields(SOCKEYE, range)).toBeNull();
    });

    it.each([
      ['zero', [0, 49]],
      ['negative', [-5, 49]],
      ['over 100', [41, 101]],
      ['NaN', [NaN, 49]],
      ['Infinity', [41, Infinity]],
      ['null', [null, 49]],
      ['undefined', [41, undefined]],
      ['empty text', ['', 49]],
      ['text that is not a number', ['low', 'high']],
      ['a percentage with its sign', ['41%', '49%']],
    ])('when a bound is %s', (_label, range) => {
      expect(costAcrossYields(SOCKEYE, range)).toBeNull();
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty text', ''],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['negative', -4.5],
      ['text with a dollar sign', '$4.50'],
      ['text with a thousands comma', '1,000'],
      ['text that is not a number', 'abc'],
    ])('when the price paid is %s', (_label, cost) => {
      expect(costAcrossYields({ mode: 'cost', cost }, SOCKEYE_RANGE)).toBeNull();
    });

    it.each([
      ['processingCost', 'abc'],
      ['processingCost', '$0.50'],
      ['processingCost', -0.5],
      ['shipping', '0.20/lb'],
      ['shipping', Infinity],
      ['coldStorage', 'ten cents'],
      ['coldStorage', -0.1],
    ])('when %s is filled in with %j', (field, value) => {
      expect(costAcrossYields({ ...SOCKEYE, [field]: value }, SOCKEYE_RANGE)).toBeNull();
    });

    it('in weight mode, which gives pounds and not a cost', () => {
      expect(costAcrossYields({ mode: 'weight', targetWeight: 100, cost: 4.5 }, SOCKEYE_RANGE)).toBeNull();
    });

    it('when the cost comes out as zero', () => {
      expect(costAcrossYields({ mode: 'cost', cost: 0 }, SOCKEYE_RANGE)).toBeNull();
    });

    it('when a 100% discount leaves nothing', () => {
      const inputs = { ...SOCKEYE, showEconomyOfScale: true, quantity: '10', priceBreaks: [{ minQty: 1, discount: 100 }] };
      expect(costAcrossYields(inputs, SOCKEYE_RANGE)).toBeNull();
    });

    it('when the cost overflows', () => {
      expect(costAcrossYields({ mode: 'cost', cost: Number.MAX_VALUE }, SOCKEYE_RANGE)).toBeNull();
    });

    it.each([[null], [undefined], ['cost'], [42]])('when the inputs are %j', (inputs) => {
      expect(costAcrossYields(inputs, SOCKEYE_RANGE)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// sellPriceAtMargin — margin on selling price
// ---------------------------------------------------------------------------

describe('sellPriceAtMargin', () => {
  it.each([
    // cost, margin, price = cost / (1 - margin / 100)
    [6, 25, 8],
    [10, 50, 20],
    [9, 10, 10],
    [3.5, 30, 5],
  ])('a cost of %d at a margin of %d percent sells at %d', (cost, margin, price) => {
    expect(sellPriceAtMargin(cost, margin)).toBeCloseTo(price, 10);
  });

  it('is margin on the selling price, not markup on cost', () => {
    const price = sellPriceAtMargin(10, 35);
    expect((price - 10) / price).toBeCloseTo(0.35, 10); // the margin is 35% of the price
    expect(price).not.toBeCloseTo(13.5, 2); // a 35% markup would be $13.50
  });

  it('a 0% margin sells at cost', () => {
    expect(sellPriceAtMargin(9.78, 0)).toBe(9.78);
  });

  it('reads plain number text', () => {
    expect(sellPriceAtMargin('6', '25')).toBeCloseTo(8, 10);
  });

  describe('returns null', () => {
    it.each([
      ['zero', 0],
      ['negative', -9.78],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
      ['undefined', undefined],
      ['empty text', ''],
      ['text with a dollar sign', '$9.78'],
      ['text that is not a number', 'abc'],
      ['an array', [9.78]],
    ])('when the cost is %s', (_label, cost) => {
      expect(sellPriceAtMargin(cost, 35)).toBeNull();
    });

    it.each([
      ['exactly 100', 100],
      ['over 100', 150],
      ['negative', -5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
      ['undefined', undefined],
      ['empty text', ''],
      ['text with a percent sign', '35%'],
      ['text that is not a number', 'abc'],
    ])('when the margin is %s', (_label, margin) => {
      expect(sellPriceAtMargin(9.78, margin)).toBeNull();
    });

    it('when the price overflows', () => {
      expect(sellPriceAtMargin(Number.MAX_VALUE, 99)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// portionCost — cost per lb × ounces / 16
// ---------------------------------------------------------------------------

describe('portionCost', () => {
  it.each([
    // cost per lb, ounces, portion cost
    [16, 1, 1],
    [16, 16, 16],
    [8, 6, 3],
    [10, 4, 2.5],
    [12, 0.5, 0.375],
  ])('%d per lb at %d oz costs %d', (cost, ounces, portion) => {
    expect(portionCost(cost, ounces)).toBeCloseTo(portion, 10);
  });

  it('reads plain number text', () => {
    expect(portionCost('8', '6')).toBeCloseTo(3, 10);
  });

  describe('returns null', () => {
    it.each([
      ['zero', 0],
      ['negative', -8],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
      ['undefined', undefined],
      ['empty text', ''],
      ['text with a unit', '8/lb'],
      ['text that is not a number', 'abc'],
    ])('when the cost is %s', (_label, cost) => {
      expect(portionCost(cost, 6)).toBeNull();
    });

    it.each([
      ['zero', 0],
      ['negative', -6],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
      ['undefined', undefined],
      ['empty text', ''],
      ['text with a unit', '6 oz'],
      ['text that is not a number', 'abc'],
    ])('when the ounces are %s', (_label, ounces) => {
      expect(portionCost(8, ounces)).toBeNull();
    });

    it('when the portion cost overflows', () => {
      expect(portionCost(Number.MAX_VALUE, 32)).toBeNull();
    });
  });
});
