import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncCoordinator } from './syncCoordinator';
import { createRepository, accountScope } from './localRepository';

// ---- Helpers ----

function makeStore() {
  const db = {};
  return {
    get: vi.fn(async (key) => structuredClone(db[key]) ?? undefined),
    set: vi.fn(async (key, val) => { db[key] = structuredClone(val); }),
  };
}

function makeRepo(scope) {
  return createRepository(scope, { store: makeStore() });
}

function fakeRes({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, json: async () => body };
}

function makeClient(overrides = {}) {
  return {
    saveCalcRaw: vi.fn(async () => fakeRes({ body: { id: 'server-1' } })),
    deleteCalcRaw: vi.fn(async () => fakeRes()),
    createUserDataRaw: vi.fn(async () => fakeRes({ body: { id: 'sy-1', revision: 1 } })),
    updateUserDataRaw: vi.fn(async () => fakeRes({ body: { id: 'sy-1', revision: 2 } })),
    deleteUserDataRaw: vi.fn(async () => fakeRes()),
    listSavedCalcsRaw: vi.fn(async () => fakeRes({ body: [] })),
    listUserDataRaw: vi.fn(async () => fakeRes({ body: [] })),
    ...overrides,
  };
}

const AUTH_USER = { token: 'tok', uid: 'u1' };

vi.mock('./authHeaders', () => ({
  hasAuthCredential: vi.fn((u) => !!u?.token),
  getAuthHeaders: vi.fn(async (_u, extra = {}) => ({ Authorization: 'Bearer tok', ...extra })),
}));

// ---- Tests ----

