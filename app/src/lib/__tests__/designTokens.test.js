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

describe.each(Object.entries(themes))('%s theme tokens', (_theme, t) => {
  const backgrounds = ['surface', 'surface-raised'];

  it('defines every token the tests rely on', () => {
    for (const name of [
      ...backgrounds, 'text-primary', 'text-secondary', 'text-muted', 'border-strong',
      'primary', 'primary-hover', 'accent', 'link', 'focus', 'success', 'danger',
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

  it.each(['primary', 'primary-hover'])('white button text on %s is at least 4.5:1', (name) => {
    expect(contrast('#ffffff', t[name])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('fixed brand colors', () => {
  const { brand } = tailwindConfig.theme.extend.colors;

  it.each(['cta', 'cta-hover'])('white text on brand.%s is at least 4.5:1', (name) => {
    expect(contrast('#ffffff', brand[name])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps yellow readable on the teal navbar', () => {
    expect(contrast(brand.yellow, brand.teal)).toBeGreaterThanOrEqual(4.5);
  });
});
