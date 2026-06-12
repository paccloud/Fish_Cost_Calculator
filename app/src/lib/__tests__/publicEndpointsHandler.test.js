import { describe, expect, it, vi } from 'vitest';
import {
  handleGetContributorProfile,
  handleGetFishData,
  handleListContributors,
  handleListPublicCalcs,
  handleSaveContributorProfile,
} from '../../../../shared/handlers/publicEndpoints.js';

function makeFakeDb(overrides = {}) {
  return {
    listPublicCalcs: vi.fn().mockResolvedValue([]),
    getFishData: vi.fn().mockResolvedValue({ fishData: {}, profiles: {}, source: {} }),
    listContributors: vi.fn().mockResolvedValue([]),
    getContributorProfile: vi.fn().mockResolvedValue(null),
    saveContributorProfile: vi.fn().mockResolvedValue({ id: 1, created: true }),
    ...overrides,
  };
}

describe('public endpoint handlers — unauthenticated reads', () => {
  it('lists public calculations without a user id', async () => {
    const db = makeFakeDb({
      listPublicCalcs: vi.fn().mockResolvedValue([{ id: 1, species: 'Pink Salmon' }]),
    });

    const result = await handleListPublicCalcs({}, db);

    expect(result.status).toBe(200);
    expect(result.body).toEqual([{ id: 1, species: 'Pink Salmon' }]);
    expect(db.listPublicCalcs).toHaveBeenCalledTimes(1);
  });

  it('returns fish data without a user id', async () => {
    const db = makeFakeDb({
      getFishData: vi.fn().mockResolvedValue({
        fishData: { 'Pink Salmon': { conversions: {} } },
        profiles: {},
        source: { title: 'Recoveries and Yields from Pacific Fish and Shellfish' },
      }),
    });

    const result = await handleGetFishData({}, db);

    expect(result.status).toBe(200);
    expect(result.body.fishData['Pink Salmon']).toBeDefined();
    expect(db.getFishData).toHaveBeenCalledTimes(1);
  });

  it('lists public contributors without a user id', async () => {
    const db = makeFakeDb({
      listContributors: vi.fn().mockResolvedValue([{ id: 3, display_name: 'Deckhand', contribution_count: 4 }]),
    });

    const result = await handleListContributors({}, db);

    expect(result.status).toBe(200);
    expect(result.body[0].contribution_count).toBe(4);
    expect(db.listContributors).toHaveBeenCalledTimes(1);
  });
});

describe('contributor profile handlers — auth requirement', () => {
  it('requires auth before reading the current contributor profile', async () => {
    const db = makeFakeDb();

    const result = await handleGetContributorProfile({}, db);

    expect(result.status).toBe(401);
    expect(db.getContributorProfile).not.toHaveBeenCalled();
  });

  it('requires auth before saving the current contributor profile', async () => {
    const db = makeFakeDb();

    const result = await handleSaveContributorProfile({ display_name: 'Deckhand' }, db);

    expect(result.status).toBe(401);
    expect(db.saveContributorProfile).not.toHaveBeenCalled();
  });
});
