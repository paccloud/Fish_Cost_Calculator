import { describe, expect, it } from 'vitest';
import { yieldsToCSV } from './dataExport';

// downloadText is a DOM side-effect helper — tested via integration, not unit tests.

const make = (overrides = {}) => ({
  id: 'y1',
  scope: 'guest:abc',
  species: 'Salmon',
  product: 'Fillet',
  yield: 45,
  source: 'User Input',
  syncStatus: 'local',
  ...overrides,
});

describe('yieldsToCSV', () => {
  it('emits the correct header', () => {
    const csv = yieldsToCSV([]);
    expect(csv).toBe('Species,% Yield,Product,Source');
  });

  it('renders one row per yield record', () => {
    const csv = yieldsToCSV([make(), make({ id: 'y2', species: 'Halibut', yield: 38 })]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('projects species, yield, product, source in column order', () => {
    const csv = yieldsToCSV([make({ species: 'Cod', yield: 40, product: 'Steak', source: 'Lab' })]);
    const row = csv.split('\n')[1];
    expect(row).toBe('Cod,40,Steak,Lab');
  });

  it('fills blank product and source with empty string', () => {
    const csv = yieldsToCSV([make({ product: undefined, source: undefined })]);
    const row = csv.split('\n')[1];
    expect(row).toBe('Salmon,45,,');
  });

  it('escapes commas in field values', () => {
    const csv = yieldsToCSV([make({ species: 'Salmon, Atlantic', product: 'Fillet' })]);
    const row = csv.split('\n')[1];
    expect(row).toBe('"Salmon, Atlantic",45,Fillet,User Input');
  });

  it('escapes double-quotes in field values', () => {
    const csv = yieldsToCSV([make({ source: 'Say "hi"' })]);
    const row = csv.split('\n')[1];
    expect(row).toContain('"Say ""hi"""');
  });

  it('escapes newlines in field values', () => {
    const csv = yieldsToCSV([make({ species: 'Sal\nmon' })]);
    const row = csv.split('\n')[1];
    expect(row).toMatch(/^"Sal/);
  });

  it('escapes carriage returns in field values', () => {
    const csv = yieldsToCSV([make({ species: 'Sal\rmon' })]);
    const row = csv.split('\n')[1];
    expect(row).toMatch(/^"Sal/);
  });

  it('excludes no records itself — callers must pass already-filtered yields', () => {
    // LocalRepository.getYields() already filters pending-delete; CSV has no extra filtering.
    const csv = yieldsToCSV([make({ syncStatus: 'pending-delete' })]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 row (dataExport does NOT filter by status)
  });
});
