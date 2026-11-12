import { describe, it, expect } from 'vitest';
import { buildPriceCard, formatMoney } from './priceCard.js';
import { calculate, costAcrossYields, sellPriceAtMargin, portionCost } from './calcEngine.js';
import { plainFormName } from './formNames.js';

// The hand-worked example: Sockeye Salmon, Round → Skinless Fillet, $4.50/lb at 46% (range 41–49%).
// cost $9.78; range $9.18–$10.98; 35% margin $15.05; 6 oz portion $3.67.
const costPerLb = calculate({ mode: 'cost', yieldPercent: 46, cost: 4.5 }).result;
const SOCKEYE = {
  species: 'Sockeye Salmon',
  fromName: plainFormName('Round').name,
  productName: plainFormName('Skinless Fillet').name,
  costPerLb,
  yieldPct: 46,
  sellPrice: sellPriceAtMargin(costPerLb, 35),
  marginPct: 35,
  portion: { ounces: 6, cost: portionCost(costPerLb, 6) },
  range: costAcrossYields({ mode: 'cost', cost: 4.5 }, [41, 49]),
  purchasePrice: 4.5,
};

describe('formatMoney', () => {
  it.each([
    [9.7826, '$9.78'],
    [9.786, '$9.79'],
    [4.5, '$4.50'],
    [15, '$15.00'],
    [0, '$0.00'],
    [0.5, '$0.50'],
    [999.999, '$1,000.00'],
    [1234.5, '$1,234.50'],
    [1234567.891, '$1,234,567.89'],
    [-4.5, '-$4.50'],
    [-1234.5, '-$1,234.50'],
    ['9.78', '$9.78'],
    [' 4.5 ', '$4.50'],
  ])('%j → %s', (n, expected) => {
    expect(formatMoney(n)).toBe(expected);
  });

  it('never shows a negative zero', () => {
    expect(formatMoney(-0.001)).toBe('$0.00');
    expect(formatMoney(-0)).toBe('$0.00');
  });

  it.each([[NaN], [Infinity], [-Infinity], [null], [undefined], [''], ['abc'], ['$9.78'], ['1,000'], [[9.78]], [{}], [true], [1e21]])(
    '%j is not an amount, so it prints nothing',
    (n) => {
      expect(formatMoney(n)).toBe('');
    },
  );
});

