// CSV column order must match the upload template so exported files are
// immediately re-importable without editing column names.
const CSV_HEADER = 'Species,% Yield,Product,Source';

function escapeCSVField(value) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Convert the active-scope yield records into a CSV string.
 * Expects records from LocalRepository.getYields() — pending-delete tombstones
 * are already excluded by that method, so no extra filtering is needed here.
 */
export function yieldsToCSV(yields) {
  const rows = yields.map((y) =>
    [y.species, y.yield, y.product || '', y.source || ''].map(escapeCSVField).join(',')
  );
  return [CSV_HEADER, ...rows].join('\n');
}

/**
 * Trigger a browser file download for the given text content.
 */
export function downloadText(content, filename, mimeType = 'text/csv') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
