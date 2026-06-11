import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncAll } from './syncEngine';
import { getAuthHeaders, hasAuthCredential } from './authHeaders';
import {
  getAllPendingSync,
  markCalcSynced,
  markYieldSynced,
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

const passwordUser = { username: 'processor', authProvider: 'password' };

describe('syncAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasAuthCredential.mockReturnValue(true);
    getAuthHeaders.mockResolvedValue({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-token',
    });
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (options.method === 'POST') {
        return Response.json({ id: 'server-id' }, { status: 201 });
      }
      return Response.json([], { status: 200 });
    }));
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

    const saveRequest = fetch.mock.calls.find(([url]) => url === '/api/save-calc');
    expect(saveRequest).toBeDefined();
    const requestBody = JSON.parse(saveRequest[1].body);
    expect(requestBody).toMatchObject({
      species: 'Pacific Cod',
      product: 'Round → Skinless Fillets',
      yield: 42,
    });
    expect(requestBody).not.toHaveProperty('yield_value');
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

    const saveRequest = fetch.mock.calls.find(([url]) => url === '/api/save-calc');
    expect(saveRequest).toBeDefined();
    const requestBody = JSON.parse(saveRequest[1].body);
    expect(requestBody).not.toHaveProperty('mode');
    expect(requestBody).not.toHaveProperty('target_weight');
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

    const userDataRequest = fetch.mock.calls.find(([url]) => url === '/api/user-data');
    expect(userDataRequest).toBeDefined();
    const requestBody = JSON.parse(userDataRequest[1].body);
    expect(requestBody).toMatchObject({
      species: 'Pacific Halibut',
      product: 'Round → Skinless Fillet',
      yield: 48,
      source: 'User Input',
    });
    expect(requestBody).not.toHaveProperty('yield_percentage');
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
    getAuthHeaders.mockResolvedValue({
      'Content-Type': 'application/json',
      'x-stack-access-token': 'stack-token',
    });
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

    const saveRequest = fetch.mock.calls.find(([url]) => url === '/api/save-calc');
    expect(getAuthHeaders).toHaveBeenCalledWith(oauthUser, { 'Content-Type': 'application/json' });
    expect(saveRequest[1].headers).toMatchObject({
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
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (options.method === 'POST') {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return Response.json([], { status: 200 });
    }));

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
    expect(fetch).not.toHaveBeenCalled();
    expect(markCalcSynced).not.toHaveBeenCalled();
    expect(markYieldSynced).not.toHaveBeenCalled();
  });

  it('passes pulled custom yields with the server yield field intact', async () => {
    getAllPendingSync.mockResolvedValue({ calcs: [], yields: [] });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/user-data') {
        return Response.json([
          {
            id: 12,
            species: 'Pacific Halibut',
            product: 'Round → Skinless Fillet',
            yield: 48,
            source: 'User Input',
          },
        ]);
      }
      return Response.json([]);
    }));

    await syncAll(passwordUser);

    expect(mergeSyncedYields).toHaveBeenCalledWith([
      {
        id: 12,
        species: 'Pacific Halibut',
        product: 'Round → Skinless Fillet',
        yield: 48,
        source: 'User Input',
      },
    ]);
  });
});
