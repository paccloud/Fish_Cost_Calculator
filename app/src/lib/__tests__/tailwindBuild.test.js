/**
 * Tailwind turns any text in the files it scans that looks like a class into CSS, so a regex such as
 * /[-:=]/ in a test file once became the invalid rule `.\[-\:\=\]{-: =}` in the production stylesheet.
 */
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../../../tailwind.config.js';

describe('Tailwind build', () => {
  it('emits only valid CSS property names', async () => {
    const result = await postcss([tailwindcss(config)]).process('@tailwind utilities;', { from: undefined });
    const invalid = [];
    result.root.walkDecls((decl) => {
      if (!/^(--)?-?[a-z][a-z0-9-]*$/i.test(decl.prop)) invalid.push(`${decl.parent.selector} { ${decl.prop}: ${decl.value} }`);
    });
    expect(invalid).toEqual([]);
  }, 60_000);
});
