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
    // Per-key promise chains serialize concurrent read-modify-write mutations.
    this._locks = new Map();
  }

  // Runs fn exclusively for key: waits for any in-flight mutation on the same key to finish first.
  _withLock(key, fn) {
    const chain = (this._locks.get(key) || Promise.resolve()).then(fn);
    // Store a never-rejecting tail so future callers don't inherit this call's error.
    this._locks.set(key, chain.then(() => {}, () => {}));
    return chain;
  }

  // ---- Saved Calculations (immutable snapshots) ----

  async getCalcs() {
    const all = (await this._get(idbKey(this._scope, 'calcs'))) || [];
    return all.filter((c) => c.syncStatus !== 'pending-delete');
  }

  async addCalc(inputs) {
    const key = idbKey(this._scope, 'calcs');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const record = { is_private: true, ...makeRecord(inputs, this._scope) };
      all.push(record);
      await this._set(key, all);
      return record;
    });
  }

  // Update is_private on a local calc record (optimistic update after publish/unpublish).
  async updateCalcPublicationState(id, is_private) {
    const key = idbKey(this._scope, 'calcs');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      all[idx] = { ...all[idx], is_private };
      await this._set(key, all);
      return all[idx];
    });
  }

  // Only display metadata (name) may be changed on a snapshot.
  // Rename is intentionally local-only: the name never reaches the sync queue.
  // syncStatus is preserved so a rename does not re-queue a synced record.
  // Records arriving on a new device will carry the original name from the server.
  async renameCalc(id, name) {
    const key = idbKey(this._scope, 'calcs');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      all[idx] = { ...all[idx], name, updatedAt: now() };
      await this._set(key, all);
      return all[idx];
    });
  }

  async removeCalc(id) {
    const key = idbKey(this._scope, 'calcs');
    return this._withLock(key, async () => {
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
    });
  }

  async markCalcSynced(id, serverId) {
    const key = idbKey(this._scope, 'calcs');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((c) => c.id === id);
      if (idx === -1) return;
      all[idx] = { ...all[idx], syncStatus: 'synced', serverId, updatedAt: now() };
      await this._set(key, all);
    });
  }

  async removeCalcTombstone(id) {
    const key = idbKey(this._scope, 'calcs');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      await this._set(key, all.filter((c) => c.id !== id));
    });
  }

  async mergeServerCalcs(serverCalcs) {
    const key = idbKey(this._scope, 'calcs');
    return this._withLock(key, async () => {
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
          is_private: sc.is_private ?? true,
          createdAt: sc.created_at ?? ts,
          updatedAt: sc.updated_at ?? ts,
        });
      }

      // Update is_private for calcs already tracked (publication state may change without resync).
      for (const sc of serverCalcs) {
        const localId = all.find((c) => c.serverId != null && String(c.serverId) === String(sc.id))?.id;
        if (!localId) continue;
        const idx = all.findIndex((c) => c.id === localId);
        if (idx === -1) continue;
        if (all[idx].is_private !== (sc.is_private ?? true)) {
          all[idx] = { ...all[idx], is_private: sc.is_private ?? true };
        }
      }
      await this._set(key, all);
    });
  }

  // ---- Custom Yields (revisioned observations) ----
  // Note: custom species (fish species definitions) are device-local and stored
  // outside this repository, in the existing species store layer.

  async getYields() {
    const all = (await this._get(idbKey(this._scope, 'yields'))) || [];
    return all.filter((y) => y.syncStatus !== 'pending-delete');
  }

  async getConflictedYields() {
    const all = (await this._get(idbKey(this._scope, 'yields'))) || [];
    return all.filter((y) => y.syncStatus === 'conflicted' || y.syncStatus === 'conflict-delete');
  }

  async addYield(data) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const record = makeRecord(data, this._scope);
      all.push(record);
      await this._set(key, all);
      return record;
    });
  }

  async updateYield(id, data) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((y) => y.id === id);
      if (idx === -1) return null;
      const prev = all[idx];
      all[idx] = {
        ...prev,
        ...data,
        id: prev.id,
        scope: this._scope,
        serverId: prev.serverId,
        createdAt: prev.createdAt,
        syncStatus: prev.syncStatus === 'synced' ? 'local' : prev.syncStatus,
        updatedAt: now(),
      };
      await this._set(key, all);
      return all[idx];
    });
  }

  async removeYield(id) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
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
    });
  }

  // Transition a local yield to 'conflicted' after a 409 push response.
  // Stores the current local payload so the resolution UI can compare versions.
  // The conflictServer field is populated later by mergeServerYields on pull.
  async markYieldConflicted(id) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((y) => y.id === id);
      if (idx === -1) return;
      const rec = all[idx];
      // Skip if already resolved, deleted, or tombstoned by a concurrent operation.
      if (rec.syncStatus === 'synced' || rec.syncStatus === 'pending-delete' || rec.syncStatus === 'conflict-delete') return;
      all[idx] = {
        ...rec,
        syncStatus: 'conflicted',
        conflictLocal: {
          species: rec.species,
          product: rec.product,
          yield: rec.yield,
          source: rec.source,
          updatedAt: rec.updatedAt,
        },
        conflictServer: null,
        updatedAt: now(),
      };
      await this._set(key, all);
    });
  }

  // Transition a pending-delete yield to 'conflict-delete' after a 409 on DELETE.
  // Held without auto-resolving — requires product decision to restore or remove.
  async holdStaleYieldDelete(id) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((y) => y.id === id);
      if (idx === -1) return;
      const rec = all[idx];
      if (rec.syncStatus !== 'pending-delete') return;
      all[idx] = {
        ...rec,
        syncStatus: 'conflict-delete',
        conflictServer: null,
        updatedAt: now(),
      };
      await this._set(key, all);
    });
  }

  // Resolve a 'conflicted' yield.
  // action: 'use-local' | 'use-server' | 'keep-both'
  // Returns the updated or newly-created record, or null if not found.
  async resolveYieldConflict(id, action) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((y) => y.id === id);
      if (idx === -1) return null;
      const rec = all[idx];
      if (rec.syncStatus !== 'conflicted') return null;

      const server = rec.conflictServer;
      const local = rec.conflictLocal;
      const ts = now();

      if (action === 'use-local') {
        // Retry local edit stamped with the server's current revision so the next PUT succeeds.
        // Carry over server is_shared so sharing state stays consistent.
        all[idx] = {
          ...rec,
          is_shared: server?.is_shared ?? rec.is_shared,
          syncStatus: 'local',
          serverRevision: server?.serverRevision ?? rec.serverRevision,
          conflictLocal: undefined,
          conflictServer: undefined,
          updatedAt: ts,
        };
        await this._set(key, all);
        return all[idx];
      }

      if (action === 'use-server') {
        // Require a populated server snapshot before accepting server state.
        if (!server) return null;
        // Accept server state as ground truth; mark synced.
        all[idx] = {
          ...rec,
          species: server?.species ?? rec.species,
          product: server?.product ?? rec.product,
          yield: server?.yield ?? rec.yield,
          source: server?.source ?? rec.source,
          is_shared: server?.is_shared ?? rec.is_shared,
          serverRevision: server?.serverRevision ?? rec.serverRevision,
          syncStatus: 'synced',
          conflictLocal: undefined,
          conflictServer: undefined,
          updatedAt: ts,
        };
        await this._set(key, all);
        return all[idx];
      }

      if (action === 'keep-both') {
        // Require a populated server snapshot before creating a forked record.
        if (!server) return null;
        // Accept server state for the existing record; create a new local record for the local edit.
        // The new record has a fresh id and no serverId, guaranteeing no duplicate remote identity.
        const newRecord = {
          id: crypto.randomUUID(),
          scope: this._scope,
          species: local?.species ?? rec.species,
          product: local?.product ?? rec.product,
          yield: local?.yield ?? rec.yield,
          source: local?.source ?? rec.source,
          syncStatus: 'local',
          createdAt: ts,
          updatedAt: ts,
        };
        all[idx] = {
          ...rec,
          species: server?.species ?? rec.species,
          product: server?.product ?? rec.product,
          yield: server?.yield ?? rec.yield,
          source: server?.source ?? rec.source,
          is_shared: server?.is_shared ?? rec.is_shared,
          serverRevision: server?.serverRevision ?? rec.serverRevision,
          syncStatus: 'synced',
          conflictLocal: undefined,
          conflictServer: undefined,
          updatedAt: ts,
        };
        all.push(newRecord);
        await this._set(key, all);
        return newRecord;
      }

      return null;
    });
  }

  // Dismiss a 'conflict-delete' record — accept the server version.
  // If conflictServer is available, restore it as a synced local copy so the
  // record is immediately visible without waiting for the next pull.
  // If conflictServer is missing (rare: pull hasn't happened yet), remove the
  // tombstone and let the next sync restore it from the server.
  async dismissYieldDeleteConflict(id) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((y) => y.id === id);
      if (idx === -1) return;
      const rec = all[idx];
      if (rec.syncStatus !== 'conflict-delete') return;
      const server = rec.conflictServer;
      if (server) {
        // Restore the server snapshot as a locally-synced record.
        all[idx] = {
          ...server,
          id: rec.id,
          syncStatus: 'synced',
          conflictLocal: undefined,
          conflictServer: undefined,
          updatedAt: now(),
        };
      } else {
        // Server snapshot not yet fetched; remove tombstone and rely on next pull.
        all.splice(idx, 1);
      }
      await this._set(key, all);
    });
  }

  async markYieldSynced(id, serverId, serverRevision) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      const idx = all.findIndex((y) => y.id === id);
      if (idx === -1) return;
      all[idx] = { ...all[idx], syncStatus: 'synced', serverId, serverRevision, updatedAt: now() };
      await this._set(key, all);
    });
  }

  async removeYieldTombstone(id) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      await this._set(key, all.filter((y) => y.id !== id));
    });
  }

  async mergeServerYields(serverYields) {
    const key = idbKey(this._scope, 'yields');
    return this._withLock(key, async () => {
      const all = (await this._get(key)) || [];
      // Map serverId → local id for quick lookup.
      // Covers synced records, tombstones, and conflict records — all have serverId set.
      const byServerId = new Map(
        all.filter((y) => y.serverId).map((y) => [String(y.serverId), y.id])
      );

      for (const sy of serverYields) {
        const localId = byServerId.get(String(sy.id));
        if (!localId) {
          // New from server — insert as synced.
          const ts = now();
          all.push({
            species: sy.species,
            product: sy.product,
            yield: sy.yield,
            source: sy.source || 'User Input',
            is_shared: sy.is_shared ?? false,
            id: crypto.randomUUID(),
            scope: this._scope,
            serverId: sy.id,
            serverRevision: sy.revision,
            syncStatus: 'synced',
            createdAt: ts,
            updatedAt: ts,
          });
          continue;
        }

        // Known record — update conflictServer snapshot for conflicted/conflict-delete records
        // so the resolution UI can show the current server state.
        const idx = all.findIndex((y) => y.id === localId);
        if (idx === -1) continue;
        const rec = all[idx];
        if (rec.syncStatus === 'conflicted' || rec.syncStatus === 'conflict-delete') {
          all[idx] = {
            ...rec,
            conflictServer: {
              serverId: sy.id,
              serverRevision: sy.revision,
              species: sy.species,
              product: sy.product,
              yield: sy.yield,
              source: sy.source || 'User Input',
              is_shared: sy.is_shared ?? false,
            },
          };
        }
        // pending-delete, local, synced: no change needed
      }

      await this._set(key, all);
    });
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

  // ---- Sign-out cache management ----

  // Remove all synced records (safe to discard — can be re-fetched from server on next login).
  // Called on every sign-out path before auth.logout().
  async clearSyncedCache() {
    const calcsKey = idbKey(this._scope, 'calcs');
    const yieldsKey = idbKey(this._scope, 'yields');
    await Promise.all([
      this._withLock(calcsKey, async () => {
        const all = (await this._get(calcsKey)) || [];
        await this._set(calcsKey, all.filter((c) => c.syncStatus !== 'synced'));
      }),
      this._withLock(yieldsKey, async () => {
        const all = (await this._get(yieldsKey)) || [];
        await this._set(yieldsKey, all.filter((y) => y.syncStatus !== 'synced'));
      }),
    ]);
  }

  // Remove unsynchronized records (local edits and pending-delete tombstones).
  // Called when the user chooses "Discard" in the sign-out guard modal.
  // Combine with clearSyncedCache() to empty the scope entirely before sign-out.
  async discardUnsynchronized() {
    const calcsKey = idbKey(this._scope, 'calcs');
    const yieldsKey = idbKey(this._scope, 'yields');
    await Promise.all([
      this._withLock(calcsKey, async () => {
        const all = (await this._get(calcsKey)) || [];
        await this._set(calcsKey, all.filter((c) => c.syncStatus === 'synced'));
      }),
      this._withLock(yieldsKey, async () => {
        const all = (await this._get(yieldsKey)) || [];
        await this._set(yieldsKey, all.filter((y) => y.syncStatus === 'synced'));
      }),
    ]);
  }
}

// --- Factory ---

// Callers must use a single repository instance per scope. Concurrent instances
// for the same scope share the same IDB keys but have independent lock maps,
// so concurrent mutations will race and can corrupt the stored collection.
export function createRepository(scope, options) {
  return new LocalRepository(scope, options);
}
