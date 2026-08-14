import { describe, expect, it, vi } from 'vitest';
import {
  migrateLegacyRecords,
  getRecoveryCounts,
  assignRecoveryToAccount,
  discardRecovery,
  recoveryScope,
} from './legacyMigration';
import { createRepository, accountScope } from './localRepository';

// ---- Helpers ----

function makeStore(initial = {}) {
  const db = structuredClone(initial);
  return {
    get: vi.fn(async (key) => structuredClone(db[key]) ?? undefined),
    set: vi.fn(async (key, val) => { db[key] = structuredClone(val); }),
    _db: db,
  };
}

function makeRecoveryRepo(store) {
  const ls = { getItem: () => 'test-install-id', setItem: () => {} };
  return createRepository(recoveryScope(ls), { store });
}

function makeAccountRepo(store) {
  return createRepository(accountScope('user-abc'), { store });
}

const LEGACY_CALCS_KEY = 'fish-calc-saved-calcs';
const LEGACY_YIELDS_KEY = 'fish-calc-custom-yields';
const MARKER_KEY = 'fish-calc:legacy-migration:v1';

const syncedCalc = { id: 'c1', syncStatus: 'synced', species: 'Cod', product: 'Fillet', cost: 5, yield: 40, result: 12.5 };
const localCalc  = { id: 'c2', syncStatus: 'local',  species: 'Salmon', product: 'Steak', cost: 8, yield: 50, result: 16 };
const tombCalc   = { id: 'c3', syncStatus: 'pending-delete', serverId: 999, species: 'Halibut', product: 'Whole', cost: 3, yield: 30, result: 10 };
const syncedYield = { id: 'y1', syncStatus: 'synced', species: 'Cod', product: 'Fillet', yield: 40 };
const localYield  = { id: 'y2', syncStatus: 'local',  species: 'Salmon', product: 'Steak', yield: 55 };

// ---- recoveryScope ----

describe('recoveryScope', () => {
  it('returns recovery:{installationId}', () => {
    const ls = { getItem: () => 'abc-id', setItem: () => {} };
    expect(recoveryScope(ls)).toBe('recovery:abc-id');
  });
});

// ---- migrateLegacyRecords ----

describe('migrateLegacyRecords — clean-cache discard', () => {
  it('discards synced records and does not quarantine them', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [syncedCalc], [LEGACY_YIELDS_KEY]: [syncedYield] });
    const recoveryRepo = makeRecoveryRepo(store);
    const { calcs, yields } = await migrateLegacyRecords({ store, recoveryRepo });
    expect(calcs).toBe(0);
    expect(yields).toBe(0);
    expect(await recoveryRepo.getCalcs()).toHaveLength(0);
    expect(await recoveryRepo.getYields()).toHaveLength(0);
  });
});

describe('migrateLegacyRecords — quarantine unsynchronized records', () => {
  it('copies local calcs into the recovery scope', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc] });
    const recoveryRepo = makeRecoveryRepo(store);
    const { calcs } = await migrateLegacyRecords({ store, recoveryRepo });
    expect(calcs).toBe(1);
    const recovered = await recoveryRepo.getCalcs();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].species).toBe('Salmon');
    expect(recovered[0].legacyId).toBe('c2');
  });

  it('discards pending-delete tombstones (re-inserting them as local would un-delete)', async () => {
    // makeRecord always sets syncStatus:'local', so a pending-delete tombstone would
    // be stored as a new local record and then synced as an INSERT, silently un-deleting
    // data the user explicitly removed. Skip them during migration instead.
    const store = makeStore({ [LEGACY_CALCS_KEY]: [tombCalc] });
    const recoveryRepo = makeRecoveryRepo(store);
    const { calcs } = await migrateLegacyRecords({ store, recoveryRepo });
    expect(calcs).toBe(0);
    expect(await recoveryRepo.getCalcs()).toHaveLength(0);
  });

  it('copies local yields into the recovery scope', async () => {
    const store = makeStore({ [LEGACY_YIELDS_KEY]: [localYield] });
    const recoveryRepo = makeRecoveryRepo(store);
    const { yields } = await migrateLegacyRecords({ store, recoveryRepo });
    expect(yields).toBe(1);
    const recovered = await recoveryRepo.getYields();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].species).toBe('Salmon');
    expect(recovered[0].legacyId).toBe('y2');
  });

  it('mixes: discards synced, quarantines local', async () => {
    const store = makeStore({
      [LEGACY_CALCS_KEY]: [syncedCalc, localCalc],
      [LEGACY_YIELDS_KEY]: [syncedYield, localYield],
    });
    const recoveryRepo = makeRecoveryRepo(store);
    const { calcs, yields } = await migrateLegacyRecords({ store, recoveryRepo });
    expect(calcs).toBe(1);
    expect(yields).toBe(1);
  });

  it('preserves original payload without mutation', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc] });
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });
    const recovered = await recoveryRepo.getCalcs();
    expect(recovered[0].cost).toBe(localCalc.cost);
    expect(recovered[0].result).toBe(localCalc.result);
  });
});