describe('createSyncCoordinator', () => {
  let repo;
  let client;

  beforeEach(() => {
    repo = makeRepo(accountScope('u1'));
    client = makeClient();
  });

  // ---- Single-flight coalescing ----

  describe('single-flight coalescing', () => {
    it('returns the same in-flight promise for concurrent triggers', async () => {
      // Block the sync at getPendingSync so the first call is in-flight when the second starts.
      let releasePending;
      const gate = new Promise((r) => { releasePending = r; });
      vi.spyOn(repo, 'getPendingSync').mockImplementationOnce(() =>
        gate.then(() => ({ calcs: [], yields: [] }))
      );

      const coordinator = createSyncCoordinator(repo, client);
      const p1 = coordinator.sync(AUTH_USER);
      const p2 = coordinator.sync(AUTH_USER);
      expect(p1).toBe(p2);
      releasePending();
      await p1;
    });

    it('allows a new sync after the in-flight one completes', async () => {
      const coordinator = createSyncCoordinator(repo, client);
      await coordinator.sync(AUTH_USER);
      const p3 = coordinator.sync(AUTH_USER);
      const p4 = coordinator.sync(AUTH_USER);
      expect(p3).toBe(p4);
      await p3;
      expect(client.listSavedCalcsRaw).toHaveBeenCalledTimes(2);
    });
  });

  // ---- Authentication guard ----

  describe('auth guard', () => {
    it('returns zero stats when user has no credential', async () => {
      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync({ token: null });
      expect(stats.errors).toBe(0);
      expect(stats.pushed).toBe(0);
      expect(client.saveCalcRaw).not.toHaveBeenCalled();
    });

    it('stops processing and returns on 401', async () => {
      await repo.addYield({ species: 'Salmon', product: 'Fillet', yield: 50 });
      await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 60 });

      client.createUserDataRaw = vi.fn()
        .mockResolvedValueOnce(fakeRes({ ok: false, status: 401, body: { error: 'Unauthorized' } }))
        .mockResolvedValueOnce(fakeRes({ body: { id: 'sy-2', revision: 1 } }));

      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync(AUTH_USER);

      expect(stats.errors).toBe(1);
      expect(stats.errorDetails[0].isAuthError).toBe(true);
      // Second yield must NOT be attempted after 401 early return.
      expect(client.createUserDataRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Push calcs ----

  describe('push calcs', () => {
    it('pushes a local calc and marks it synced', async () => {
      const calc = await repo.addCalc({ species: 'Halibut', product: 'Steak', cost: 10, yield: 70, result: 14.3 });

      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync(AUTH_USER);

      expect(stats.pushed).toBeGreaterThan(0);
      const calcs = await repo.getCalcs();
      expect(calcs.find((c) => c.id === calc.id)?.syncStatus).toBe('synced');
    });

    it('handles deleted calc tombstones (with serverId)', async () => {
      const calc = await repo.addCalc({ species: 'Tuna', product: 'Loin', cost: 20, yield: 65, result: 30 });
      await repo.markCalcSynced(calc.id, 'srv-calc-1');
      await repo.removeCalc(calc.id);

      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync(AUTH_USER);

      expect(client.deleteCalcRaw).toHaveBeenCalledWith('srv-calc-1', expect.any(Object));
      expect(stats.pushed).toBeGreaterThan(0);
    });
  });

  // ---- Push yields ----

  describe('push yields', () => {
    it('pushes a new yield using POST + reconciling PUT', async () => {
      await repo.addYield({ species: 'Salmon', product: 'Fillet', yield: 48, source: 'Lab' });

      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync(AUTH_USER);

      expect(client.createUserDataRaw).toHaveBeenCalledOnce();
      expect(client.updateUserDataRaw).toHaveBeenCalledOnce(); // reconciling PUT
      expect(stats.pushed).toBeGreaterThan(0);
    });

    it('uses PUT for an edited synced yield', async () => {
      const yld = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 55 });
      await repo.markYieldSynced(yld.id, 'srv-yld-1', 1);
      await repo.updateYield(yld.id, { yield: 58 });

      const coordinator = createSyncCoordinator(repo, client);
      await coordinator.sync(AUTH_USER);

      expect(client.updateUserDataRaw).toHaveBeenCalledWith(
        'srv-yld-1',
        expect.objectContaining({ expected_revision: 1 }),
        expect.any(Object),
      );
    });

    it('tracks a 409 conflict: increments conflicts (not errors), moves record to conflicted state', async () => {
      const yld = await repo.addYield({ species: 'Sole', product: 'Fillet', yield: 42 });
      await repo.markYieldSynced(yld.id, 'srv-yld-2', 1);
      await repo.updateYield(yld.id, { yield: 45 });

      client.updateUserDataRaw = vi.fn(async () => fakeRes({ ok: false, status: 409 }));

      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync(AUTH_USER);

      expect(stats.conflicts).toBe(1);
      expect(stats.errors).toBe(0);
      // Record transitions to 'conflicted' — no longer in the sync queue.
      const pending = await coordinator.pendingCount();
      expect(pending).toBe(0);
      const conflicted = await repo.getConflictedYields();
      expect(conflicted).toHaveLength(1);
      expect(conflicted[0].syncStatus).toBe('conflicted');
      expect(conflicted[0].conflictLocal.yield).toBe(45);
    });
  });

  // ---- Stale delete conflict ----

  describe('push yield deletes — stale delete conflicts', () => {
    it('holds a 409 on DELETE as conflict-delete, removes from sync queue', async () => {
      const yld = await repo.addYield({ species: 'Sole', product: 'Fillet', yield: 38 });
      await repo.markYieldSynced(yld.id, 'srv-del-1', 1);
      await repo.removeYield(yld.id);

      client.deleteUserDataRaw = vi.fn(async () => fakeRes({ ok: false, status: 409 }));

      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync(AUTH_USER);

      expect(stats.conflicts).toBe(1);
      expect(stats.errors).toBe(0);
      const pending = await coordinator.pendingCount();
      expect(pending).toBe(0);
      const conflicted = await repo.getConflictedYields();
      expect(conflicted).toHaveLength(1);
      expect(conflicted[0].syncStatus).toBe('conflict-delete');
    });
  });

  // ---- Conflict + pull: server state populated ----

  describe('409 conflict then pull: conflictServer is populated', () => {
    it('pull phase sets conflictServer on a conflicted record', async () => {
      const yld = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });
      await repo.markYieldSynced(yld.id, 'srv-conflict-pull', 1);
      await repo.updateYield(yld.id, { yield: 45 });

      client.updateUserDataRaw = vi.fn(async () => fakeRes({ ok: false, status: 409 }));
      client.listUserDataRaw = vi.fn(async () =>
        fakeRes({ body: [{ id: 'srv-conflict-pull', revision: 2, species: 'Cod', product: 'Fillet', yield: 50, source: 'Server', is_shared: false }] })
      );

      const coordinator = createSyncCoordinator(repo, client);
      await coordinator.sync(AUTH_USER);

      const conflicted = await repo.getConflictedYields();
      expect(conflicted).toHaveLength(1);
      expect(conflicted[0].conflictServer).toMatchObject({ serverRevision: 2, yield: 50 });
    });
  });

  // ---- Pull ----

  describe('pull', () => {
    it('merges server calcs and yields on pull', async () => {
      client.listSavedCalcsRaw = vi.fn(async () =>
        fakeRes({ body: [{ id: 101, species: 'Halibut', product: 'Steak', cost: 10, yield: 70, result: 14 }] })
      );
      client.listUserDataRaw = vi.fn(async () =>
        fakeRes({ body: [{ id: 201, species: 'Salmon', product: 'Fillet', yield: 48, revision: 1, is_shared: true }] })
      );

      const coordinator = createSyncCoordinator(repo, client);
      await coordinator.sync(AUTH_USER);

      const calcs = await repo.getCalcs();
      const yields = await repo.getYields();
      expect(calcs).toHaveLength(1);
      expect(yields).toHaveLength(1);
      expect(yields[0].is_shared).toBe(true);
    });

    it('continues even if pull fails', async () => {
      client.listSavedCalcsRaw = vi.fn(async () => { throw new Error('network error'); });
      client.listUserDataRaw = vi.fn(async () => { throw new Error('network error'); });

      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync(AUTH_USER);

      // Pull errors are non-critical — no push errors, no push work.
      expect(stats.errors).toBe(0);
    });
  });

  // ---- Offline-to-online recovery ----

  describe('offline-to-online recovery', () => {
    it('retains pending work when sync fails with network error', async () => {
      await repo.addYield({ species: 'Tuna', product: 'Loin', yield: 55 });
      client.createUserDataRaw = vi.fn(async () => { throw new Error('ECONNREFUSED'); });

      const coordinator = createSyncCoordinator(repo, client);
      const stats = await coordinator.sync(AUTH_USER);

      expect(stats.errors).toBe(1);
      // Local record must still be pending — not discarded.
      const pending = await coordinator.pendingCount();
      expect(pending).toBeGreaterThan(0);
    });

    it('pushes retained work on a subsequent sync', async () => {
      await repo.addYield({ species: 'Halibut', product: 'Fillet', yield: 62 });

      let callCount = 0;
      client.createUserDataRaw = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('offline');
        return fakeRes({ body: { id: 'sy-3', revision: 1 } });
      });

      const coordinator = createSyncCoordinator(repo, client);
      await coordinator.sync(AUTH_USER); // fails
      expect(await coordinator.pendingCount()).toBeGreaterThan(0);

      await coordinator.sync(AUTH_USER); // succeeds on retry
      expect(await coordinator.pendingCount()).toBe(0);
    });
  });

  // ---- pendingCount ----

  describe('pendingCount', () => {
    it('returns 0 when nothing is pending', async () => {
      const coordinator = createSyncCoordinator(repo, client);
      expect(await coordinator.pendingCount()).toBe(0);
    });

    it('counts unsynced calcs and yields', async () => {
      await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 5, yield: 60, result: 8 });
      await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 60 });
      const coordinator = createSyncCoordinator(repo, client);
      expect(await coordinator.pendingCount()).toBe(2);
    });
  });
});
