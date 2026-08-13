import { get, set } from 'idb-keyval';

const INSTALLATION_ID_KEY = 'fish-calc:installation-id';

// --- Identity ---

let _fallbackInstallationId = null;

export function getInstallationId(storage = globalThis.localStorage) {
  if (!storage) {
    // Cache the fallback so guestScope() is stable for the session when localStorage is unavailable.
    _fallbackInstallationId ||= crypto.randomUUID();
    return _fallbackInstallationId;
  }
  let id = storage.getItem(INSTALLATION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem(INSTALLATION_ID_KEY, id);
  }
  return id;
}

export function guestScope(storage = globalThis.localStorage) {
  return `guest:${getInstallationId(storage)}`;
}

export function accountScope(uid) {
  return `account:${uid}`;
}

// --- Internal ---

function idbKey(scope, collection) {
  return `fish-calc:repo:${scope}:${collection}`;
}

function now() {
  return new Date().toISOString();
}

function makeRecord(data, scope) {
  const ts = now();
  return {
    ...data,
    id: data.id || crypto.randomUUID(),
    scope,
    syncStatus: 'local',
    createdAt: data.createdAt || ts,
    updatedAt: ts,
  };
}

// --- Repository class ---

class LocalRepository {
  constructor(scope, { store = { get, set } } = {}) {
    this._scope = scope;
    this._get = store.get;
    this._set = store.set;
  }

  // ---- Saved Calculations (immutable snapshots) ----

  async getCalcs() {
    const all = (await this._get(idbKey(this._scope, 'calcs'))) || [];
    return all.filter((c) => c.syncStatus !== 'pending-delete');
  }

  async addCalc(inputs) {
    const key = idbKey(this._scope, 'calcs');
    const all = (await this._get(key)) || [];
    const record = makeRecord(inputs, this._scope);
    all.push(record);
    await this._set(key, all);
    return record;
  }

