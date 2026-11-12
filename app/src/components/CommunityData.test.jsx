import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

import CommunityData, { CommunityYieldsView } from './CommunityData';

const ROWS = [
  { id: 1, species: 'Sockeye Salmon', product: 'Round → Skinless Fillet', yield: '46.00', contributor: 'Dana', organization: 'North Dock', source: 'Scale log' },
  { id: 2, species: 'Halibut', product: 'Round → Fletch', yield: 38.5, contributor: null },
];

function html(element) {
  return renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
}

function text(element) {
  return html(element)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

describe('CommunityYieldsView', () => {
  it('shows only the failure and a way forward when loading fails', () => {
    const out = text(<CommunityYieldsView status="error" rows={[]} />);
    expect(out).toContain('Community yields didn’t load');
    expect(out).toContain('The calculator still works without them. Try again when you have signal.');
    expect(out).toContain('Try again');
    // Not the empty state, the search box or the download on top of the failure
    expect(out).not.toContain('No community yields yet');
    expect(out).not.toContain('Download CSV');
    expect(out).not.toContain('Search community yields');
  });

  it('keeps the retry button in place and says so while a retry is running', () => {
    const out = html(<CommunityYieldsView status="error" rows={[]} retrying />);
    expect(out).toContain('Trying again…');
    expect(out).toContain('aria-disabled="true"');
  });

  it('offers no download when there is nothing to download', () => {
    const out = text(<CommunityYieldsView status="ready" rows={[]} />);
    expect(out).toContain('No community yields yet');
    expect(out).not.toContain('Download CSV');
    expect(out).not.toContain('didn’t load');
  });

  it('points a guest at sign-in and a signed-in person at My yields from the empty state', () => {
    expect(html(<CommunityYieldsView status="ready" rows={[]} />)).toContain('href="/login"');
    const signedIn = html(<CommunityYieldsView status="ready" rows={[]} signedIn />);
    expect(signedIn).toContain('href="/manage-data"');
    expect(signedIn).not.toContain('href="/login"');
  });

  it('lists yields with their unit, who shared them, and the download', () => {
    const out = text(<CommunityYieldsView status="ready" rows={ROWS} />);
    expect(out).toContain('Sockeye Salmon');
    expect(out).toContain('46% yield');
    expect(out).toContain('38.5% yield');
    expect(out).toContain('Shared by Dana (North Dock) · Source: Scale log');
    expect(out).toContain('Shared by Anonymous');
    expect(out).toContain('2 yields');
    expect(out).toContain('Download CSV');
  });

  it('filters by species, product or contributor and can come up empty', () => {
    const match = text(<CommunityYieldsView status="ready" rows={ROWS} search="fletch" />);
    expect(match).toContain('Halibut');
    expect(match).not.toContain('Sockeye Salmon');
    expect(match).toContain('1 of 2 yields');

    const none = text(<CommunityYieldsView status="ready" rows={ROWS} search="tuna" />);
    expect(none).toContain('No yields match “tuna”');
    expect(none).toContain('Clear search');
  });

  it('underlines the inline sign-in link so it is not told apart by colour alone', () => {
    const out = html(<CommunityYieldsView status="ready" rows={ROWS} />);
    expect(out).toMatch(/<a[^>]*class="[^"]*\bunderline\b[^"]*"[^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(out).not.toMatch(/Log in/i);
  });

  it('labels the search field', () => {
    const out = html(<CommunityYieldsView status="ready" rows={ROWS} />);
    expect(out).toContain('<label for="community-search"');
    expect(out).toContain('id="community-search"');
  });
});

describe('CommunityData', () => {
  it('opens on one title and a loading line', () => {
    const out = html(<CommunityData />);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('Community yields</h1>');
    expect(out).not.toContain('Community Data Pool');
    expect(text(<CommunityData />)).toContain('Loading community yields…');
  });
});