describe('buildPriceCard — the hand-worked Sockeye example', () => {
  it('builds the whole card', () => {
    expect(buildPriceCard(SOCKEYE)).toBe(
      [
        'Sockeye Salmon, skinless fillet: $9.78/lb',
        'From whole fish at 46% yield',
        'Range: $9.18–$10.98/lb',
        'Sell price: $15.05/lb at a 35% margin',
        '6 oz portion: $3.67',
      ].join('\n'),
    );
  });

  it('adds what was paid only when asked', () => {
    expect(buildPriceCard(SOCKEYE)).not.toContain('Paid');
    expect(buildPriceCard({ ...SOCKEYE, includePurchasePrice: false })).not.toContain('4.50');
    expect(buildPriceCard({ ...SOCKEYE, includePurchasePrice: true }).split('\n').at(-1)).toBe('Paid: $4.50/lb');
  });

  it('does not treat a truthy value as permission to show what was paid', () => {
    expect(buildPriceCard({ ...SOCKEYE, includePurchasePrice: 'false' })).not.toContain('Paid');
    expect(buildPriceCard({ ...SOCKEYE, includePurchasePrice: 1 })).not.toContain('Paid');
  });

  it('is plain text: no markdown, no emoji, an en dash in the range', () => {
    const card = buildPriceCard({ ...SOCKEYE, includePurchasePrice: true });
    expect(card).not.toMatch(/[*_#`>[\]|]/);
    expect(card).toMatch(/^[\x20-\x7E\n–]+$/); // printable ASCII, newlines and the en dash only
    expect(card).toContain('$9.18–$10.98/lb');
    expect(card).not.toMatch(/\n\n|^\n|\n$| $/m);
  });

  it('stays a few lines long', () => {
    expect(buildPriceCard({ ...SOCKEYE, includePurchasePrice: true }).split('\n')).toHaveLength(6);
  });
});

describe('buildPriceCard — the first line', () => {
  const base = { costPerLb: 9.7826 };

  it.each([
    [{ species: 'Sockeye Salmon', productName: 'Skinless fillet' }, 'Sockeye Salmon, skinless fillet: $9.78/lb'],
    [{ species: 'Sockeye Salmon' }, 'Sockeye Salmon: $9.78/lb'],
    [{ productName: 'Skinless fillet' }, 'Skinless fillet: $9.78/lb'],
    [{}, '$9.78/lb'],
    [{ species: '  Sockeye Salmon ', productName: ' Steaks ' }, 'Sockeye Salmon, steaks: $9.78/lb'],
    [{ species: 'Pacific Halibut', productName: 'Gutted, head off' }, 'Pacific Halibut, gutted, head off: $9.78/lb'],
    // Trade codes and acronyms keep their capitals
    [{ species: 'Pink Salmon', productName: 'D/H-Off' }, 'Pink Salmon, D/H-Off: $9.78/lb'],
    [{ species: 'Pink Salmon', productName: 'SIB Trim' }, 'Pink Salmon, SIB Trim: $9.78/lb'],
    [{ species: 42, productName: null }, '$9.78/lb'],
  ])('%j', (names, expected) => {
    expect(buildPriceCard({ ...base, ...names })).toBe(expected);
  });

  it('writes large prices with a thousands comma', () => {
    expect(buildPriceCard({ species: 'Geoduck Clams', costPerLb: 1234.5 })).toBe('Geoduck Clams: $1,234.50/lb');
  });
});

describe('buildPriceCard — no cost, no card', () => {
  it.each([[undefined], [null], [NaN], [Infinity], [0], [-9.78], [''], ['abc'], ['$9.78'], [0.004]])(
    'returns an empty string when the cost per lb is %j',
    (cost) => {
      expect(buildPriceCard({ ...SOCKEYE, costPerLb: cost })).toBe('');
    },
  );

  it.each([[undefined], [null], [{}], ['card'], [42]])('returns an empty string for %j', (card) => {
    expect(buildPriceCard(card)).toBe('');
  });
});

describe('buildPriceCard — lines with a missing value are left out', () => {
  const lines = (card) => buildPriceCard(card).split('\n');
  const FULL = lines(SOCKEYE);

  const without = (index) => FULL.filter((_, i) => i !== index);

  it('yield line: starting form only, yield only, or neither', () => {
    expect(lines({ ...SOCKEYE, yieldPct: undefined })[1]).toBe('From whole fish');
    expect(lines({ ...SOCKEYE, fromName: undefined })[1]).toBe('46% yield');
    expect(lines({ ...SOCKEYE, fromName: '', yieldPct: null })).toEqual(without(1));
  });

  it.each([[0], [-46], [101], [NaN], [Infinity], ['46%'], ['abc'], [0.001]])('a yield of %j is not printed', (yieldPct) => {
    expect(lines({ ...SOCKEYE, yieldPct })[1]).toBe('From whole fish');
  });

  it('keeps a typed decimal yield and a yield of 100', () => {
    expect(lines({ ...SOCKEYE, yieldPct: 46.5 })[1]).toBe('From whole fish at 46.5% yield');
    expect(lines({ ...SOCKEYE, yieldPct: '46' })[1]).toBe('From whole fish at 46% yield');
    expect(lines({ ...SOCKEYE, yieldPct: 100 })[1]).toBe('From whole fish at 100% yield');
    expect(lines({ ...SOCKEYE, yieldPct: 45.300000000000004 })[1]).toBe('From whole fish at 45.3% yield');
  });

  it('keeps the capitals of a trade code used as the starting form', () => {
    expect(lines({ ...SOCKEYE, fromName: 'D/H-On' })[1]).toBe('From D/H-On at 46% yield');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['missing its low end', { high: 10.98 }],
    ['missing its high end', { low: 9.18 }],
    ['not numbers', { low: NaN, high: Infinity }],
    ['zero', { low: 0, high: 10.98 }],
    ['negative', { low: -1, high: 10.98 }],
    ['one price once rounded', { low: 9.781, high: 9.784 }],
  ])('range line is left out when the range is %s', (_label, range) => {
    expect(lines({ ...SOCKEYE, range })).toEqual(without(2));
  });

  it('prints a range given backwards the right way round', () => {
    expect(lines({ ...SOCKEYE, range: { low: 10.9756, high: 9.1837 } })[2]).toBe('Range: $9.18–$10.98/lb');
  });

  it.each([[undefined], [null], [NaN], [Infinity], [0], [-15], ['abc']])('sell line is left out when the sell price is %j', (sellPrice) => {
    expect(lines({ ...SOCKEYE, sellPrice })).toEqual(without(3));
  });

  it.each([[undefined], [null], [NaN], [100], [150], [-5], ['35%'], [99.999]])(
    'sell line drops the margin when the margin is %j',
    (marginPct) => {
      expect(lines({ ...SOCKEYE, marginPct })[3]).toBe('Sell price: $15.05/lb');
    },
  );

  it('prints a 0% margin and a decimal margin', () => {
    expect(lines({ ...SOCKEYE, sellPrice: 9.7826, marginPct: 0 })[3]).toBe('Sell price: $9.78/lb at a 0% margin');
    expect(lines({ ...SOCKEYE, marginPct: 32.5 })[3]).toBe('Sell price: $15.05/lb at a 32.5% margin');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['missing its cost', { ounces: 6 }],
    ['missing its ounces', { cost: 3.67 }],
    ['zero ounces', { ounces: 0, cost: 3.67 }],
    ['a cost of zero', { ounces: 6, cost: 0 }],
    ['a null cost', { ounces: 6, cost: null }],
    ['not numbers', { ounces: NaN, cost: Infinity }],
    ['a cost that rounds to nothing', { ounces: 6, cost: 0.001 }],
  ])('portion line is left out when the portion is %s', (_label, portion) => {
    expect(lines({ ...SOCKEYE, portion })).toEqual(without(4));
  });

  it('prints a half-ounce portion size as typed', () => {
    expect(lines({ ...SOCKEYE, portion: { ounces: 4.5, cost: 2.7514 } })[4]).toBe('4.5 oz portion: $2.75');
  });

  it.each([[undefined], [null], [NaN], [0], [-4.5], ['abc']])('paid line is left out when what was paid is %j', (purchasePrice) => {
    expect(lines({ ...SOCKEYE, includePurchasePrice: true, purchasePrice })).toEqual(FULL);
  });

  it('with only a cost, the card is one line', () => {
    expect(buildPriceCard({ species: 'Sockeye Salmon', productName: 'Skinless fillet', costPerLb })).toBe(
      'Sockeye Salmon, skinless fillet: $9.78/lb',
    );
  });

  it('never prints NaN, Infinity, undefined or null', () => {
    const junk = [undefined, null, NaN, Infinity, -1, 0, '', 'abc', {}, []];
    for (const value of junk) {
      const card = buildPriceCard({
        species: 'Sockeye Salmon',
        productName: 'Skinless fillet',
        costPerLb,
        fromName: value,
        yieldPct: value,
        sellPrice: value,
        marginPct: value,
        portion: { ounces: value, cost: value },
        range: { low: value, high: value },
        includePurchasePrice: true,
        purchasePrice: value,
      });
      expect(card).not.toMatch(/NaN|Infinity|undefined|null|\$0\.00|object/);
    }
  });
});
