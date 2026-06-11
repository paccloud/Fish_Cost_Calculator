/**
 * fishDataMerge.js
 *
 * Single owner of fish-data precedence rules.
 * Pure data-in / data-out — no React, no I/O.
 *
 * Precedence (lowest → highest):
 *   1. staticData   — research yields from fish_data_v3 (PROCESSED_FISH_DATA shape)
 *   2. customYields — user-uploaded/synced yields (pending-delete excluded)
 *   3. customSpecies — local unsynced custom species (plain object, always layered last)
 */

/**
 * Merge static fish data with user custom yields and local custom species.
 *
 * @param {Record<string, SpeciesEntry>|null|undefined} staticData
 *   Processed static research data.
 *   Shape: { [speciesName]: { scientific_name?, category?, conversions: { [label]: { yield, range?, from, to } } } }
 *
 * @param {Array<YieldItem>|null|undefined} customYields
 *   User-contributed yield overrides from IndexedDB (syncedStore).
 *   Shape: Array<{ species: string, product: string, yield: number|string, syncStatus?: string }>
 *   Items with syncStatus === 'pending-delete' are excluded.
 *
 * @param {Record<string, SpeciesEntry>|null|undefined} customSpecies
 *   Locally-created custom species (plain object, no syncStatus — always local).
 *   Shape: { [speciesName]: { conversions: { [label]: { yield, from, to } } } }
 *
 * @returns {Record<string, SpeciesEntry>}
 */
export function mergeFishData(staticData, customYields, customSpecies) {
  // --- Layer 1: base from static research data ---
  const merged = staticData ? { ...staticData } : {};

  // Deep-clone each species' conversions so we never mutate the caller's objects
  for (const sp of Object.keys(merged)) {
    merged[sp] = {
      ...merged[sp],
      conversions: { ...merged[sp].conversions },
    };
  }

  // --- Layer 2: user-synced custom yields ---
  const yields = Array.isArray(customYields) ? customYields : [];
  for (const item of yields) {
    // Respect sync-status — skip items marked for deletion
    if (item.syncStatus === 'pending-delete') continue;

    const sp = item.species;
    const convKey = `Custom: ${item.product}`;
    const convValue = {
      yield: parseFloat(item.yield),
      from: 'Custom',
      to: item.product,
    };

    if (!merged[sp]) {
      merged[sp] = { conversions: {} };
    } else if (!merged[sp].conversions) {
      merged[sp] = { ...merged[sp], conversions: {} };
    }

    merged[sp].conversions[convKey] = convValue;
  }

  // --- Layer 3: local custom species (highest precedence) ---
  const species = customSpecies && typeof customSpecies === 'object' ? customSpecies : {};
  for (const sp of Object.keys(species)) {
    const incoming = species[sp];
    if (!merged[sp]) {
      merged[sp] = { ...incoming, conversions: { ...incoming.conversions } };
    } else {
      merged[sp] = {
        ...merged[sp],
        conversions: {
          ...merged[sp].conversions,
          ...(incoming.conversions || {}),
        },
      };
    }
  }

  return merged;
}
