import { get, set } from 'idb-keyval';

// Keys for our three stores
const SAVED_CALCS_KEY = 'fish-calc-saved-calcs';
const CUSTOM_YIELDS_KEY = 'fish-calc-custom-yields';
const CUSTOM_SPECIES_KEY = 'fish-calc-custom-species';

// --- Saved Calculations ---

export async function getSavedCalcs() {
  return (await get(SAVED_CALCS_KEY)) || [];
}

export async function addSavedCalc(calc) {
  const calcs = await getSavedCalcs();
  const newCalc = {
    ...calc,
    id: calc.id || crypto.randomUUID(),
    syncStatus: 'local',
    updatedAt: new Date().toISOString(),
    createdAt: calc.createdAt || new Date().toISOString(),
  };
  calcs.push(newCalc);
  await set(SAVED_CALCS_KEY, calcs);
  return newCalc;
}

export async function deleteSavedCalc(id) {
  const calcs = await getSavedCalcs();
  const calc = calcs.find((c) => c.id === id);
  if (!calc) return;

  if (calc.syncStatus === 'synced') {
    // Mark for server deletion on next sync
    calc.syncStatus = 'pending-delete';
    calc.updatedAt = new Date().toISOString();
    await set(SAVED_CALCS_KEY, calcs);
  } else {
    // Local-only, just remove
    await set(SAVED_CALCS_KEY, calcs.filter((c) => c.id !== id));
  }
}

// --- Custom Yields ---

export async function getCustomYields() {
  return (await get(CUSTOM_YIELDS_KEY)) || [];
}

export async function addCustomYield(yieldData) {
  const yields = await getCustomYields();
  const newYield = {
    ...yieldData,
    id: yieldData.id || crypto.randomUUID(),
    syncStatus: 'local',
    updatedAt: new Date().toISOString(),
  };
  yields.push(newYield);
  await set(CUSTOM_YIELDS_KEY, yields);
  return newYield;
}

export async function updateCustomYield(id, data) {
  const yields = await getCustomYields();
  const index = yields.findIndex((y) => y.id === id);
  if (index === -1) return null;
  yields[index] = {
    ...yields[index],
    ...data,
    syncStatus: yields[index].syncStatus === 'synced' ? 'local' : yields[index].syncStatus,
    updatedAt: new Date().toISOString(),
  };
  await set(CUSTOM_YIELDS_KEY, yields);
  return yields[index];
}

export async function deleteCustomYield(id) {
  const yields = await getCustomYields();
  const yieldItem = yields.find((y) => y.id === id);
  if (!yieldItem) return;

  if (yieldItem.syncStatus === 'synced') {
    yieldItem.syncStatus = 'pending-delete';
    yieldItem.updatedAt = new Date().toISOString();
    await set(CUSTOM_YIELDS_KEY, yields);
  } else {
    await set(CUSTOM_YIELDS_KEY, yields.filter((y) => y.id !== id));
  }
}

// --- Custom Species ---

export async function getCustomSpecies() {
  return (await get(CUSTOM_SPECIES_KEY)) || {};
}

export async function setCustomSpecies(data) {
  await set(CUSTOM_SPECIES_KEY, data);
}

// --- Sync Helpers ---

export async function getAllPendingSync() {
  const calcs = await getSavedCalcs();
  const yields = await getCustomYields();
  return {
    calcs: calcs.filter((c) => c.syncStatus === 'local' || c.syncStatus === 'pending-delete'),
    yields: yields.filter((y) => y.syncStatus === 'local' || y.syncStatus === 'pending-delete'),
  };
}

export async function markSynced(store, id, serverId) {
  if (store === 'calcs') {
    const calcs = await getSavedCalcs();
    const calc = calcs.find((c) => c.id === id);
    if (calc) {
      calc.syncStatus = 'synced';
      if (serverId) calc.serverId = serverId;
      await set(SAVED_CALCS_KEY, calcs);
    }
  } else if (store === 'yields') {
    const yields = await getCustomYields();
    const yieldItem = yields.find((y) => y.id === id);
    if (yieldItem) {
      yieldItem.syncStatus = 'synced';
      if (serverId) yieldItem.serverId = serverId;
      await set(CUSTOM_YIELDS_KEY, yields);
    }
  }
}

export async function removeSyncedDelete(store, id) {
  if (store === 'calcs') {
    const calcs = await getSavedCalcs();
    await set(SAVED_CALCS_KEY, calcs.filter((c) => c.id !== id));
  } else if (store === 'yields') {
    const yields = await getCustomYields();
    await set(CUSTOM_YIELDS_KEY, yields.filter((y) => y.id !== id));
  }
}

// --- Bulk operations for sync ---

export async function mergeSyncedCalcs(serverCalcs) {
  const local = await getSavedCalcs();
  const localIds = new Set(local.map((c) => c.serverId || c.id));

  for (const sc of serverCalcs) {
    if (!localIds.has(String(sc.id))) {
      local.push({
        ...sc,
        serverId: sc.id,
        id: crypto.randomUUID(),
        syncStatus: 'synced',
        updatedAt: sc.created_at || new Date().toISOString(),
        createdAt: sc.created_at || new Date().toISOString(),
      });
    }
  }
  await set(SAVED_CALCS_KEY, local);
}

export async function mergeSyncedYields(serverYields) {
  const local = await getCustomYields();
  const localServerIds = new Set(local.filter((y) => y.serverId).map((y) => String(y.serverId)));

  for (const sy of serverYields) {
    if (!localServerIds.has(String(sy.id))) {
      local.push({
        species: sy.species,
        product: sy.product,
        yield: sy.yield_percentage,
        source: sy.source || 'User Input',
        serverId: sy.id,
        id: crypto.randomUUID(),
        syncStatus: 'synced',
        updatedAt: new Date().toISOString(),
      });
    }
  }
  await set(CUSTOM_YIELDS_KEY, local);
}
