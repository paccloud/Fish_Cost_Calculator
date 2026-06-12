import ExcelJS from 'exceljs';
import { Readable } from 'stream';

const MAX_CELL_LENGTH = 500;
const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx']);
const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

export function getUploadExtension(filename = '') {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

export function assertAllowedImportFile(file) {
  const filename = file?.originalFilename || file?.newFilename || '';
  const extension = getUploadExtension(filename);
  const mimetype = file?.mimetype || '';

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported file type. Please upload a .csv or .xlsx file.');
  }

  if (mimetype && !ALLOWED_MIME_TYPES.has(mimetype)) {
    throw new Error('Unsupported file content type. Please upload a CSV or XLSX file.');
  }

  return extension;
}

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.text) return String(value.text).trim().slice(0, MAX_CELL_LENGTH);
    if (value.result !== undefined) return String(value.result).trim().slice(0, MAX_CELL_LENGTH);
    if (value.richText) {
      return value.richText.map((part) => part.text || '').join('').trim().slice(0, MAX_CELL_LENGTH);
    }
    return String(value).trim().slice(0, MAX_CELL_LENGTH);
  }
  return String(value).trim().slice(0, MAX_CELL_LENGTH);
}

function parseYieldPercent(value) {
  let text = normalizeCell(value).replace(/%/g, '').replace(/\s+/g, '');
  if (!text) return NaN;

  const commaCount = (text.match(/,/g) || []).length;
  const hasDot = text.includes('.');

  if (commaCount > 0 && !hasDot) {
    const [, decimalPart = ''] = text.split(',');
    text = commaCount === 1 && decimalPart.length > 0 && decimalPart.length <= 2
      ? text.replace(',', '.')
      : text.replace(/,/g, '');
  } else if (commaCount > 0) {
    text = text.replace(/,/g, '');
  }

  return Number.parseFloat(text);
}

function rowsFromWorksheet(worksheet) {
  const rows = [];
  const headerRow = worksheet.getRow(1);
  const headers = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = normalizeCell(cell.value);
  });

  if (!headers.some(Boolean)) {
    return rows;
  }

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = {};
    headers.forEach((header, colNumber) => {
      if (!header) return;
      item[header] = normalizeCell(row.getCell(colNumber).value);
    });
    if (Object.values(item).some(Boolean)) rows.push(item);
  });

  return rows;
}

export async function parseImportRows(buffer, extension) {
  const workbook = new ExcelJS.Workbook();

  if (extension === '.csv') {
    await workbook.csv.read(Readable.from([buffer]));
    const worksheet = workbook.worksheets[0];
    return worksheet ? rowsFromWorksheet(worksheet) : [];
  }

  if (extension === '.xlsx') {
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    return rowsFromWorksheet(worksheet);
  }

  throw new Error('Unsupported file type. Please upload a .csv or .xlsx file.');
}

export function normalizeYieldRows(data, sourceName) {
  const rows = [];
  const skippedRows = [];

  data.forEach((row, idx) => {
    const species = normalizeCell(row['Common name'] || row['Common Name'] || row.Species || row.Name);
    const yieldRaw = row['% Yield'] ?? row['Yield (%)'] ?? row.Yield;
    const product = normalizeCell(row.Product || 'General') || 'General';
    const source = normalizeCell(row.Source || row.source || sourceName || 'Uploaded File') || 'Uploaded File';

    if (!species || yieldRaw === undefined || yieldRaw === null || yieldRaw === '') {
      skippedRows.push(idx + 2);
      return;
    }

    let finalYield = parseYieldPercent(yieldRaw);
    if (Number.isNaN(finalYield)) {
      skippedRows.push(idx + 2);
      return;
    }

    if (finalYield > 0 && finalYield <= 1) {
      finalYield *= 100;
    }

    if (finalYield < 0 || finalYield > 100) {
      skippedRows.push(idx + 2);
      return;
    }

    rows.push({ species, product, yield: finalYield, source });
  });

  return { rows, skippedRows };
}