  // Only display metadata (name) may be changed on a snapshot.
  // Rename is intentionally local-only: the name never reaches the sync queue.
  // Records arriving on a new device will carry the original name from the server.
  async renameCalc(id, name) {
    const key = idbKey(this._scope, 'calcs');
    const all = (await this._get(key)) || [];
    const idx = all.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], name, updatedAt: now() };
    await this._set(key, all);
    return all[idx];
  }

  async removeCalc(id) {
    const key = idbKey(this._scope, 'calcs');
    const all = (await this._get(key)) || [];
    const idx = all.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const rec = all[idx];
    if (rec.syncStatus === 'synced' || rec.serverId) {
      all[idx] = { ...rec, syncStatus: 'pending-delete', updatedAt: now() };
    } else {
      all.splice(idx, 1);
    }
    await this._set(key, all);
  }

  async markCalcSynced(id, serverId) {
    const key = idbKey(this._scope, 'calcs');
    const all = (await this._get(key)) || [];
    const idx = all.findIndex((c) => c.id === id);
    if (idx === -1) return;
    all[idx] = { ...all[idx], syncStatus: 'synced', serverId, updatedAt: now() };
    await this._set(key, all);
  }

  async removeCalcTombstone(id) {
    const key = idbKey(this._scope, 'calcs');
    const all = (await this._get(key)) || [];
    await this._set(key, all.filter((c) => c.id !== id));
  }

  async mergeServerCalcs(serverCalcs) {
    const key = idbKey(this._scope, 'calcs');
    const all = (await this._get(key)) || [];
    // trackedIds covers synced records AND tombstones (pending-delete) — both have serverId set.
    const trackedIds = new Set(all.filter((c) => c.serverId).map((c) => String(c.serverId)));
    for (const sc of serverCalcs) {
      if (trackedIds.has(String(sc.id))) continue;
      const ts = sc.created_at || now();
      all.push({
        id: crypto.randomUUID(),
        scope: this._scope,
        serverId: sc.id,
        syncStatus: 'synced',
        species: sc.species,
        product: sc.product,
        cost: sc.cost,
        yield: sc.yield,
        result: sc.result,
        name: sc.name,
        createdAt: ts,
        updatedAt: ts,
      });
    }
    await this._set(key, all);
  }

  // ---- Custom Yields (revisioned observations) ----

  async getYields() {
    const all = (await this._get(idbKey(this._scope, 'yields'))) || [];
    return all.filter((y) => y.syncStatus !== 'pending-delete');
  }

  async addYield(data) {
    const key = idbKey(this._scope, 'yields');
    const all = (await this._get(key)) || [];
    const record = makeRecord(data, this._scope);
    all.push(record);
    await this._set(key, all);
    return record;
  }

  async updateYield(id, data) {
    const key = idbKey(this._scope, 'yields');
    const all = (await this._get(key)) || [];
    const idx = all.findIndex((y) => y.id === id);
    if (idx === -1) return null;
    const prev = all[idx];
    all[idx] = {
      ...prev,
      ...data,
      id: prev.id,
      scope: this._scope,
      syncStatus: prev.syncStatus === 'synced' ? 'local' : prev.syncStatus,
      updatedAt: now(),
    };
    await this._set(key, all);
    return all[idx];
  }

  async removeYield(id) {
    const key = idbKey(this._scope, 'yields');
    const all = (await this._get(key)) || [];
    const idx = all.findIndex((y) => y.id === id);
    if (idx === -1) return;
    const rec = all[idx];
    if (rec.syncStatus === 'synced' || rec.serverId) {
      all[idx] = { ...rec, syncStatus: 'pending-delete', updatedAt: now() };
    } else {
      all.splice(idx, 1);
    }
    await this._set(key, all);
  }

  async markYieldSynced(id, serverId) {
    const key = idbKey(this._scope, 'yields');
    const all = (await this._get(key)) || [];
    const idx = all.findIndex((y) => y.id === id);
    if (idx === -1) return;
    all[idx] = { ...all[idx], syncStatus: 'synced', serverId, updatedAt: now() };
    await this._set(key, all);
  }

  async removeYieldTombstone(id) {
    const key = idbKey(this._scope, 'yields');
    const all = (await this._get(key)) || [];
    await this._set(key, all.filter((y) => y.id !== id));
  }

  async mergeServerYields(serverYields) {
    const key = idbKey(this._scope, 'yields');
    const all = (await this._get(key)) || [];
    // trackedIds covers synced records AND tombstones (pending-delete) — both have serverId set,
    // so a tombstoned yield is never resurrected by a server merge.
    const trackedIds = new Set(all.filter((y) => y.serverId).map((y) => String(y.serverId)));
    for (const sy of serverYields) {
      if (trackedIds.has(String(sy.id))) continue;
      const ts = now();
      all.push({
        species: sy.species,
        product: sy.product,
        yield: sy.yield,
        source: sy.source || 'User Input',
        id: crypto.randomUUID(),
        scope: this._scope,
        serverId: sy.id,
        syncStatus: 'synced',
        createdAt: ts,
        updatedAt: ts,
      });
    }
    await this._set(key, all);
  }

  // ---- Sync queue ----

  async getPendingSync() {
    const [calcsRaw, yieldsRaw] = await Promise.all([
      this._get(idbKey(this._scope, 'calcs')),
      this._get(idbKey(this._scope, 'yields')),
    ]);
    const allCalcs = calcsRaw || [];
    const allYields = yieldsRaw || [];
    return {
      calcs: allCalcs.filter((c) => c.syncStatus === 'local' || c.syncStatus === 'pending-delete'),
      yields: allYields.filter((y) => y.syncStatus === 'local' || y.syncStatus === 'pending-delete'),
    };
  }
}

// --- Factory ---

export function createRepository(scope, options) {
  return new LocalRepository(scope, options);
}
