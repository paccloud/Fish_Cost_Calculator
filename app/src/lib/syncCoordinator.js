import { getAuthHeaders, hasAuthCredential } from './authHeaders';
import { apiClient as defaultApiClient } from './apiClient';

/**
 * Create a scope-aware sync coordinator for a LocalRepository.
 *
 * The coordinator enforces single-flight per scope: concurrent triggers coalesce
 * into one run. Any call while a sync is in-flight returns the same promise.
 *
 * @param {LocalRepository} repo
 * @param {object} [client] - apiClient override (for tests)
 * @returns {{ sync(user): Promise<SyncStats>, pendingCount(): Promise<number> }}
 */
export function createSyncCoordinator(repo, client = defaultApiClient) {
  let _inFlight = null;

  /**
   * Run a push+pull sync for the given user session.
   * Concurrent callers receive the same in-flight promise.
   *
   * @param {object} user
   * @returns {Promise<SyncStats>}
   */
  function sync(user) {
    if (_inFlight) return _inFlight;
    _inFlight = _run(user).finally(() => { _inFlight = null; });
    return _inFlight;
  }

  /**
   * Count how many records are queued for sync (push or delete).
   * Used by the UI to decide whether to show actionable work.
   */
  async function pendingCount() {
    const { calcs, yields } = await repo.getPendingSync();
    return calcs.length + yields.length;
  }

  async function _run(user) {
    const stats = { pushed: 0, pulled: 0, errors: 0, errorDetails: [], conflicts: 0 };

    if (!hasAuthCredential(user)) return stats;

    const headers = await getAuthHeaders(user, { 'Content-Type': 'application/json' });
    if (!headers.Authorization) {
      stats.errors++;
      stats.errorDetails.push({ type: 'auth', isAuthError: true, message: 'Missing auth headers' });
      return stats;
    }

    const pending = await repo.getPendingSync();

    // ---- Push new/updated calcs ----
    for (const calc of pending.calcs.filter((c) => c.syncStatus === 'local')) {
      try {
        const res = await client.saveCalcRaw({
          name: calc.name || '',
          species: calc.species,
          product: calc.product,
          cost: calc.cost,
          yield: calc.yield,
          result: calc.result,
          client_id: calc.id,
        }, headers);
        if (res.ok) {
          const data = await res.json();
          await repo.markCalcSynced(calc.id, data.id);
          stats.pushed++;
        } else {
          stats.errors++;
          stats.errorDetails.push({ type: 'push-calc', id: calc.id, status: res.status, isAuthError: res.status === 401 });
          if (res.status === 401) return stats;
        }
      } catch (err) {
        stats.errors++;
        stats.errorDetails.push({ type: 'push-calc', id: calc.id, message: err.message });
      }
    }

    // ---- Push deleted calcs ----
    for (const calc of pending.calcs.filter((c) => c.syncStatus === 'pending-delete')) {
      try {
        if (calc.serverId) {
          const res = await client.deleteCalcRaw(calc.serverId, headers);
          if (res.ok || res.status === 404) {
            await repo.removeCalcTombstone(calc.id);
            stats.pushed++;
          } else {
            stats.errors++;
            stats.errorDetails.push({ type: 'delete-calc', id: calc.id, status: res.status, isAuthError: res.status === 401 });
            if (res.status === 401) return stats;
          }
        } else {
          await repo.removeCalcTombstone(calc.id);
          stats.pushed++;
        }
      } catch (err) {
        stats.errors++;
        stats.errorDetails.push({ type: 'delete-calc', id: calc.id, message: err.message });
      }
    }

    // ---- Push queued publication changes ----
    for (const calc of pending.calcs.filter((c) => c.syncStatus === 'pending-publish' || c.syncStatus === 'pending-unpublish')) {
      if (!calc.serverId) continue;
      try {
        const isPublish = calc.syncStatus === 'pending-publish';
        const res = isPublish
          ? await client.publishCalcRaw(calc.serverId, headers)
          : await client.unpublishCalcRaw(calc.serverId, headers);
        if (res.ok) {
          await repo.markCalcPublicationSynced(calc.id, !isPublish);
          stats.pushed++;
        } else {
          stats.errors++;
          stats.errorDetails.push({ type: isPublish ? 'publish-calc' : 'unpublish-calc', id: calc.id, status: res.status, isAuthError: res.status === 401 });
          if (res.status === 401) return stats;
        }
      } catch (err) {
        stats.errors++;
        stats.errorDetails.push({ type: 'publish-calc', id: calc.id, message: err.message });
      }
    }

    // ---- Push new/updated yields ----
    for (const yld of pending.yields.filter((y) => y.syncStatus === 'local')) {
      try {
        let res;
        if (yld.serverId) {
          res = await client.updateUserDataRaw(yld.serverId, {
            species: yld.species,
            product: yld.product,
            yield: yld.yield,
            source: yld.source || 'User Input',
            expected_revision: yld.serverRevision,
          }, headers);
        } else {
          res = await client.createUserDataRaw({
            species: yld.species,
            product: yld.product,
            yield: yld.yield,
            source: yld.source || 'User Input',
            client_id: yld.id,
          }, headers);
        }

        if (res.status === 409) {
          // Optimistic-concurrency conflict — server has a newer revision.
          // Capture the local payload and enter conflict state; pull phase will populate server snapshot.
          await repo.markYieldConflicted(yld.id);
          stats.conflicts++;
          continue;
        }

        if (res.ok) {
          const data = await res.json();
          if (yld.serverId) {
            await repo.markYieldSynced(yld.id, data.id ?? yld.serverId, data.revision);
          } else {
            // Reconciling PUT: ensure server holds current field values after idempotent POST.
            const putRes = await client.updateUserDataRaw(data.id, {
              species: yld.species,
              product: yld.product,
              yield: yld.yield,
              source: yld.source || 'User Input',
              expected_revision: data.revision,
            }, headers);
            if (!putRes.ok) {
              if (putRes.status === 409) {
                stats.conflicts++;
              }
              stats.errors++;
              stats.errorDetails.push({ type: 'push-yield', id: yld.id, status: putRes.status, isAuthError: putRes.status === 401 });
              if (putRes.status === 401) return stats;
              continue;
            }
            const finalRevision = (await putRes.json()).revision;
            await repo.markYieldSynced(yld.id, data.id, finalRevision);
          }
          stats.pushed++;
        } else {
          stats.errors++;
          stats.errorDetails.push({ type: 'push-yield', id: yld.id, status: res.status, isAuthError: res.status === 401 });
          if (res.status === 401) return stats;
        }
      } catch (err) {
        stats.errors++;
        stats.errorDetails.push({ type: 'push-yield', id: yld.id, message: err.message });
      }
    }

    // ---- Push deleted yields ----
    for (const yld of pending.yields.filter((y) => y.syncStatus === 'pending-delete')) {
      try {
        if (yld.serverId) {
          const res = await client.deleteUserDataRaw(yld.serverId, yld.serverRevision, headers);
          if (res.ok || res.status === 404) {
            await repo.removeYieldTombstone(yld.id);
            stats.pushed++;
          } else if (res.status === 409) {
            // Server has a newer revision — hold without auto-resolving or auto-restoring.
            await repo.holdStaleYieldDelete(yld.id);
            stats.conflicts++;
          } else {
            stats.errors++;
            stats.errorDetails.push({ type: 'delete-yield', id: yld.id, status: res.status, isAuthError: res.status === 401 });
            if (res.status === 401) return stats;
          }
        } else {
          await repo.removeYieldTombstone(yld.id);
          stats.pushed++;
        }
      } catch (err) {
        stats.errors++;
        stats.errorDetails.push({ type: 'delete-yield', id: yld.id, message: err.message });
      }
    }

    // ---- Pull server data ----
    try {
      const res = await client.listSavedCalcsRaw(headers);
      if (res.ok) {
        const serverCalcs = await res.json();
        if (Array.isArray(serverCalcs)) {
          await repo.mergeServerCalcs(serverCalcs);
          stats.pulled += serverCalcs.length;
        }
      }
    } catch {
      // Pull errors are non-critical — local data is intact
    }

    try {
      const res = await client.listUserDataRaw(headers);
      if (res.ok) {
        const serverYields = await res.json();
        if (Array.isArray(serverYields)) {
          await repo.mergeServerYields(serverYields);
          stats.pulled += serverYields.length;
        }
      }
    } catch {
      // Pull errors are non-critical — local data is intact
    }

    return stats;
  }

  return { sync, pendingCount };
}
