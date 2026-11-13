import { describe, it, expect, afterEach, vi } from 'vitest';
import { readRecentSpecies, pushRecentSpecies, RECENT_SPECIES_KEY, RECENT_SPECIES_LIMIT } from './recentSpecies.js';

// A stand-in for localStorage that keeps strings, like the real one
function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => (items.has(key) ? items.get(key) : null)),
    setItem: vi.fn((key, value) => {
      items.set(key, String(value));
    }),
    items,
  };
}

const blocked = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readRecentSpecies', () => {
  it('is empty before anything has been chosen', () => {
    expect(readRecentSpecies(memoryStorage())).toEqual([]);
  });

  it('returns what was stored, newest first', () => {
    const storage = memoryStorage({ [RECENT_SPECIES_KEY]: JSON.stringify(['Sockeye Salmon', 'Pacific Halibut']) });
    expect(readRecentSpecies(storage)).toEqual(['Sockeye Salmon', 'Pacific Halibut']);
  });

  it('reads one key only', () => {
    const storage = memoryStorage();
    readRecentSpecies(storage);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem).toHaveBeenCalledWith(RECENT_SPECIES_KEY);
  });

  it.each([
    ['text that is not JSON', 'Sockeye Salmon'],
    ['cut-off JSON', '["Sockeye Salmon"'],
    ['an object', '{"0":"Sockeye Salmon"}'],
    ['a single name', '"Sockeye Salmon"'],
    ['a number', '5'],
    ['null', 'null'],
    ['an empty string', ''],
  ])('is empty when the key holds %s', (_label, stored) => {
    expect(readRecentSpecies(memoryStorage({ [RECENT_SPECIES_KEY]: stored }))).toEqual([]);
  });

  it('drops anything that is not a name, repeats, and anything past the fifth', () => {
    const stored = ['Sockeye Salmon', 42, null, '', '   ', { name: 'Coho' }, 'Sockeye Salmon', ' Pacific Cod ', 'A', 'B', 'C', 'D'];
    const storage = memoryStorage({ [RECENT_SPECIES_KEY]: JSON.stringify(stored) });
    expect(readRecentSpecies(storage)).toEqual(['Sockeye Salmon', 'Pacific Cod', 'A', 'B', 'C']);
  });

  it.each([
    ['getItem throws', { getItem: blocked }],
    ['getItem returns nothing', { getItem: () => undefined }],
    ['there is no storage', null],
    ['storage is not storage', {}],
  ])('is empty when %s', (_label, storage) => {
    expect(readRecentSpecies(storage)).toEqual([]);
  });

  it('uses localStorage when no storage is given', () => {
    const storage = memoryStorage({ [RECENT_SPECIES_KEY]: JSON.stringify(['Sockeye Salmon']) });
    vi.stubGlobal('localStorage', storage);
    expect(readRecentSpecies()).toEqual(['Sockeye Salmon']);
  });

  it('is empty when localStorage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readRecentSpecies()).toEqual([]);
  });

  it('is empty when even reaching for localStorage throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: blocked });
    try {
      expect(readRecentSpecies()).toEqual([]);
      expect(pushRecentSpecies('Sockeye Salmon')).toEqual([]);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  });
});

describe('pushRecentSpecies', () => {
  it('stores the first species and returns the list', () => {
    const storage = memoryStorage();
    expect(pushRecentSpecies('Sockeye Salmon', storage)).toEqual(['Sockeye Salmon']);
    expect(readRecentSpecies(storage)).toEqual(['Sockeye Salmon']);
  });

  it('puts the newest first', () => {
    const storage = memoryStorage();
    pushRecentSpecies('Sockeye Salmon', storage);
    pushRecentSpecies('Pacific Halibut', storage);
    expect(pushRecentSpecies('Pacific Cod', storage)).toEqual(['Pacific Cod', 'Pacific Halibut', 'Sockeye Salmon']);
  });

  it('moves a species chosen again to the front without repeating it', () => {
    const storage = memoryStorage();
    for (const name of ['Sockeye Salmon', 'Pacific Halibut', 'Pacific Cod']) pushRecentSpecies(name, storage);
    expect(pushRecentSpecies('Sockeye Salmon', storage)).toEqual(['Sockeye Salmon', 'Pacific Cod', 'Pacific Halibut']);
  });

  it('keeps only the five most recent', () => {
    const storage = memoryStorage();
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']) pushRecentSpecies(name, storage);
    expect(RECENT_SPECIES_LIMIT).toBe(5);
    expect(readRecentSpecies(storage)).toEqual(['Seven', 'Six', 'Five', 'Four', 'Three']);
  });

  it('choosing the newest again changes nothing', () => {
    const storage = memoryStorage();
    pushRecentSpecies('Sockeye Salmon', storage);
    pushRecentSpecies('Pacific Cod', storage);
    expect(pushRecentSpecies('Pacific Cod', storage)).toEqual(['Pacific Cod', 'Sockeye Salmon']);
  });

  it('trims the name', () => {
    const storage = memoryStorage();
    pushRecentSpecies('Sockeye Salmon', storage);
    expect(pushRecentSpecies('  Sockeye Salmon ', storage)).toEqual(['Sockeye Salmon']);
  });

  it('writes one key, as JSON', () => {
    const storage = memoryStorage({ other: 'untouched' });
    pushRecentSpecies('Sockeye Salmon', storage);
    pushRecentSpecies('Pacific Cod', storage);
    expect([...storage.items.keys()].sort()).toEqual([RECENT_SPECIES_KEY, 'other'].sort());
    expect(storage.items.get('other')).toBe('untouched');
    expect(JSON.parse(storage.items.get(RECENT_SPECIES_KEY))).toEqual(['Pacific Cod', 'Sockeye Salmon']);
  });

  it.each([[''], ['   '], [undefined], [null], [42], [{}], [['Sockeye Salmon']]])('ignores %j as a name', (name) => {
    const storage = memoryStorage({ [RECENT_SPECIES_KEY]: JSON.stringify(['Pacific Cod']) });
    expect(pushRecentSpecies(name, storage)).toEqual(['Pacific Cod']);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('starts again over stored junk', () => {
    const storage = memoryStorage({ [RECENT_SPECIES_KEY]: '{not json' });
    expect(pushRecentSpecies('Sockeye Salmon', storage)).toEqual(['Sockeye Salmon']);
    expect(readRecentSpecies(storage)).toEqual(['Sockeye Salmon']);
  });

  it('returns an empty list when storage is blocked', () => {
    expect(pushRecentSpecies('Sockeye Salmon', { getItem: blocked, setItem: blocked })).toEqual([]);
    expect(pushRecentSpecies('Sockeye Salmon', null)).toEqual([]);
    expect(pushRecentSpecies('Sockeye Salmon', {})).toEqual([]);
  });

  it('returns the list as it was when saving fails', () => {
    // Full storage: reading works, writing throws
    const storage = memoryStorage({ [RECENT_SPECIES_KEY]: JSON.stringify(['Pacific Cod']) });
    storage.setItem = vi.fn(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(pushRecentSpecies('Sockeye Salmon', storage)).toEqual(['Pacific Cod']);
    expect(readRecentSpecies(storage)).toEqual(['Pacific Cod']);
  });

  it('uses localStorage when no storage is given', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(pushRecentSpecies('Sockeye Salmon')).toEqual(['Sockeye Salmon']);
    expect(readRecentSpecies()).toEqual(['Sockeye Salmon']);
    expect(storage.items.has(RECENT_SPECIES_KEY)).toBe(true);
  });
});
