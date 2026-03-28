import { apiUrl } from '../config/api';
import {
  getAllPendingSync,
  markSynced,
  removeSyncedDelete,
  mergeSyncedCalcs,
  mergeSyncedYields,
} from './localStore';

/**
 * Sync all pending local changes to the server, then pull latest.
 * @param {string} token - JWT auth token
 * @returns {Promise<{pushed: number, pulled: number, errors: number}>}
 */
export async function syncAll(token) {
  const stats = { pushed: 0, pulled: 0, errors: 0 };
  if (!token) return stats;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // --- Push local changes ---
  const pending = await getAllPendingSync();

  // Push new/updated calcs
  for (const calc of pending.calcs.filter((c) => c.syncStatus === 'local')) {
    try {
      const res = await fetch(apiUrl('/api/save-calc'), {
        method: 'POST',
        headers,
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
        await markSynced('calcs', calc.id, data.id);
        stats.pushed++;
      } else {
        stats.errors++;
      }
    } catch {
      stats.errors++;
    }
  }

  // Push deleted calcs
  for (const calc of pending.calcs.filter((c) => c.syncStatus === 'pending-delete')) {
    try {
      if (calc.serverId) {
        const res = await fetch(apiUrl(`/api/saved-calcs/${calc.serverId}`), {
          method: 'DELETE',
          headers,
        });
        if (res.ok || res.status === 404) {
          await removeSyncedDelete('calcs', calc.id);
          stats.pushed++;
        } else {
          stats.errors++;
        }
      } else {
        await removeSyncedDelete('calcs', calc.id);
        stats.pushed++;
      }
    } catch {
      stats.errors++;
    }
  }

  // Push new/updated yields
  for (const yld of pending.yields.filter((y) => y.syncStatus === 'local')) {
    try {
      const res = await fetch(apiUrl('/api/user-data'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          species: yld.species,
          product: yld.product,
          yield_percentage: yld.yield,
          source: yld.source || 'User Input',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await markSynced('yields', yld.id, data.id);
        stats.pushed++;
      } else {
        stats.errors++;
      }
    } catch {
      stats.errors++;
    }
  }

  // Push deleted yields
  for (const yld of pending.yields.filter((y) => y.syncStatus === 'pending-delete')) {
    try {
      if (yld.serverId) {
        const res = await fetch(apiUrl(`/api/user-data/${yld.serverId}`), {
          method: 'DELETE',
          headers,
        });
        if (res.ok || res.status === 404) {
          await removeSyncedDelete('yields', yld.id);
          stats.pushed++;
        } else {
          stats.errors++;
        }
      } else {
        await removeSyncedDelete('yields', yld.id);
        stats.pushed++;
      }
    } catch {
      stats.errors++;
    }
  }

  // --- Pull server data ---
  try {
    const res = await fetch(apiUrl('/api/saved-calcs'), { headers });
    if (res.ok) {
      const serverCalcs = await res.json();
      if (Array.isArray(serverCalcs)) {
        await mergeSyncedCalcs(serverCalcs);
        stats.pulled += serverCalcs.length;
      }
    }
  } catch {
    // Silently skip pull errors
  }

  try {
    const res = await fetch(apiUrl('/api/user-data'), { headers });
    if (res.ok) {
      const serverYields = await res.json();
      if (Array.isArray(serverYields)) {
        await mergeSyncedYields(serverYields);
        stats.pulled += serverYields.length;
      }
    }
  } catch {
    // Silently skip pull errors
  }

  return stats;
}
