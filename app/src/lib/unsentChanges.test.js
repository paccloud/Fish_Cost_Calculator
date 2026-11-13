import { describe, expect, it } from 'vitest';
import { buildUnsentChangesFile, countUnsentChanges, countUnsentParts, UNSENT_CHANGES_FORMAT } from './unsentChanges';
import { parseMoveStage } from '../config/move';

describe('parseMoveStage', () => {
  it('defaults to off and accepts only known stages', () => {
    expect(parseMoveStage(undefined)).toBe('off');
    expect(parseMoveStage('')).toBe('off');
    expect(parseMoveStage('bogus')).toBe('off');
    expect(parseMoveStage(' Notice ')).toBe('notice');
    expect(parseMoveStage('read-only')).toBe('read-only');
  });
});

describe('buildUnsentChangesFile', () => {
  const exportedAt = '2026-10-01T12:00:00.000Z';

  it('keeps only records that never reached the server, without sync bookkeeping', () => {
    const file = buildUnsentChangesFile({
      exportedAt,
      accountYields: [
        { id: 'y1', species: 'Cod', product: 'Fillet', yield: 42, source: 'Me', syncStatus: 'local', scope: 'account:a', revision: 2, createdAt: 'c', updatedAt: 'u' },
        { id: 'y3', serverId: 11, species: 'Cod', product: 'Head-off', yield: 70, syncStatus: 'local', scope: 'account:a' },
        { id: 'y2', species: 'Cod', product: 'Loin', yield: 30, serverId: 9, syncStatus: 'pending-delete', scope: 'account:a' },
      ],
      accountConflicts: [
        { id: 'y4', serverId: 12, species: 'Rockfish', product: 'Fillet', yield: 35, syncStatus: 'conflicted' },
        { id: 'y5', serverId: 13, species: 'Rockfish', product: 'Round', yield: 100, syncStatus: 'conflict-delete' },
      ],
      accountCalcs: [
        { id: 'c1', species: 'Halibut', cost: 7, yield: 55, syncStatus: 'local', scope: 'account:a', is_private: true },
        { id: 'c2', species: 'Halibut', product: 'Fillet', syncStatus: 'pending-unpublish', serverId: 4 },
        { id: 'c3', species: 'Salmon', product: 'Fillet', syncStatus: 'synced', serverId: 5 },
      ],
      guestYields: [{ id: 'g1', species: 'Tuna', product: 'Steak', yield: 60, syncStatus: 'local', scope: 'guest:x' }],
      guestCalcs: [{ id: 'g2', species: 'Tuna', cost: 9, syncStatus: 'local', scope: 'guest:x' }],
    });

    expect(file.format).toBe(UNSENT_CHANGES_FORMAT);
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe(exportedAt);
    expect(file.customYields).toEqual([
      { id: 'y1', serverId: null, species: 'Cod', product: 'Fillet', yield: 42, source: 'Me', createdAt: 'c', updatedAt: 'u' },
      { id: 'y3', serverId: 11, species: 'Cod', product: 'Head-off', yield: 70, source: null, createdAt: undefined, updatedAt: undefined },
      { id: 'y4', serverId: 12, species: 'Rockfish', product: 'Fillet', yield: 35, source: null, createdAt: undefined, updatedAt: undefined },
      { id: 'g1', serverId: null, species: 'Tuna', product: 'Steak', yield: 60, source: null, createdAt: undefined, updatedAt: undefined },
    ]);
    expect(file.savedCalculations).toEqual([
      { id: 'c1', serverId: null, species: 'Halibut', cost: 7, yield: 55 },
      { id: 'g2', serverId: null, species: 'Tuna', cost: 9 },
    ]);
    expect(file.pendingDeletes).toEqual({
      customYields: [
        { id: 'y2', serverId: 9, species: 'Cod', product: 'Loin' },
        { id: 'y5', serverId: 13, species: 'Rockfish', product: 'Round' },
      ],
      savedCalculations: [],
    });
    expect(file.pendingPublication).toEqual([
      { id: 'c2', serverId: 4, species: 'Halibut', product: 'Fillet', intent: 'unpublish' },
    ]);
    expect(countUnsentChanges(file)).toBe(9);
  });

  it('is empty when nothing is waiting', () => {
    const file = buildUnsentChangesFile({ exportedAt });
    expect(countUnsentChanges(file)).toBe(0);
  });
});

describe('device-only records (a signed-in person\'s "Pounds to buy" answers)', () => {
  const weight = { id: 'w1', species: 'Sockeye Salmon', product: 'Round → Skinless Fillet', mode: 'weight', cost: 0, target_weight: 100, yield: 46, result: 217.39, syncStatus: 'local', scope: 'account:a' };
  const price = { id: 'c1', species: 'Cod', product: 'Round → Fillet', mode: 'cost', cost: 4, yield: 42, result: 9.52, syncStatus: 'local', scope: 'account:a' };

  it('are in the file, with the mode that says the result is a weight', () => {
    const file = buildUnsentChangesFile({ accountCalcs: [price], deviceOnlyCalcs: [weight] });
    expect(file.savedCalculations.map((c) => c.id)).toEqual(['c1', 'w1']);
    expect(file.savedCalculations[1]).toMatchObject({ mode: 'weight', target_weight: 100, result: 217.39, serverId: null });
    expect(file.savedCalculations[1]).not.toHaveProperty('syncStatus');
  });

  it('count toward what the file holds, not toward what is still on its way to the server', () => {
    expect(countUnsentParts({ accountCalcs: [price], deviceOnlyCalcs: [weight] })).toEqual({ account: 1, total: 2 });
    expect(countUnsentParts({ deviceOnlyCalcs: [weight] })).toEqual({ account: 0, total: 1 });
    expect(countUnsentParts({ guestCalcs: [weight], guestYields: [] })).toEqual({ account: 0, total: 1 });
    expect(countUnsentParts()).toEqual({ account: 0, total: 0 });
  });
});
