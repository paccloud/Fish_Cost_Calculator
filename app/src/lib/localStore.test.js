import { beforeEach, describe, expect, it, vi } from 'vitest';
import { set } from 'idb-keyval';
import { mergeSyncedYields } from './localStore';

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
});
