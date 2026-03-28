import { get, set } from 'idb-keyval';

// Keys for our three stores
const SAVED_CALCS_KEY = 'fish-calc-saved-calcs';
const CUSTOM_YIELDS_KEY = 'fish-calc-custom-yields';
const CUSTOM_SPECIES_KEY = 'fish-calc-custom-species';

// --- Generic synced store factory ---

function createSyncedStore(storageKey) {
  const getAll = async () => (await get(storageKey)) || [];

  const add = async (item) => {
    const items = await getAll();
    const newItem = {
      ...item,
      id: item.id || crypto.randomUUID(),
      syncStatus: 'local',
      updatedAt: new Date().toISOString(),
      createdAt: item.createdAt || new Date().toISOString(),
    };
    items.push(newItem);
    await set(storageKey, items);
    return newItem;
  };

  const update = async (id, data) => {
    const items = await getAll();
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) return null;
    items[index] = {
      ...items[index],
      ...data,
      syncStatus: items[index].syncStatus === 'synced' ? 'local' : items[index].syncStatus,
      updatedAt: new Date().toISOString(),
    };
    await set(storageKey, items);
    return items[index];
  };

  const remove = async (id) => {
    const items = await getAll();
    const item = items.find((i) => i.id === id);
    if (!item) return;

    if (item.syncStatus === 'synced') {
      item.syncStatus = 'pending-delete';
      item.updatedAt = new Date().toISOString();
      await set(storageKey, items);
    } else {
      await set(storageKey, items.filter((i) => i.id !== id));
    }
  };

  const markSynced = async (id, serverId) => {
    const items = await getAll();
    const item = items.find((i) => i.id === id);
    if (item) {
      item.syncStatus = 'synced';
      if (serverId) item.serverId = serverId;
      await set(storageKey, items);
    }
  };

  const removeSyncedDelete = async (id) => {
    const items = await getAll();
    await set(storageKey, items.filter((i) => i.id !== id));
  };

  return { getAll, add, update, remove, markSynced, removeSyncedDelete };
}

// --- Store instances ---

const calcsStore = createSyncedStore(SAVED_CALCS_KEY);
const yieldsStore = createSyncedStore(CUSTOM_YIELDS_KEY);

// --- Named exports for backward compatibility ---

export const getSavedCalcs = calcsStore.getAll;
export const addSavedCalc = calcsStore.add;
export const deleteSavedCalc = calcsStore.remove;

export const getCustomYields = yieldsStore.getAll;
export const addCustomYield = yieldsStore.add;
export const updateCustomYield = yieldsStore.update;
export const deleteCustomYield = yieldsStore.remove;

// --- Sync helpers (typed exports instead of string dispatch) ---

export const markCalcSynced = calcsStore.markSynced;
export const markYieldSynced = yieldsStore.markSynced;
export const removeCalcSyncedDelete = calcsStore.removeSyncedDelete;
export const removeYieldSyncedDelete = yieldsStore.removeSyncedDelete;

export async function getAllPendingSync() {
  const [calcs, yields] = await Promise.all([calcsStore.getAll(), yieldsStore.getAll()]);
  return {
    calcs: calcs.filter((c) => c.syncStatus === 'local' || c.syncStatus === 'pending-delete'),
    yields: yields.filter((y) => y.syncStatus === 'local' || y.syncStatus === 'pending-delete'),
  };
}

// --- Custom Species (different data model, no sync) ---

export async function getCustomSpecies() {
  return (await get(CUSTOM_SPECIES_KEY)) || {};
}

export async function setCustomSpecies(data) {
  await set(CUSTOM_SPECIES_KEY, data);
}

// --- Bulk merge operations (keep separate due to different field mappings) ---

export async function mergeSyncedCalcs(serverCalcs) {
  const local = await calcsStore.getAll();
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
  const local = await yieldsStore.getAll();
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
