// Normalizes yield data into the shape the Calculator reads:
// conversions[key] = { from, to, yield: number | null, range: [min, max] | null, ...the rest }.
//
// The bundled FISH_DATA_V3 keys conversions as "From → To" and omits the from/to fields, so they
// are read from the key. A yield is null where the source prints only a range. Whatever else a
// conversion carries (its row in the bulletin, a note, a caution) is passed through.

const ARROW = ' → ';

function toNumber(value) {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function toRange(range) {
  if (Array.isArray(range) && range.length === 2) {
    const min = toNumber(range[0]);
    const max = toNumber(range[1]);
    return min !== null && max !== null ? [min, max] : null;
  }
  if (typeof range === 'string') {
    const [min, max] = range.split('-').map(toNumber);
    return min != null && max != null ? [min, max] : null;
  }
  return null;
}

export function normalizeConversion(key, conv) {
  let { from, to } = conv;
  if ((!from || !to) && key.includes(ARROW)) {
    const [keyFrom, ...rest] = key.split(ARROW);
    from = from || keyFrom.trim();
    to = to || rest.join(ARROW).trim();
  }
  return { ...conv, from, to, yield: toNumber(conv.yield), range: toRange(conv.range) };
}

export function withConversionStates(fishData) {
  const out = {};
  for (const [species, data] of Object.entries(fishData || {})) {
    const conversions = {};
    for (const [key, conv] of Object.entries(data?.conversions || {})) {
      conversions[key] = normalizeConversion(key, conv || {});
    }
    out[species] = { ...data, conversions };
  }
  return out;
}

// A yield percentage is usable when it is a finite number in (0, 100].
export function parseYieldPercent(value) {
  const n = toNumber(value);
  return n !== null && n > 0 && n <= 100 ? n : null;
}
