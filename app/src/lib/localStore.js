import { get, set } from 'idb-keyval';

const CUSTOM_SPECIES_KEY = 'fish-calc-custom-species';

export async function getCustomSpecies() {
  return (await get(CUSTOM_SPECIES_KEY)) || {};
}

export async function setCustomSpecies(data) {
  await set(CUSTOM_SPECIES_KEY, data);
}
