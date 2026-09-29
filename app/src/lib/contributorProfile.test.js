import { describe, it, expect } from 'vitest';
import {
  isExplicitOptIn,
  normalizeShowOnPage,
  DEFAULT_PROFILE_FORM,
  profileToFormData,
  buildProfilePayload,
} from './contributorProfile';

describe('normalizeShowOnPage', () => {
  it.each([[true], [1], ['true']])('%j is checked', (v) => {
    expect(normalizeShowOnPage(v)).toBe(true);
  });
  it.each([[false], [0], ['false'], [null], [undefined], ['yes'], ['1'], [2], [{}], ['']])(
    '%j is not checked',
    (v) => {
      expect(normalizeShowOnPage(v)).toBe(false);
    },
  );
});

describe('isExplicitOptIn (privacy-strict)', () => {
  it('accepts only true and 1', () => {
    expect(isExplicitOptIn(true)).toBe(true);
    expect(isExplicitOptIn(1)).toBe(true);
    for (const v of ['true', '1', 'yes', 0, false, null, undefined, {}]) {
      expect(isExplicitOptIn(v)).toBe(false);
    }
  });
});

describe('profile load -> save round trip', () => {
  const stored = (show_on_page) => ({
    display_name: 'Dana', organization: 'Sitka', bio: 'typo', show_on_page,
  });

  it.each([[true], [1], ['true']])('opted-in profile returned as %j saves show_on_page true', (v) => {
    const form = profileToFormData(stored(v));
    expect(form.show_on_page).toBe(true);
    expect(buildProfilePayload(form)).toEqual({
      display_name: 'Dana', organization: 'Sitka', bio: 'typo', show_on_page: true,
    });
  });

  it.each([[false], [0], ['false'], [null]])('opted-out profile returned as %j saves false', (v) => {
    expect(buildProfilePayload(profileToFormData(stored(v))).show_on_page).toBe(false);
  });

  it('brand-new profile keeps the default', () => {
    expect(profileToFormData(null)).toEqual(DEFAULT_PROFILE_FORM);
    expect(profileToFormData(undefined).show_on_page).toBe(true);
  });

  it('fills blank text fields from null values', () => {
    expect(profileToFormData({ display_name: null, show_on_page: 1 })).toEqual({
      display_name: '', organization: '', bio: '', show_on_page: true,
    });
  });
});
