import { describe, expect, it } from 'vitest';
import {
  readTicketOpen, readWhatToCharge, writeTicketOpen, writeWhatToCharge, TICKET_OPEN_KEY, WHAT_TO_CHARGE_KEY,
} from './remembered';

function fakeStorage(initial = {}) {
  const items = { ...initial };
  return {
    items,
    getItem: (key) => (key in items ? items[key] : null),
    setItem: (key, value) => { items[key] = String(value); },
  };
}

const blocked = {
  getItem: () => { throw new Error('storage is blocked'); },
  setItem: () => { throw new Error('storage is blocked'); },
};

describe('margin and portion size, remembered on this device', () => {
  it('are blank the first time', () => {
    expect(readWhatToCharge(fakeStorage())).toEqual({ margin: '', portion: '' });
  });

  it('come back as they were typed', () => {
    const storage = fakeStorage();
    writeWhatToCharge({ margin: '35', portion: '6' }, storage);
    expect(storage.items[WHAT_TO_CHARGE_KEY]).toBe('{"margin":"35","portion":"6"}');
    expect(readWhatToCharge(storage)).toEqual({ margin: '35', portion: '6' });
  });

  it('degrade to blank when storage is blocked, missing or holds something unexpected', () => {
    expect(readWhatToCharge(blocked)).toEqual({ margin: '', portion: '' });
    expect(readWhatToCharge(null)).toEqual({ margin: '', portion: '' });
    expect(() => writeWhatToCharge({ margin: '35', portion: '6' }, blocked)).not.toThrow();
    expect(() => writeWhatToCharge({ margin: '35', portion: '6' }, null)).not.toThrow();
    for (const stored of ['not json', 'null', '[]', '"35"', '{"margin":35,"portion":{"oz":6}}', `{"margin":"${'9'.repeat(40)}"}`]) {
      expect(readWhatToCharge(fakeStorage({ [WHAT_TO_CHARGE_KEY]: stored })), stored).toEqual({ margin: '', portion: '' });
    }
  });
});

describe('the ticket details, remembered for the session', () => {
  it('start closed and stay as they were left', () => {
    const storage = fakeStorage();
    expect(readTicketOpen(storage)).toBe(false);
    writeTicketOpen(true, storage);
    expect(storage.items[TICKET_OPEN_KEY]).toBe('1');
    expect(readTicketOpen(storage)).toBe(true);
    writeTicketOpen(false, storage);
    expect(readTicketOpen(storage)).toBe(false);
  });

  it('start closed when storage is blocked or missing', () => {
    expect(readTicketOpen(blocked)).toBe(false);
    expect(readTicketOpen(null)).toBe(false);
    expect(() => writeTicketOpen(true, blocked)).not.toThrow();
    expect(() => writeTicketOpen(true, null)).not.toThrow();
  });
});
