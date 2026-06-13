import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncAll } from './syncEngine';
import { getAuthHeaders, hasAuthCredential } from './authHeaders';
import {
  getAllPendingSync,
  markCalcSynced,
  markYieldSynced,
  removeCalcSyncedDelete,
  mergeSyncedCalcs,
  mergeSyncedYields,
} from './localStore';

vi.mock('./localStore', () => ({
  getAllPendingSync: vi.fn(),
  markCalcSynced: vi.fn(),
  markYieldSynced: vi.fn(),
  removeCalcSyncedDelete: vi.fn(),
  removeYieldSyncedDelete: vi.fn(),
  mergeSyncedCalcs: vi.fn(),
  mergeSyncedYields: vi.fn(),
}));

vi.mock('./authHeaders', () => ({
  getAuthHeaders: vi.fn(),
  hasAuthCredential: vi.fn(),
}));

// Mock apiClient so tests control HTTP responses without a live network.
// Each *Raw method returns a fake Response; the non-raw methods aren't used
// by syncEngine so they're left as no-ops.
vi.mock('./apiClient', () => {
  const saveCalcRaw = vi.fn();
  const deleteCalcRaw = vi.fn();
  const createUserDataRaw = vi.fn();
  const deleteUserDataRaw = vi.fn();
  const listSavedCalcsRaw = vi.fn();
  const listUserDataRaw = vi.fn();
  return {
    apiClient: {
      saveCalcRaw,
      deleteCalcRaw,
      createUserDataRaw,
      deleteUserDataRaw,
      listSavedCalcsRaw,
      listUserDataRaw,
    },
  };
});

import { apiClient } from './apiClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Response-like object (same helper style as apiClient.test.js). */
function fakeResponse({ ok, status, body }) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: () => null },
  };
}

const passwordUser = { username: 'processor', authProvider: 'password' };
const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer jwt-token',
};

