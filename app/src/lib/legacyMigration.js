import { get, set } from 'idb-keyval';
import { createRepository, getInstallationId } from './localRepository';

// --- Legacy store keys (read-only; never written by new code) ---
const LEGACY_CALCS_KEY = 'fish-calc-saved-calcs';
const LEGACY_YIELDS_KEY = 'fish-calc-custom-yields';

// --- Migration state ---
const MIGRATION_MARKER_KEY = 'fish-calc:legacy-migration:v1';

// --- Recovery scope ---

export function recoveryScope(storage = globalThis.localStorage) {
  return `recovery:${getInstallationId(storage)}`;
}

/**
 * Run the one-time legacy migration. Safe to call on every startup.
 *
 * Reads the unscoped legacy IDB stores, discards records that are clean
 * synchronized cache (syncStatus === 'synced' — can be re-fetched from the server),
 * and copies unsynchronized records and tombstones into the recovery scope without
 * changing their payloads. The migration marker prevents re-running, but the logic
 * is idempotent against a partial prior run (duplicates detected via legacyId).
 *
 * Custom species (fish-calc-custom-species) are device-local and excluded.
 *
 * @param {object} [opts]
 * @param {{ get: Function, set: Function }} [opts.store] - idb-keyval adapter for tests
 * @param {LocalRepository} [opts.recoveryRepo] - recovery repo override for tests
 * @param {Storage} [opts.localStorage] - localStorage override for recoveryScope
 * @returns {Promise<{ alreadyDone: boolean, calcs: number, yields: number }>}
 */
export async function migrateLegacyRecords({ store, recoveryRepo, localStorage: ls } = {}) {
  const storeGet = store ? store.get : get;
  const storeSet = store ? store.set : set;

  const marker = await storeGet(MIGRATION_MARKER_KEY);
  if (marker === 'done') return { alreadyDone: true, calcs: 0, yields: 0 };

  const [rawCalcs, rawYields] = await Promise.all([
    storeGet(LEGACY_CALCS_KEY),
    storeGet(LEGACY_YIELDS_KEY),
  ]);

  // Discard synced records (clean cache; safely re-fetched after sign-in).
  const calcsToRecover = (rawCalcs || []).filter((c) => c.syncStatus !== 'synced');
  const yieldsToRecover = (rawYields || []).filter((y) => y.syncStatus !== 'synced');

  if (calcsToRecover.length > 0 || yieldsToRecover.length > 0) {
    const repo = recoveryRepo || createRepository(recoveryScope(ls), { store });

    // Load existing recovery records so we can skip any already copied (partial run restart).
    const [existingCalcs, existingYields] = await Promise.all([
      repo.getCalcs(),
      repo.getYields(),
    ]);
    const seenCalcIds = new Set(existingCalcs.map((c) => c.legacyId).filter(Boolean));
    const seenYieldIds = new Set(existingYields.map((y) => y.legacyId).filter(Boolean));

    for (const c of calcsToRecover) {
      if (seenCalcIds.has(c.id)) continue;
      // Preserve original payload; give it a new scope-local id in the recovery repo.
      // legacyId tracks the original id for deduplication on restart.
      const { id, scope: _scope, syncStatus: _syncStatus, serverId: _serverId, ...rest } = c;      await repo.addCalc({ ...rest, legacyId: id, syncStatus: 'local' });
    }
    for (const y of yieldsToRecover) {
      if (seenYieldIds.has(y.id)) continue;
      const { id, scope: _scope, syncStatus: _syncStatus, serverId: _serverId, serverRevision: _serverRevision, ...rest } = y;      await repo.addYield({ ...rest, legacyId: id, syncStatus: 'local' });
    }
  }

  await storeSet(MIGRATION_MARKER_KEY, 'done');

  return { alreadyDone: false, calcs: calcsToRecover.length, yields: yieldsToRecover.length };
}

/**
 * Count records currently in the recovery scope.
 */
export async function getRecoveryCounts({ store, recoveryRepo, localStorage: ls } = {}) {
  const repo = recoveryRepo || createRepository(recoveryScope(ls), { store });
  const [calcs, yields] = await Promise.all([repo.getCalcs(), repo.getYields()]);
  return { calcs: calcs.length, yields: yields.length, total: calcs.length + yields.length };
}

/**
 * Copy all recovery records into accountRepo as new local records, then clear
 * the recovery scope. Idempotent: safe to call if some records were already
 * assigned (they would generate new local copies in the account scope).
 *
 * @param {LocalRepository} accountRepo - the active account repository
 * @param {object} [opts]
 */
export async function assignRecoveryToAccount(accountRepo, { store, recoveryRepo, localStorage: ls } = {}) {
  const repo = recoveryRepo || createRepository(recoveryScope(ls), { store });
  const [calcs, yields] = await Promise.all([repo.getCalcs(), repo.getYields()]);

  for (const c of calcs) {
    const { legacyId: _legacyId, scope: _scope, syncStatus: _syncStatus, serverId: _serverId, id: _id, updatedAt: _updatedAt, ...rest } = c;    await accountRepo.addCalc({ ...rest, syncStatus: 'local' });
  }
  for (const y of yields) {
    const { legacyId: _legacyId, scope: _scope, syncStatus: _syncStatus, serverId: _serverId, serverRevision: _serverRevision, id: _id, updatedAt: _updatedAt, ...rest } = y;    await accountRepo.addYield({ ...rest, syncStatus: 'local' });
  }

  await repo.clearAll();
}

/**
 * Discard all records in the recovery scope without assigning them anywhere.
 */
export async function discardRecovery({ store, recoveryRepo, localStorage: ls } = {}) {
  const repo = recoveryRepo || createRepository(recoveryScope(ls), { store });
  await repo.clearAll();
}
