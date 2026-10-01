// A custom yield is a conversion (starting form → finished product) on a
// species, with a yield above 0 and up to 100 and an optional private source
// note (CONTEXT.md). This module is pure: it owns the shape, the limits and
// the validation, and mirrors firestore.rules exactly so a write that passes
// here never fails the rules later (an offline write is only validated by the
// rules once it reaches the server, when the UI has long moved on).

export const CUSTOM_YIELD_LIMITS = Object.freeze({
  species: 120,
  from: 80,
  to: 80,
  source: 500,
});

export const CUSTOM_YIELD_FIELDS = Object.freeze([
  'ownerUid', 'species', 'from', 'to', 'yield', 'source', 'status', 'createdAt', 'updatedAt',
]);

const ARROW = ' → ';

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Trim the text fields and parse the yield. Never throws; validate() judges the result. */
export function normalizeCustomYieldInput(input = {}) {
  return {
    species: trimmed(input.species),
    from: trimmed(input.from),
    to: trimmed(input.to),
    yield: toNumber(input.yield),
    source: trimmed(input.source),
  };
}

/**
 * Same checks as validCustomYield() in firestore.rules. Returns
 * { ok, errors } where errors maps a field to one plain message.
 */
export function validateCustomYield(input) {
  const value = normalizeCustomYieldInput(input);
  const errors = {};

  if (!value.species) errors.species = 'Enter the species.';
  else if (value.species.length > CUSTOM_YIELD_LIMITS.species) {
    errors.species = `Keep the species under ${CUSTOM_YIELD_LIMITS.species} characters.`;
  }

  if (value.from.length > CUSTOM_YIELD_LIMITS.from) {
    errors.from = `Keep the starting form under ${CUSTOM_YIELD_LIMITS.from} characters.`;
  }

  if (!value.to) errors.to = 'Enter the finished product.';
  else if (value.to.length > CUSTOM_YIELD_LIMITS.to) {
    errors.to = `Keep the finished product under ${CUSTOM_YIELD_LIMITS.to} characters.`;
  }

  if (value.yield === null) errors.yield = 'Enter the yield as a number.';
  else if (value.yield <= 0 || value.yield > 100) {
    errors.yield = 'The yield is a percentage above 0 and up to 100.';
  }

  if (value.source.length > CUSTOM_YIELD_LIMITS.source) {
    errors.source = `Keep the source note under ${CUSTOM_YIELD_LIMITS.source} characters.`;
  }

  return { ok: Object.keys(errors).length === 0, errors, value };
}

/** "Round → Skinless Fillet", or "? → Skinless Fillet" while the starting form is blank. */
export function conversionLabel({ from, to }) {
  return `${from || '?'}${ARROW}${to}`;
}

export function hasStartingForm(customYield) {
  return Boolean(customYield?.from);
}