describe('syncAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasAuthCredential.mockReturnValue(true);
    getAuthHeaders.mockResolvedValue(AUTH_HEADERS);

    // Default: push succeeds with id, pull returns empty arrays
    apiClient.saveCalcRaw.mockResolvedValue(fakeResponse({ ok: true, status: 201, body: { id: 'server-id' } }));
    apiClient.deleteCalcRaw.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: {} }));
    apiClient.createUserDataRaw.mockResolvedValue(fakeResponse({ ok: true, status: 201, body: { id: 'server-id' } }));
    apiClient.deleteUserDataRaw.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: {} }));
    apiClient.listSavedCalcsRaw.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: [] }));
    apiClient.listUserDataRaw.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: [] }));
  });

  it('sends saved calculations with the yield field the server accepts', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-calc-id',
          syncStatus: 'local',
          name: 'Cod Round to Fillet',
          species: 'Pacific Cod',
          product: 'Round → Skinless Fillets',
          mode: 'cost',
          cost: 4.5,
          target_weight: 0,
          yield: 42,
          result: 10.71,
        },
      ],
      yields: [],
    });

    await syncAll(passwordUser);

    expect(apiClient.saveCalcRaw).toHaveBeenCalledTimes(1);
    const [body] = apiClient.saveCalcRaw.mock.calls[0];
    expect(body).toMatchObject({
      species: 'Pacific Cod',
      product: 'Round → Skinless Fillets',
      yield: 42,
    });
    expect(body).not.toHaveProperty('yield_value');
    expect(markCalcSynced).toHaveBeenCalledWith('local-calc-id', 'server-id');
  });

  it('omits saved calculation fields that the remote schema does not store', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-weight-calc-id',
          syncStatus: 'local',
          name: 'Target halibut output',
          species: 'Pacific Halibut',
          product: 'Round → Skinless Fillet',
          mode: 'weight',
          cost: 0,
          target_weight: 100,
          yield: 48,
          result: 208.33,
        },
      ],
      yields: [],
    });

    await syncAll(passwordUser);

    expect(apiClient.saveCalcRaw).toHaveBeenCalledTimes(1);
    const [body] = apiClient.saveCalcRaw.mock.calls[0];
    expect(body).not.toHaveProperty('mode');
    expect(body).not.toHaveProperty('target_weight');
  });

  it('sends custom yields with the yield field the server accepts', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [],
      yields: [
        {
          id: 'local-yield-id',
          syncStatus: 'local',
          species: 'Pacific Halibut',
          product: 'Round → Skinless Fillet',
          yield: 48,
          source: 'User Input',
        },
      ],
    });

    await syncAll(passwordUser);

    expect(apiClient.createUserDataRaw).toHaveBeenCalledTimes(1);
    const [body] = apiClient.createUserDataRaw.mock.calls[0];
    expect(body).toMatchObject({
      species: 'Pacific Halibut',
      product: 'Round → Skinless Fillet',
      yield: 48,
      source: 'User Input',
    });
    expect(body).not.toHaveProperty('yield_percentage');
    expect(markYieldSynced).toHaveBeenCalledWith('local-yield-id', 'server-id');
  });

  it('marks pushed records as synced only after successful server responses', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-calc-id',
          syncStatus: 'local',
          species: 'Pacific Cod',
          product: 'Round → Skinless Fillets',
          yield: 42,
          result: 10.71,
        },
      ],
      yields: [
        {
          id: 'local-yield-id',
          syncStatus: 'local',
          species: 'Pacific Halibut',
          product: 'Round → Skinless Fillet',
          yield: 48,
        },
      ],
    });

    await syncAll(passwordUser);

    expect(markCalcSynced).toHaveBeenCalledWith('local-calc-id', 'server-id');
    expect(markYieldSynced).toHaveBeenCalledWith('local-yield-id', 'server-id');
  });

  it('uses shared auth headers so OAuth sessions can sync without a JWT', async () => {
    const oauthUser = { username: 'oauth-user', authProvider: 'oauth' };
    const oauthHeaders = {
      'Content-Type': 'application/json',
      'x-stack-access-token': 'stack-token',
    };
    getAuthHeaders.mockResolvedValue(oauthHeaders);
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-calc-id',
          syncStatus: 'local',
          species: 'Pacific Cod',
          product: 'Round → Skinless Fillets',
          yield: 42,
          result: 10.71,
        },
      ],
      yields: [],
    });

    await syncAll(oauthUser);

    expect(getAuthHeaders).toHaveBeenCalledWith(oauthUser, { 'Content-Type': 'application/json' });
    // extraHeaders passed to saveCalcRaw must include the OAuth token
    const [, extraHeaders] = apiClient.saveCalcRaw.mock.calls[0];
    expect(extraHeaders).toMatchObject({
      'Content-Type': 'application/json',
      'x-stack-access-token': 'stack-token',
    });
  });

  it('classifies auth failures without marking records as synced', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-calc-id',
          syncStatus: 'local',
          species: 'Pacific Cod',
          product: 'Round → Skinless Fillets',
          yield: 42,
          result: 10.71,
        },
      ],
      yields: [],
    });
    apiClient.saveCalcRaw.mockResolvedValue(
      fakeResponse({ ok: false, status: 401, body: { error: 'Unauthorized' } })
    );

    const stats = await syncAll(passwordUser);

    expect(stats.errors).toBe(1);
    expect(stats.errorDetails).toContainEqual({
      type: 'push-calc',
      id: 'local-calc-id',
      status: 401,
      isAuthError: true,
    });
    expect(markCalcSynced).not.toHaveBeenCalled();
    expect(markYieldSynced).not.toHaveBeenCalled();
  });

  it('reports an auth error when shared headers contain no usable credential', async () => {
    getAuthHeaders.mockResolvedValue({ 'Content-Type': 'application/json' });
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-calc-id',
          syncStatus: 'local',
          species: 'Pacific Cod',
          product: 'Round → Skinless Fillets',
          yield: 42,
          result: 10.71,
        },
      ],
      yields: [],
    });

    const stats = await syncAll(passwordUser);

    expect(stats).toMatchObject({
      errors: 1,
      errorDetails: [
        {
          type: 'auth',
          isAuthError: true,
          message: 'Missing authentication headers',
        },
      ],
    });
    expect(apiClient.saveCalcRaw).not.toHaveBeenCalled();
    expect(markCalcSynced).not.toHaveBeenCalled();
    expect(markYieldSynced).not.toHaveBeenCalled();
  });

  it('passes pulled custom yields with the server yield field intact', async () => {
    getAllPendingSync.mockResolvedValue({ calcs: [], yields: [] });
    const yieldRow = {
      id: 12,
      species: 'Pacific Halibut',
      product: 'Round → Skinless Fillet',
      yield: 48,
      source: 'User Input',
    };
    apiClient.listUserDataRaw.mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: [yieldRow] })
    );

    await syncAll(passwordUser);

    expect(mergeSyncedYields).toHaveBeenCalledWith([yieldRow]);
  });

  // --- Delete round-trip: issue #24 ---

  it('successful delete clears the tombstone from local store', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-calc-id',
          serverId: 42,
          syncStatus: 'pending-delete',
        },
      ],
      yields: [],
    });
    apiClient.deleteCalcRaw.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: {} }));

    await syncAll(passwordUser);

    expect(apiClient.deleteCalcRaw).toHaveBeenCalledWith(42, AUTH_HEADERS);
    expect(removeCalcSyncedDelete).toHaveBeenCalledWith('local-calc-id');
  });

  it('404 on delete is treated as already-deleted and clears the tombstone', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-calc-id',
          serverId: 99,
          syncStatus: 'pending-delete',
        },
      ],
      yields: [],
    });
    apiClient.deleteCalcRaw.mockResolvedValue(fakeResponse({ ok: false, status: 404, body: { error: 'Not found' } }));

    const stats = await syncAll(passwordUser);

    // 404 = already gone from server, tombstone must be cleared, not counted as error
    expect(removeCalcSyncedDelete).toHaveBeenCalledWith('local-calc-id');
    expect(stats.errors).toBe(0);
  });

  it('failed delete (5xx) leaves the tombstone intact for retry', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-calc-id',
          serverId: 55,
          syncStatus: 'pending-delete',
        },
      ],
      yields: [],
    });
    apiClient.deleteCalcRaw.mockResolvedValue(fakeResponse({ ok: false, status: 500, body: { error: 'Server error' } }));

    const stats = await syncAll(passwordUser);

    expect(removeCalcSyncedDelete).not.toHaveBeenCalled();
    expect(stats.errors).toBe(1);
    expect(stats.errorDetails[0]).toMatchObject({ type: 'delete-calc', id: 'local-calc-id', status: 500 });
  });

  it('calc with no serverId (never synced) is immediately removed without an HTTP call', async () => {
    getAllPendingSync.mockResolvedValue({
      calcs: [
        {
          id: 'local-only-id',
          serverId: undefined,
          syncStatus: 'pending-delete',
        },
      ],
      yields: [],
    });

    const stats = await syncAll(passwordUser);

    expect(apiClient.deleteCalcRaw).not.toHaveBeenCalled();
    expect(removeCalcSyncedDelete).toHaveBeenCalledWith('local-only-id');
    expect(stats.pushed).toBe(1);
    expect(stats.errors).toBe(0);
  });

  it('pull does not resurrect calcs that were just deleted (mergeSyncedCalcs called with server list)', async () => {
    getAllPendingSync.mockResolvedValue({ calcs: [], yields: [] });
    const serverCalcs = [
      { id: 7, species: 'Pacific Cod', product: 'Round → Skinless Fillets', yield: 42, result: 10.71 },
    ];
    apiClient.listSavedCalcsRaw.mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: serverCalcs })
    );

    await syncAll(passwordUser);

    // syncEngine must pass the raw server list to mergeSyncedCalcs which
    // is responsible for skipping tombstoned items
    expect(mergeSyncedCalcs).toHaveBeenCalledWith(serverCalcs);
  });
});