describe('migrateLegacyRecords — migration marker', () => {
  it('sets the migration marker after completing', async () => {
    const store = makeStore({});
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });
    expect(await store.get(MARKER_KEY)).toBe('done');
  });

  it('returns alreadyDone:true when marker is set', async () => {
    const store = makeStore({ [MARKER_KEY]: 'done' });
    const recoveryRepo = makeRecoveryRepo(store);
    const result = await migrateLegacyRecords({ store, recoveryRepo });
    expect(result.alreadyDone).toBe(true);
    expect(result.calcs).toBe(0);
    expect(result.yields).toBe(0);
  });

  it('does not read legacy stores when marker is already set', async () => {
    const store = makeStore({ [MARKER_KEY]: 'done', [LEGACY_CALCS_KEY]: [localCalc] });
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });
    // Recovery repo must be empty — migration was skipped.
    expect(await recoveryRepo.getCalcs()).toHaveLength(0);
  });
});

describe('migrateLegacyRecords — idempotency on restart', () => {
  it('does not duplicate records if run a second time before marker is written', async () => {
    // Simulate a partial prior run: recovery repo already has one record, no marker.
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc] });
    const recoveryRepo = makeRecoveryRepo(store);

    // First run (marker not written yet — simulate failure by running again without setting marker).
    // Pre-populate the recovery repo as if a partial run had already copied the record.
    await recoveryRepo.addCalc({ ...localCalc, legacyId: localCalc.id, scope: undefined });

    // Second run — should not duplicate.
    await migrateLegacyRecords({ store, recoveryRepo });
    const recovered = await recoveryRepo.getCalcs();
    expect(recovered).toHaveLength(1);
  });
});

describe('migrateLegacyRecords — handles empty legacy stores', () => {
  it('returns zero counts when legacy stores are absent', async () => {
    const store = makeStore({});
    const recoveryRepo = makeRecoveryRepo(store);
    const result = await migrateLegacyRecords({ store, recoveryRepo });
    expect(result.alreadyDone).toBe(false);
    expect(result.calcs).toBe(0);
    expect(result.yields).toBe(0);
  });
});

// ---- getRecoveryCounts ----

describe('getRecoveryCounts', () => {
  it('returns correct counts for recovery records', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc], [LEGACY_YIELDS_KEY]: [localYield] });
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });
    const counts = await getRecoveryCounts({ recoveryRepo });
    expect(counts.calcs).toBe(1);
    expect(counts.yields).toBe(1);
    expect(counts.total).toBe(2);
  });

  it('returns zero when recovery scope is empty', async () => {
    const store = makeStore({});
    const recoveryRepo = makeRecoveryRepo(store);
    const counts = await getRecoveryCounts({ recoveryRepo });
    expect(counts.total).toBe(0);
  });
});

// ---- assignRecoveryToAccount ----

describe('assignRecoveryToAccount', () => {
  it('copies recovery calcs and yields into the account repo', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc], [LEGACY_YIELDS_KEY]: [localYield] });
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });

    const accountRepo = makeAccountRepo(store);
    await assignRecoveryToAccount(accountRepo, { recoveryRepo });

    const acctCalcs = await accountRepo.getCalcs();
    const acctYields = await accountRepo.getYields();
    expect(acctCalcs).toHaveLength(1);
    expect(acctYields).toHaveLength(1);
    expect(acctCalcs[0].species).toBe('Salmon');
    expect(acctYields[0].species).toBe('Salmon');
  });

  it('clears the recovery scope after assignment', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc] });
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });

    const accountRepo = makeAccountRepo(store);
    await assignRecoveryToAccount(accountRepo, { recoveryRepo });

    const recovered = await recoveryRepo.getCalcs();
    expect(recovered).toHaveLength(0);
  });

  it('assigned records enter account scope with syncStatus local', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc] });
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });

    const accountRepo = makeAccountRepo(store);
    await assignRecoveryToAccount(accountRepo, { recoveryRepo });

    const acctCalcs = await accountRepo.getCalcs();
    expect(acctCalcs[0].syncStatus).toBe('local');
  });

  it('does not carry legacyId into the account scope', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc] });
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });

    const accountRepo = makeAccountRepo(store);
    await assignRecoveryToAccount(accountRepo, { recoveryRepo });

    const acctCalcs = await accountRepo.getCalcs();
    expect(acctCalcs[0].legacyId).toBeUndefined();
  });
});

// ---- discardRecovery ----

describe('discardRecovery', () => {
  it('clears all recovery records without assigning them', async () => {
    const store = makeStore({ [LEGACY_CALCS_KEY]: [localCalc], [LEGACY_YIELDS_KEY]: [localYield] });
    const recoveryRepo = makeRecoveryRepo(store);
    await migrateLegacyRecords({ store, recoveryRepo });

    await discardRecovery({ recoveryRepo });

    const counts = await getRecoveryCounts({ recoveryRepo });
    expect(counts.total).toBe(0);
  });
});
