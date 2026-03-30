import { apiUrl } from '../config/api';
import {
  getAllPendingSync,
  markCalcSynced,
  markYieldSynced,
  removeCalcSyncedDelete,
  removeYieldSyncedDelete,
  mergeSyncedCalcs,
  mergeSyncedYields,
} from './localStore';

/**
 * Sync all pending local changes to the server, then pull latest.
 * Uses cookie-based auth (Better Auth) — no token parameter needed.
 * @returns {Promise<{pushed: number, pulled: number, errors: number, errorDetails: Array}>}
 */
export async function syncAll() {
  const stats = { pushed: 0, pulled: 0, errors: 0, errorDetails: [] };

  const fetchOpts = { credentials: 'include' };
  const jsonHeaders = { 'Content-Type': 'application/json' };

  // --- Push local changes ---
  const pending = await getAllPendingSync();

  // Push new/updated calcs
  for (const calc of pending.calcs.filter((c) => c.syncStatus === 'local')) {
    try {
      const res = await fetch(apiUrl('/api/save-calc'), {
        method: 'POST',
        headers: jsonHeaders,
        ...fetchOpts,
        body: JSON.stringify({
          name: calc.name || '',
          species: calc.species,
          product: calc.product,
          mode: calc.mode,
          cost: calc.cost,
          target_weight: calc.target_weight,
          yield_value: calc.yield,
          result: calc.result,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await markCalcSynced(calc.id, data.id);
        stats.pushed++;
      } else {
        stats.errors++;
        stats.errorDetails.push({ type: 'push-calc', id: calc.id, status: res.status, isAuthError: res.status === 401 });
        if (res.status === 401) break;
      }
    } catch (err) {
      stats.errors++;
      stats.errorDetails.push({ type: 'push-calc', id: calc.id, message: err.message });
    }
  }

  // Push deleted calcs
  for (const calc of pending.calcs.filter((c) => c.syncStatus === 'pending-delete')) {
    try {
      if (calc.serverId) {
        const res = await fetch(apiUrl(`/api/saved-calcs/${calc.serverId}`), {
          method: 'DELETE',
          headers: jsonHeaders,
          ...fetchOpts,
        });
        if (res.ok || res.status === 404) {
          await removeCalcSyncedDelete(calc.id);
          stats.pushed++;
        } else {
          stats.errors++;
          stats.errorDetails.push({ type: 'delete-calc', id: calc.id, status: res.status, isAuthError: res.status === 401 });
          if (res.status === 401) break;
        }
      } else {
        await removeCalcSyncedDelete(calc.id);
        stats.pushed++;
      }
    } catch (err) {
      stats.errors++;
      stats.errorDetails.push({ type: 'delete-calc', id: calc.id, message: err.message });
    }
  }

  // Push new/updated yields
  for (const yld of pending.yields.filter((y) => y.syncStatus === 'local')) {
    try {
      const res = await fetch(apiUrl('/api/user-data'), {
        method: 'POST',
        headers: jsonHeaders,
        ...fetchOpts,
        body: JSON.stringify({
          species: yld.species,
          product: yld.product,
          yield_percentage: yld.yield,
          source: yld.source || 'User Input',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await markYieldSynced(yld.id, data.id);
        stats.pushed++;
      } else {
        stats.errors++;
        stats.errorDetails.push({ type: 'push-yield', id: yld.id, status: res.status, isAuthError: res.status === 401 });
        if (res.status === 401) break;
      }
    } catch (err) {
      stats.errors++;
      stats.errorDetails.push({ type: 'push-yield', id: yld.id, message: err.message });
    }
  }

  // Push deleted yields
  for (const yld of pending.yields.filter((y) => y.syncStatus === 'pending-delete')) {
    try {
      if (yld.serverId) {
        const res = await fetch(apiUrl(`/api/user-data/${yld.serverId}`), {
          method: 'DELETE',
          headers: jsonHeaders,
          ...fetchOpts,
        });
        if (res.ok || res.status === 404) {
          await removeYieldSyncedDelete(yld.id);
          stats.pushed++;
        } else {
          stats.errors++;
          stats.errorDetails.push({ type: 'delete-yield', id: yld.id, status: res.status, isAuthError: res.status === 401 });
          if (res.status === 401) break;
        }
      } else {
        await removeYieldSyncedDelete(yld.id);
        stats.pushed++;
      }
    } catch (err) {
      stats.errors++;
      stats.errorDetails.push({ type: 'delete-yield', id: yld.id, message: err.message });
    }
  }

  // --- Pull server data ---
  try {
    const res = await fetch(apiUrl('/api/saved-calcs'), { headers: jsonHeaders, ...fetchOpts });
    if (res.ok) {
      const serverCalcs = await res.json();
      if (Array.isArray(serverCalcs)) {
        await mergeSyncedCalcs(serverCalcs);
        stats.pulled += serverCalcs.length;
      }
    }
  } catch {
    // Pull errors are non-critical — local data is still intact
  }

  try {
    const res = await fetch(apiUrl('/api/user-data'), { headers: jsonHeaders, ...fetchOpts });
    if (res.ok) {
      const serverYields = await res.json();
      if (Array.isArray(serverYields)) {
        await mergeSyncedYields(serverYields);
        stats.pulled += serverYields.length;
      }
    }
  } catch {
    // Pull errors are non-critical — local data is still intact
  }

  return stats;
}
