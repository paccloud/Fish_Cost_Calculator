import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const auth = {
  user: null,
  getAuthHeaders: async () => ({}),
  login: vi.fn(),
  register: vi.fn(),
  resendVerificationEmail: vi.fn(),
  loginWithGoogle: vi.fn(),
  completeGoogleSignIn: vi.fn(),
};
const data = { isOnline: true, retrySync: vi.fn() };

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../context/DataContext', () => ({ useData: () => data }));

import Login from './Login';
import UploadData from './UploadData';
import ContributorProfile from './ContributorProfile';
import About from './About';
import DataTransparency from './DataTransparency';

function html(element) {
  return renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
}

function text(element) {
  return html(element).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

// Every text control has an id, and a label tied to that id.
function expectLabelledFields(markup) {
  const labelled = [...markup.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
  const controls = [...markup.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => !/type="(?:file|hidden)"/.test(tag));
  expect(controls.length).toBeGreaterThan(0);
  for (const tag of controls) {
    const id = tag.match(/\sid="([^"]+)"/)?.[1];
    expect(id, tag).toBeTruthy();
    expect(labelled, tag).toContain(id);
  }
}

beforeEach(() => {
  auth.user = null;
  data.isOnline = true;
});

describe('Sign in', () => {
  it('uses one plain title and the account words from the style guide', () => {
    const markup = html(<Login />);
    const out = text(<Login />);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('>Sign in</h1>');
    expect(out).toContain('Sign in with Google');
    expect(out).toContain('New here? Create account');
    expect(out).toContain('Continue without an account');
    for (const banned of ['Welcome Back', 'Sign Up', 'Sign In', 'Log in', 'Login', 'Guest', '!']) {
      expect(out).not.toContain(banned);
    }
  });

  it('labels the email and password fields', () => {
    expectLabelledFields(html(<Login />));
  });

  it('builds every action from a shared button class, so none is under 44px', () => {
    const markup = html(<Login />);
    const actions = [...markup.matchAll(/<(?:button|a)\b[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(actions).toHaveLength(4);
    for (const classes of actions) expect(classes).toMatch(/\bbtn-(primary|secondary|ghost)\b/);
  });
});

describe('Screens that need an account', () => {
  it.each([
    ['Upload', <UploadData key="u" />, 'Uploading a spreadsheet of your own yields needs an account'],
    ['How your name appears', <ContributorProfile key="p" />, 'Choosing the name shown beside the yields you share needs an account.'],
  ])('%s says so in one calm sentence with a sign-in button', (_name, element, sentence) => {
    const markup = html(element);
    const out = text(element);
    expect(out).toContain(sentence);
    expect(markup).toMatch(/<a[^>]*class="[^"]*btn-primary[^"]*"[^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(out).not.toMatch(/login required/i);
    expect(out).not.toMatch(/go to login/i);
  });
});

describe('Upload, signed in', () => {
  beforeEach(() => { auth.user = { uid: 'u1' }; });

  it('offers a real button to choose a file, a template, and one upload action', () => {
    const out = text(<UploadData />);
    expect(out).toContain('Choose a file');
    expect(out).toContain('Download a template');
    expect(out).toContain('Upload file');
    expect(out).not.toContain('offline');
  });

  it('says why upload is off when there is no connection', () => {
    data.isOnline = false;
    expect(text(<UploadData />)).toContain('You’re offline. Uploading needs a connection.');
  });
});

describe('How your name appears, signed in', () => {
  it('labels every field and holds the form until the stored details load', () => {
    auth.user = { uid: 'u1' };
    const markup = html(<ContributorProfile />);
    expectLabelledFields(markup);
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(text(<ContributorProfile />)).not.toContain('Contributor Profile');
  });
});

describe('Reading pages', () => {
  it.each([
    ['About', <About key="a" />, 'About Local Catch'],
    ['Data sources', <DataTransparency key="d" />, 'Data sources and methodology'],
  ])('%s has one title, headings in order, and nothing centred', (_name, element, title) => {
    const markup = html(element);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain(`${title}</h1>`);
    const levels = [...markup.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
    expect(markup).not.toContain('text-center');
  });

  it('keeps the MAB-37 citation on Data sources', () => {
    const out = text(<DataTransparency />);
    expect(out).toContain('Recoveries and Yields from Pacific Fish and Shellfish');
    expect(out).toContain('Marine Advisory Bulletin No. 37');
    expect(out).toContain('Chuck Crapo, Brian Paust, Jerry Babbitt');
    expect(out).toContain('Alaska Sea Grant College Program');
    expect(out).toContain('1-56612-012-8');
  });

  it('keeps the origin story and outside links on About', () => {
    const markup = html(<About />);
    expect(text(<About />)).toContain('reinvigorated by a conversation on the listserv of the Local Catch network');
    for (const href of ['https://localcatch.org', 'https://github.com/paccloud/Fish_Cost_Calculator', 'https://buymeacoffee.com/pcswny']) {
      expect(markup).toContain(`href="${href}"`);
    }
    expect(text(<About />)).not.toContain('!');
  });
});
