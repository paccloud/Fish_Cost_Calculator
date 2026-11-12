/**
 * recentSpecies.js — the last few species a person priced, so the next one is a tap away.
 *
 * Kept on this phone only, under one localStorage key, newest first. It is a convenience and
 * nothing depends on it: when storage is blocked, full or holds something unexpected (private
 * browsing, a locked-down webview), the list is simply empty and nothing throws.
 *
 * @module recentSpecies
 */

export const RECENT_SPECIES_KEY = 'fish-calc-recent-species';
export const RECENT_SPECIES_LIMIT = 5;

// Reading `localStorage` can itself throw where storage is blocked, so it is never touched bare
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Whatever was stored, hand back only what a list of recents can be: distinct, non-empty names
function clean(list) {
  if (!Array.isArray(list)) return [];
  const names = [];
  for (const item of list) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, RECENT_SPECIES_LIMIT);
}

/**
 * The most recent species, newest first.
 *
 * @param {Pick<Storage, 'getItem'>|null} [storage=globalThis.localStorage]
 * @returns {string[]} up to five distinct names; empty when there are none or storage cannot be read
 */
export function readRecentSpecies(storage = defaultStorage()) {
  try {
    return clean(JSON.parse(storage.getItem(RECENT_SPECIES_KEY)));
  } catch {
    return [];
  }
}

/**
 * Put a species at the front of the list, dropping any earlier mention of it and anything past
 * the fifth.
 *
 * @param {string} name — the species just chosen. Blank or non-text names are ignored.
 * @param {Pick<Storage, 'getItem'|'setItem'>|null} [storage=globalThis.localStorage]
 * @returns {string[]} the list as it is now stored, newest first. When it could not be saved,
 *   that is the list as it was (empty when storage is blocked).
 */
export function pushRecentSpecies(name, storage = defaultStorage()) {
  const before = readRecentSpecies(storage);
  const added = typeof name === 'string' ? name.trim() : '';
  if (!added) return before;

  const after = clean([added, ...before]);
  try {
    storage.setItem(RECENT_SPECIES_KEY, JSON.stringify(after));
    return after;
  } catch {
    return before;
  }
}
