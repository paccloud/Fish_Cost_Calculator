import { describe, it, expect } from 'vitest';
import { parseAmount } from './numberInput.js';

describe('parseAmount', () => {
  it.each([
    ['4.50', 4.5],
    ['4', 4],
    ['4.', 4],
    ['.5', 0.5],
    [' 4.50 ', 4.5],
    ['$4.50', 4.5],
    ['$ 4.50', 4.5],
    ['42%', 42],
    ['100 lbs', 100],
    ['100lb', 100],
    ['1,000', 1000],
    ['12,500.75', 12500.75],
    ['4,50', 4.5], // decimal comma: one or two digits after a single comma
    ['4,5', 4.5],
    [4.5, 4.5],
  ])('reads %j as %d', (typed, expected) => {
    expect(parseAmount(typed)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['4a5'],
    ['1.2.3'],
    ['1,00,0'],
    ['-4'],
    [null],
    [undefined],
    [Number.NaN],
  ])('rejects %j instead of guessing', (typed) => {
    expect(parseAmount(typed)).toBeNaN();
  });
});
