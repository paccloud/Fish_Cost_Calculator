import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// The store build has no API: /login redirects to the calculator, so nothing may point at it.
const data = {};
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, getAuthHeaders: async () => ({}) }) }));
vi.mock('../context/DataContext', () => ({ useData: () => data }));
vi.mock('../config/platform', () => ({ backendEnabled: false, isNativeApp: true, thisDevice: 'this phone' }));

import DataManagement from './DataManagement';

const CALC = { id: 'c1', species: 'Sockeye Salmon', product: 'Round → Skinless Fillet', cost: 4.5, yield: 46, result: 9.7826, syncStatus: 'local' };
const html = () => renderToStaticMarkup(<MemoryRouter><DataManagement /></MemoryRouter>);
const text = () => html().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  Object.assign(data, { customYields: [], savedCalcs: [], dataLoaded: true, readOnly: false, removeYield: vi.fn(), removeCalc: vi.fn() });
});

describe('My yields with no backend', () => {
  it('with nothing saved, offers no sign-in', () => {
    expect(text()).toContain('They stay on this phone.');
    expect(text()).not.toMatch(/sign in|account/i);
    expect(html()).not.toContain('href="/login"');
  });

  it('with a saved price, says where it is and offers no sign-in', () => {
    data.savedCalcs = [CALC];
    expect(text()).toContain('Saved on this phone.');
    expect(text()).toContain('$9.78/lb');
    expect(text()).not.toMatch(/sign in|every device/i);
    expect(html()).not.toContain('href="/login"');
  });
});
