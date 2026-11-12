/**
 * Guards the design tokens in src/index.css against readability regressions.
 * Users read this on a dock in glare or in a dim kitchen, so text must meet
 * WCAG AA (4.5:1) and form-control edges / focus rings must meet 3:1.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindConfig from '../../../tailwind.config.js';

const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8');

function readTokens(selector) {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  const tokens = {};
  for (const [, name, value] of block.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[name] = value;
  }
  return tokens;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themes = { light: readTokens(':root'), dark: readTokens('\\.dark') };
const { brand } = tailwindConfig.theme.extend.colors;

describe.each(Object.entries(themes))('%s theme tokens', (_theme, t) => {
  const backgrounds = ['surface', 'surface-raised'];

  it('defines every token the tests rely on', () => {
    for (const name of [
      ...backgrounds, 'text-primary', 'text-secondary', 'text-muted', 'border-strong',
      'primary', 'primary-hover', 'on-primary', 'accent', 'link', 'focus', 'success', 'danger',
      'bar', 'on-bar', 'on-bar-muted',
    ]) {
      expect(t[name], `--color-${name}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(['text-primary', 'text-secondary', 'text-muted', 'accent', 'link', 'success', 'danger'])(
    '%s text is at least 4.5:1 on both surfaces',
    (name) => {
      for (const bg of backgrounds) {
        expect(contrast(t[name], t[bg]), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(['border-strong', 'focus'])('%s is at least 3:1 on both surfaces', (name) => {
    for (const bg of backgrounds) {
      expect(contrast(t[name], t[bg]), `${name} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(['primary', 'primary-hover'])('on-primary button text on %s is at least 4.5:1', (name) => {
    expect(contrast(t['on-primary'], t[name])).toBeGreaterThanOrEqual(4.5);
  });

  // The ticket: labels, line items and the price itself, on the one bar-coloured block
  it.each(['on-bar', 'on-bar-muted'])('%s text is at least 4.5:1 on bar', (name) => {
    expect(contrast(t[name], t.bar), `${name} on bar`).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the brass price figure and focus ring readable on bar', () => {
    expect(contrast(brand.yellow, t.bar)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps on-primary text readable on the fixed brand fills', () => {
    for (const name of ['cta', 'cta-hover', 'teal']) {
      expect(contrast(t['on-primary'], brand[name]), `on-primary on brand.${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The tab bar sits on surface-raised: resting tabs are text-secondary, the current one is accent
  it.each(['text-secondary', 'accent'])('%s tab labels are at least 4.5:1 on the tab bar', (name) => {
    expect(contrast(t[name], t['surface-raised'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('style guide values', () => {
  // docs/STYLE_GUIDE.md, token table. Daylight paper is bone, not the pinker #f5f0eb it replaced.
  it('uses the bone paper ground in daylight', () => {
    expect(themes.light.surface.toLowerCase()).toBe('#f4f2ec');
  });

  it.each([
    ['light', { bar: '#0b2a33', 'on-bar': '#f5f0eb', 'on-bar-muted': '#a9c0c7', 'on-primary': '#ffffff' }],
    ['dark', { bar: '#06141a', 'on-bar': '#f5f0eb', 'on-bar-muted': '#a9c0c7', 'on-primary': '#ffffff' }],
  ])('defines the ticket and on-primary tokens for the %s theme', (theme, expected) => {
    for (const [name, value] of Object.entries(expected)) {
      expect(themes[theme][name].toLowerCase(), `--color-${name}`).toBe(value);
    }
  });

  it('exposes every theme token as a Tailwind colour', () => {
    const { colors } = tailwindConfig.theme.extend;
    for (const [name, token] of [
      ['bar', 'bar'], ['on-bar', 'on-bar'], ['on-bar-muted', 'on-bar-muted'], ['on-primary', 'on-primary'],
      ['surface', 'surface'], ['surface-raised', 'surface-raised'],
    ]) {
      expect(colors[name], name).toBe(`var(--color-${token})`);
    }
  });

  it('keeps corners tight: 6px for buttons and inputs, 8px for cards and tiles', () => {
    const { borderRadius } = tailwindConfig.theme.extend;
    expect(borderRadius.lg).toBe('6px');
    expect(borderRadius.xl).toBe('8px');
  });

  it('names the bundled font families first', () => {
    const { fontFamily } = tailwindConfig.theme.extend;
    expect(fontFamily.sans.slice(0, 2)).toEqual(['Inter Variable', 'Inter']);
    expect(fontFamily.display).toEqual(['Fraunces Variable', 'Fraunces', 'Georgia', 'serif']);
  });
});

describe('fixed brand colors', () => {
  it.each(['cta', 'cta-hover'])('white text on brand.%s is at least 4.5:1', (name) => {
    expect(contrast('#ffffff', brand[name])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps yellow readable on brand-teal fills', () => {
    expect(contrast(brand.yellow, brand.teal)).toBeGreaterThanOrEqual(4.5);
  });
});
