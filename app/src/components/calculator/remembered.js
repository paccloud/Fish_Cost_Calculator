/**
 * remembered.js — the two small things the calculator remembers between visits.
 *
 *   - the last margin and portion size, on this device (localStorage)
 *   - whether the ticket's details are open on a phone, for this session (sessionStorage)
 *
 * Both are conveniences and nothing depends on them: where storage is blocked, full or holds
 * something unexpected, the boxes start blank, the details start closed and nothing throws.
 */

export const WHAT_TO_CHARGE_KEY = 'fish-calc-what-to-charge';
export const TICKET_OPEN_KEY = 'fish-calc-ticket-open';

// Reading `localStorage` or `sessionStorage` can itself throw where storage is blocked
function storageNamed(name) {
  try {
    return globalThis[name] ?? null;
  } catch {
    return null;
  }
}

// Typed text only, and short: a box never starts with something a person could not have typed
const typedText = (value) => (typeof value === 'string' && value.length <= 12 ? value : '');

/**
 * @param {Pick<Storage, 'getItem'>|null} [storage=localStorage]
 * @returns {{margin: string, portion: string}} what was last typed; blank when there is nothing
 */
export function readWhatToCharge(storage = storageNamed('localStorage')) {
  try {
    const saved = JSON.parse(storage.getItem(WHAT_TO_CHARGE_KEY)) ?? {};
    return { margin: typedText(saved.margin), portion: typedText(saved.portion) };
  } catch {
    return { margin: '', portion: '' };
  }
}

/**
 * @param {{margin: string, portion: string}} values
 * @param {Pick<Storage, 'setItem'>|null} [storage=localStorage]
 */
export function writeWhatToCharge({ margin, portion }, storage = storageNamed('localStorage')) {
  try {
    storage.setItem(WHAT_TO_CHARGE_KEY, JSON.stringify({ margin: typedText(margin), portion: typedText(portion) }));
  } catch {
    /* not remembered; the boxes still work */
  }
}

/** @returns {boolean} true when the ticket's details were left open in this session */
export function readTicketOpen(storage = storageNamed('sessionStorage')) {
  try {
    return storage.getItem(TICKET_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTicketOpen(open, storage = storageNamed('sessionStorage')) {
  try {
    storage.setItem(TICKET_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* not remembered */
  }
}
