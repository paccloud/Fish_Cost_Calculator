const CSV_FORMULA_PREFIX = /^[=+\-@]/;

export function sanitizeCsvValue(value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return CSV_FORMULA_PREFIX.test(escaped.trimStart()) ? `'${escaped}` : escaped;
}

export function buildCsv(headers, rows) {
  const csvHeader = `${headers.join(',')}\n`;
  const csvRows = rows
    .map((row) => `"${row.map(sanitizeCsvValue).join('","')}"`)
    .join('\n');

  return csvHeader + csvRows;
}
