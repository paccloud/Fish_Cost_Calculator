import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, set } from 'idb-keyval';
import { mergeSyncedYields, mergeSyncedCalcs } from './localStore';

vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => []),
  set: vi.fn(async () => undefined),
}));

describe('mergeSyncedYields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores pulled custom yields using the server yield field', async () => {
    await mergeSyncedYields([
      {
        id: 12,
        species: 'Pacific Halibut',
        product: 'Round → Skinless Fillet',
        yield: 48,
        source: 'User Input',
      },
    ]);

    expect(set).toHaveBeenCalledWith(
      'fish-calc-custom-yields',
      expect.arrayContaining([
        expect.objectContaining({
          species: 'Pacific Halibut',
          product: 'Round → Skinless Fillet',
          yield: 48,
          source: 'User Input',
          serverId: 12,
          syncStatus: 'synced',
        }),
      ])
    );
  });

  it('does not resurrect a yield that is pending-delete (tombstoned locally)', async () => {
    // Local store has a pending-delete tombstone for server id 12
    get.mockResolvedValue([
      {
        id: 'local-uuid',
        serverId: 12,
        syncStatus: 'pending-delete',
        species: 'Pacific Halibut',
        product: 'Round → Skinless Fillet',
        yield: 48,
      },
    ]);

    // Server returns the same item (delete not yet confirmed server-side)
    await mergeSyncedYields([
      { id: 12, species: 'Pacific Halibut', product: 'Round → Skinless Fillet', yield: 48 },
    ]);

    // The tombstoned item must NOT gain a duplicate in the store
    const saved = set.mock.calls[0][1];
    const copies = saved.filter((i) => String(i.serverId) === '12');
    expect(copies).toHaveLength(1);
    expect(copies[0].syncStatus).toBe('pending-delete');
  });
});

describe('mergeSyncedCalcs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a new server calc that is not in the local store', async () => {
    get.mockResolvedValue([]);

    await mergeSyncedCalcs([
      {
        id: 7,
        name: 'Cod Fillet',
        species: 'Pacific Cod',
        product: 'Round → Skinless Fillets',
        cost: 4.5,
        yield: 42,
        result: 10.71,
        created_at: '2026-06-01T00:00:00Z',
      },
    ]);

    expect(set).toHaveBeenCalledWith(
      'fish-calc-saved-calcs',
      expect.arrayContaining([
        expect.objectContaining({
          serverId: 7,
          syncStatus: 'synced',
          species: 'Pacific Cod',
        }),
      ])
    );
  });

  it('does not duplicate a calc already tracked by serverId (number vs string)', async () => {
    // serverId stored as number (common when restored from server JSON)
    get.mockResolvedValue([
      {
        id: 'local-uuid',
        serverId: 7,
        syncStatus: 'synced',
        species: 'Pacific Cod',
        product: 'Round → Skinless Fillets',
        yield: 42,
        result: 10.71,
      },
    ]);

    // Server returns same id (integer from JSON)
    await mergeSyncedCalcs([
      { id: 7, species: 'Pacific Cod', product: 'Round → Skinless Fillets', yield: 42, result: 10.71 },
    ]);

    const saved = set.mock.calls[0][1];
    const copies = saved.filter((i) => String(i.serverId) === '7');
    expect(copies).toHaveLength(1);
  });

  it('does not resurrect a calc that is pending-delete (tombstoned locally)', async () => {
    // Local store has a pending-delete tombstone for server id 42
    get.mockResolvedValue([
      {
        id: 'local-uuid',
        serverId: 42,
        syncStatus: 'pending-delete',
        species: 'Pink Salmon',
        product: 'Round → Skinless Fillet',
        yield: 38,
        result: 6.58,
      },
    ]);

    // Server still returns the item (delete push hasn't happened yet)
    await mergeSyncedCalcs([
      { id: 42, species: 'Pink Salmon', product: 'Round → Skinless Fillet', yield: 38, result: 6.58 },
    ]);

    // Store must still contain exactly one entry for server id 42, still tombstoned
    const saved = set.mock.calls[0][1];
    const copies = saved.filter((i) => String(i.serverId) === '42');
    expect(copies).toHaveLength(1);
    expect(copies[0].syncStatus).toBe('pending-delete');
  });

  it('second device pull: does not re-add a calc whose serverId has no local record', async () => {
    // Fresh device — local store is empty
    get.mockResolvedValue([]);

    await mergeSyncedCalcs([
      { id: 99, species: 'Chinook Salmon', product: 'Round → D/H-On', yield: 91, result: 2.2 },
    ]);

    const saved = set.mock.calls[0][1];
    expect(saved).toHaveLength(1);
    expect(saved[0].serverId).toBe(99);
    expect(saved[0].syncStatus).toBe('synced');
  });
});
