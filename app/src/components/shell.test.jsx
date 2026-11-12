/**
 * The contracts other screens build on: Stamp, Notice, the tab bar and the platform flags.
 * Rendered to markup, as the context tests are: there is no DOM in this test run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Stamp from './Stamp.jsx';
import Notice from './Notice.jsx';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../config/platform');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Stamp', () => {
  it('is a plain label, with a class for each source', () => {
    expect(renderToStaticMarkup(<Stamp>MAB-37 · 41–49%</Stamp>)).toBe('<span class="stamp">MAB-37 · 41–49%</span>');
    expect(renderToStaticMarkup(<Stamp tone="yours">Your yield</Stamp>)).toContain('class="stamp stamp-yours"');
    expect(renderToStaticMarkup(<Stamp tone="community">Community · 12 cuts</Stamp>)).toContain('class="stamp stamp-community"');
  });
});

describe('Notice', () => {
  it('announces success politely, with an icon and a bold first sentence', () => {
    const html = renderToStaticMarkup(<Notice title="Saved.">Sockeye is in My yields.</Notice>);
    expect(html).toContain('role="status"');
    expect(html).toContain('class="notice notice-success"');
    expect(html).toContain('<strong>Saved.</strong>Sockeye is in My yields.');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('announces a failure straight away', () => {
    const html = renderToStaticMarkup(
      <Notice tone="error" title="The community yields didn’t load.">Try again when you have signal.</Notice>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('class="notice notice-error"');
  });
});

async function renderTabBar(pathname, platform) {
  vi.resetModules();
  if (platform) vi.doMock('../config/platform', () => platform);
  const { MemoryRouter } = await import('react-router-dom');
  const { default: TabBar } = await import('./TabBar.jsx');
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <TabBar />
    </MemoryRouter>,
  );
}

const tabs = (html) => [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>(?:<svg.*?<\/svg>)?([^<]*)<\/a>/g)].map(([, href, label]) => [label, href]);
const current = (html) => [...html.matchAll(/<a[^>]*aria-current="([^"]*)"[^>]*href="([^"]*)"/g)].map(([, value, href]) => [href, value]);

describe('TabBar', () => {
  it('has the four destinations, in order, in one labelled nav', async () => {
    const html = await renderTabBar('/', { backendEnabled: true, isNativeApp: false });
    expect(html).toMatch(/^<nav aria-label="Main" class="tabbar">/);
    expect(tabs(html)).toEqual([
      ['Calculate', '/'],
      ['My yields', '/manage-data'],
      ['Community', '/community-data'],
      ['Account', '/account'],
    ]);
  });

  it('marks only the tab you are on as the current page', async () => {
    expect(current(await renderTabBar('/', { backendEnabled: true }))).toEqual([['/', 'page']]);
    expect(current(await renderTabBar('/manage-data', { backendEnabled: true }))).toEqual([['/manage-data', 'page']]);
    expect(current(await renderTabBar('/account/', { backendEnabled: true }))).toEqual([['/account', 'page']]);
  });

  it('keeps Account lit on the screens reached from it', async () => {
    for (const path of ['/login', '/upload', '/data-sources', '/about', '/profile']) {
      expect(current(await renderTabBar(path, { backendEnabled: true })), path).toEqual([['/account', 'true']]);
    }
  });

  it('lights nothing on an address it does not know', async () => {
    expect(current(await renderTabBar('/nope', { backendEnabled: true }))).toEqual([]);
  });

  it('gives every tab an icon hidden from screen readers beside its label', async () => {
    const html = await renderTabBar('/', { backendEnabled: true });
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(4);
  });

  it('has three tabs and no sign-in or community when there is no backend', async () => {
    const html = await renderTabBar('/about', { backendEnabled: false, isNativeApp: true });
    expect(tabs(html)).toEqual([
      ['Calculate', '/'],
      ['My yields', '/manage-data'],
      ['About', '/about'],
    ]);
    expect(current(html)).toEqual([['/about', 'page']]);
    expect(html).not.toMatch(/sign in|community|account/i);
  });
});

describe('platform flags', () => {
  const load = async () => {
    vi.resetModules();
    return import('../config/platform.js');
  };

  it('is a web app with a backend by default', async () => {
    expect(await load()).toMatchObject({ isNativeApp: false, backendEnabled: true });
  });

  it('has no backend inside the Capacitor shell', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    expect(await load()).toMatchObject({ isNativeApp: true, backendEnabled: false });
  });

  it('treats Capacitor running in a browser as the web app', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => false });
    expect(await load()).toMatchObject({ isNativeApp: false, backendEnabled: true });
  });

  it('can be built without a backend with VITE_BACKEND=off', async () => {
    vi.stubEnv('VITE_BACKEND', 'off');
    expect(await load()).toMatchObject({ isNativeApp: false, backendEnabled: false });
  });
});
