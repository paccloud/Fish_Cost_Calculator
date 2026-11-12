import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const auth = { user: null, getAuthHeaders: async () => ({}) };
const data = {};

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../context/DataContext', () => ({ useData: () => data }));

import DataManagement from './DataManagement';
import { createRepository, accountScope } from '../lib/localRepository';
import { buildTicketModel } from './calculator/ticketModel';
import { savedPriceRecord } from './calculator/priceActions';

const CALC = { id: 'c1', species: 'Sockeye Salmon', product: 'Round → Skinless Fillet', cost: 4.5, yield: 46, result: 9.7826, name: 'Sockeye Salmon - Round → Skinless Fillet', syncStatus: 'local' };
const WEIGHT_CALC = { id: 'c2', species: 'Halibut', product: 'Round → Fletch', mode: 'weight', yield: 40, result: 250, name: 'Friday order', syncStatus: 'local' };
const YIELD = { id: 'y1', species: 'Lingcod', product: 'Round → Fillet', yield: '31.00', source: 'User Input', syncStatus: 'local' };

function html() {
  return renderToStaticMarkup(<MemoryRouter><DataManagement /></MemoryRouter>);
}

function text() {
  return html().replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

beforeEach(() => {
  auth.user = null;
  Object.assign(data, {
    customYields: [],
    savedCalcs: [],
    dataLoaded: true,
    storageFailed: false,
    readOnly: false,
    addYield: vi.fn(),
    updateYield: vi.fn(),
    removeYield: vi.fn(),
    removeCalc: vi.fn(),
    updateYieldLocalOnly: vi.fn(),
    requestPublish: vi.fn(),
    unpublishCalc: vi.fn(),
  });
});

describe('DataManagement for a guest', () => {
  it('is never a sign-in wall', () => {
    const out = text();
    expect(out).not.toMatch(/login required/i);
    expect(out).not.toMatch(/go to login/i);
    expect(out).toContain('My yields');
  });

  it('with nothing saved, says what will appear and leads back to the calculator', () => {
    const markup = html();
    expect(text()).toContain('Nothing saved on this phone yet');
    expect(text()).toContain('Prices you save from the calculator show up here.');
    expect(markup).toMatch(/<a[^>]*class="[^"]*btn-primary[^"]*"[^>]*href="\/"[^>]*>Go to the calculator<\/a>/);
    // The sign-in route is still there, as an underlined inline link
    expect(markup).toMatch(/<a[^>]*class="[^"]*\bunderline\b[^"]*"[^>]*href="\/login"/);
  });

  it('shows what is saved on this phone, where it lives, and a sign-in button', () => {
    data.savedCalcs = [CALC, WEIGHT_CALC];
    const out = text();
    expect(out).toContain('Saved on this phone until you sign in.');
    expect(html()).toMatch(/<a[^>]*class="[^"]*btn-primary[^"]*"[^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(out).toContain('Saved prices');
    expect(out).toContain('Sockeye Salmon');
    expect(out).toContain('Whole fish → Skinless fillet · 46% yield');
    expect(out).toContain('$9.78/lb');
    // A "Pounds to buy" result is a weight, not a price
    expect(out).toContain('250 lb to buy');
    expect(out).toContain('Kept on this phone only');
    expect(out).toContain('Saved as “Friday order”');
    expect(html()).toContain('aria-label="Delete Sockeye Salmon, Round → Skinless Fillet"');
    expect(out).not.toContain('Nothing saved on this phone yet');
  });

  it('shows guest yields only when the phone has some, with delete and nothing that needs an account', () => {
    data.savedCalcs = [CALC];
    expect(text()).not.toContain('Your yields');

    data.customYields = [YIELD];
    const out = text();
    expect(out).toContain('Your yields');
    expect(out).toContain('Lingcod');
    expect(out).toContain('31% yield');
    expect(out).not.toContain('User Input');
    expect(html()).toContain('aria-label="Delete Lingcod, Round → Fillet"');
    expect(out).not.toContain('Edit');
    expect(out).not.toContain('Share');
    expect(out).not.toContain('Publish');
    expect(out).not.toContain('Add a yield');
  });

  it('waits for the phone’s storage before calling it empty', () => {
    data.dataLoaded = false;
    const out = text();
    expect(out).toContain('Loading what’s saved on this phone…');
    expect(out).not.toContain('Nothing saved on this phone yet');
  });

  it('turns delete off while the app is read-only', () => {
    data.savedCalcs = [CALC];
    data.readOnly = true;
    expect(html()).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Delete Sockeye Salmon/);
  });
});

describe('DataManagement when signed in', () => {
  beforeEach(() => {
    auth.user = { uid: 'u1', username: 'dana' };
  });

  it('lists yields with share, edit and delete, and saved prices with publish', () => {
    data.customYields = [
      { ...YIELD, serverId: 7, syncStatus: 'synced', is_shared: true, source: 'Scale log' },
      { ...YIELD, id: 'y2', species: 'Rockfish', syncStatus: 'local' },
    ];
    data.savedCalcs = [
      { ...CALC, serverId: 3, syncStatus: 'synced', is_private: true },
      { ...WEIGHT_CALC, serverId: 4, syncStatus: 'synced', is_private: false },
    ];
    const out = text();
    const markup = html();
    expect(out).toContain('Add a yield');
    expect(out).toContain('Export CSV');
    expect(out).toContain('Shared with the community');
    expect(out).toContain('Source: Scale log');
    expect(out).toContain('Waiting to sync');
    expect(markup).toContain('aria-label="Stop sharing Lingcod, Round → Fillet"');
    expect(markup).toContain('aria-label="Edit Rockfish, Round → Fillet"');
    // An entry that has not reached the server cannot be shared yet
    expect(markup).not.toContain('aria-label="Share Rockfish');
    expect(markup).toContain('aria-label="Publish Sockeye Salmon, Round → Skinless Fillet"');
    expect(markup).toContain('aria-label="Unpublish Halibut, Round → Fletch"');
    expect(out).toContain('Private');
    expect(out).toContain('Public');
    expect(out).not.toContain('Saved on this phone until you sign in.');
  });

  it('says how to add the first yield and price when there are none', () => {
    const out = text();
    expect(out).toContain('No yields of your own yet.');
    expect(out).toContain('No saved prices yet.');
  });

  it('turns every change off while the app is read-only', () => {
    data.readOnly = true;
    data.customYields = [{ ...YIELD, serverId: 7, syncStatus: 'synced' }];
    const markup = html();
    for (const name of ['Share Lingcod', 'Edit Lingcod', 'Delete Lingcod']) {
      expect(markup).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*aria-label="${name}`));
    }
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>(<svg.*?<\/svg>)?Add a yield/);
  });

  it('uses sentence case and the names from the style guide', () => {
    const out = text();
    for (const banned of ['Manage Your Data', 'Your Custom Data', 'Saved Calculations', 'Add Entry', 'Log in', 'Login', '!']) {
      expect(out).not.toContain(banned);
    }
  });
});

describe('when the browser will not store anything', () => {
  it('says so and is not stuck on loading', () => {
    Object.assign(data, { dataLoaded: false, storageFailed: true });
    const out = text();
    expect(out).toContain('Nothing can be kept on this phone.');
    expect(out).not.toContain('Loading');
  });

  it('still shows a signed-in person the yields their account has', () => {
    auth.user = { id: 1, username: 'dana' };
    Object.assign(data, { dataLoaded: false, storageFailed: true, customYields: [YIELD] });
    const out = text();
    expect(out).toContain('Lingcod');
    expect(out).not.toContain('Loading your yields');
  });

  // The rows a signed-in person sees here are the server's own, read straight from the account
  const ACCOUNT_YIELD = { id: 7, species: 'Lingcod', product: 'Round → Fillet', yield: '31.00', source: 'User Input', is_shared: false, revision: 2 };

  it('tells a signed-in person too, and why their yields cannot be changed here', () => {
    auth.user = { uid: 'u1', username: 'dana' };
    Object.assign(data, { dataLoaded: false, storageFailed: true, customYields: [ACCOUNT_YIELD] });
    const out = text();
    expect(html()).toMatch(/<div class="notice notice-error" role="alert">/);
    expect(out).toContain('Nothing can be kept on this phone.');
    expect(out).toContain('You can still see the yields in your account, but changing them needs storage on this phone.');
    expect(out).toContain('Allow site data in your browser settings, then reload.');
    // The guest wording is about saving here, which is not what a signed-in person is doing
    expect(out).not.toContain('what you save here will not stay');
  });

  it('turns off adding, editing and deleting a yield for a signed-in person, since each is written on the phone first', () => {
    auth.user = { uid: 'u1', username: 'dana' };
    Object.assign(data, { dataLoaded: false, storageFailed: true, customYields: [ACCOUNT_YIELD] });
    const markup = html();
    for (const name of ['Edit Lingcod', 'Delete Lingcod']) {
      expect(markup).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*aria-label="${name}`));
    }
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>(<svg.*?<\/svg>)?Add a yield/);
    // Downloading them needs no storage
    expect(markup.match(/<button[^>]*title="Download your yields[^>]*>/)[0]).not.toContain('disabled');
  });

  it('leaves them on, with no storage warning, when storage works', () => {
    auth.user = { uid: 'u1', username: 'dana' };
    Object.assign(data, { customYields: [{ ...YIELD, serverId: 7, syncStatus: 'synced' }] });
    const markup = html();
    expect(text()).not.toContain('Nothing can be kept on this phone.');
    expect(markup).toContain('aria-label="Edit Lingcod, Round → Fillet"');
    expect(markup).toContain('aria-label="Delete Lingcod, Round → Fillet"');
    expect(markup).not.toMatch(/<button[^>]*disabled=""/);
  });
});

// In-memory stand-in for the device store
function memoryStore() {
  const db = {};
  return {
    get: async (key) => structuredClone(db[key]),
    set: async (key, value) => { db[key] = structuredClone(value); },
  };
}

// What the sync sends for a saved price, and so all that comes back from the server
const sentToServer = ({ name, species, product, cost, yield: yieldUsed, result }) => ({ name, species, product, cost, yield: yieldUsed, result });

describe('a saved price that came back from the server without its mode', () => {
  const CHOSEN = { species: 'Sockeye Salmon', fromState: 'Round', toState: 'Skinless Fillet' };
  const SOCKEYE = { yield: 46, range: [41, 49], from: 'Round', to: 'Skinless Fillet' };

  it('is a price, even when the fish cost nothing and only the processing was paid for', async () => {
    // A fisher pricing their own catch: $0 for the fish, $1.00/lb to process it
    const model = buildTicketModel({ mode: 'cost', ...CHOSEN, cost: '0', processingCost: '1.00', yieldPercent: '46', conversion: SOCKEYE });
    const record = savedPriceRecord({ mode: 'cost', ...CHOSEN, targetWeight: NaN }, model);
    expect(record).toMatchObject({ mode: 'cost', cost: 0 });

    // Another device gets it from the account, with no mode
    const otherDevice = createRepository(accountScope('u1'), { store: memoryStore() });
    await otherDevice.mergeServerCalcs([{ id: 9, ...sentToServer(record), is_private: true }]);
    const [pulled] = await otherDevice.getCalcs();
    expect(pulled.mode).toBeUndefined();
    expect(pulled.cost).toBe(0);

    auth.user = { uid: 'u1', username: 'dana' };
    data.savedCalcs = [pulled];
    const out = text();
    expect(out).toContain('$2.17/lb');
    expect(out).not.toContain('lb to buy');
    expect(out).not.toContain('Kept on this phone only');
    expect(html()).toContain('aria-label="Publish Sockeye Salmon, Round → Skinless Fillet"');
  });

  it('is a price when it has a cost, too', () => {
    data.savedCalcs = [{ id: 's2', species: 'Sockeye Salmon', product: 'Round → Skinless Fillet', cost: '4.50', yield: 46, result: 9.78, syncStatus: 'synced' }];
    expect(text()).toContain('$9.78/lb');
  });
});

describe('a "Pounds to buy" answer', () => {
  beforeEach(() => {
    auth.user = { uid: 'u1', username: 'dana' };
  });

  it('is a weight kept on this phone only, with delete and no publish', () => {
    data.savedCalcs = [WEIGHT_CALC];
    const out = text();
    const markup = html();
    expect(out).toContain('250 lb to buy');
    expect(out).not.toContain('$250.00/lb');
    expect(out).toContain('Kept on this phone only');
    // Not in the account, so neither private nor public there
    expect(out).not.toContain('Private');
    expect(out).not.toContain('Public');
    expect(markup).not.toContain('aria-label="Publish Halibut');
    expect(markup).toContain('aria-label="Delete Halibut, Round → Fletch"');
  });

  it('cannot be published even if an older version of the app sent it to the account', () => {
    data.savedCalcs = [{ ...WEIGHT_CALC, serverId: 4, syncStatus: 'synced', is_private: true }];
    const out = text();
    const markup = html();
    expect(out).toContain('250 lb to buy');
    expect(markup).not.toContain('aria-label="Publish Halibut');
    // It is in the account, so it is not called device-only
    expect(out).not.toContain('Kept on this phone only');
    expect(out).toContain('Private');
    expect(markup).toContain('aria-label="Delete Halibut, Round → Fletch"');
  });

  it('can still be taken down if an older version of the app published it', () => {
    data.savedCalcs = [{ ...WEIGHT_CALC, serverId: 4, syncStatus: 'synced', is_private: false }];
    expect(html()).toContain('aria-label="Unpublish Halibut, Round → Fletch"');
  });
});
