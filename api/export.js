import ExcelJS from 'exceljs';
import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';

const CSV_FORMULA_PREFIX = /^[=+\-@]/;
const sanitizeCsvValue = (value) => {
  const stringValue = value === null || value === undefined ? '' : String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return CSV_FORMULA_PREFIX.test(escaped.trimStart()) ? `'${escaped}` : escaped;
};

function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  return res.status(200).send(header + rows);
}

async function sendXlsx(res, filename, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Export');
  sheet.columns = columns.map(col => ({ header: col.header, key: col.key, width: col.width || 18 }));
  rows.forEach(row => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  return res.status(200).send(Buffer.from(buffer));
}

/**
 * Consolidated export endpoint
 * GET /api/export?type=calcs&format=csv|xlsx - Export calculations
 * GET /api/export?type=data&format=csv|xlsx  - Export user data
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;
  const exportType = req.query?.type || 'calcs';
  const format = req.query?.format || 'csv';

  if (format !== 'csv' && format !== 'xlsx') {
    return res.status(400).json({ error: 'format must be "csv" or "xlsx"' });
  }

  try {
    if (exportType === 'data') {
      const result = await query(
        'SELECT * FROM user_data WHERE user_id = $1',
        [userId]
      );

      if (format === 'xlsx') {
        const columns = [
          { header: 'Species', key: 'species' },
          { header: 'Product', key: 'product' },
          { header: 'Yield (%)', key: 'yield', width: 12 },
          { header: 'Source', key: 'source' },
        ];
        const rows = result.rows.map(d => ({
          species: d.species,
          product: d.product,
          yield: d.yield,
          source: d.source || '',
        }));
        return sendXlsx(res, 'user_data.xlsx', columns, rows);
      }

      const csvHeader = 'Species,Product,Yield (%),Source\n';
      const csvRows = result.rows.map(data => {
        const values = [
          sanitizeCsvValue(data.species),
          sanitizeCsvValue(data.product),
          sanitizeCsvValue(data.yield),
          sanitizeCsvValue(data.source || '')
        ];
        return `"${values.join('","')}"`;
      }).join('\n');
      return sendCsv(res, 'user_data.csv', csvHeader, csvRows);

    } else {
      const result = await query(
        'SELECT * FROM calculations WHERE user_id = $1 ORDER BY date DESC',
        [userId]
      );

      if (format === 'xlsx') {
        const columns = [
          { header: 'Date', key: 'date', width: 22 },
          { header: 'Species', key: 'species' },
          { header: 'Conversion', key: 'conversion' },
          { header: 'Cost', key: 'cost', width: 12 },
          { header: 'Yield (%)', key: 'yield', width: 12 },
          { header: 'Result', key: 'result', width: 14 },
        ];
        const rows = result.rows.map(calc => ({
          date: new Date(calc.date).toLocaleString(),
          species: calc.species,
          conversion: calc.product,
          cost: calc.cost,
          yield: calc.yield,
          result: calc.result,
        }));
        return sendXlsx(res, 'calculations.xlsx', columns, rows);
      }

      const csvHeader = 'Date,Species,Conversion,Cost,Yield (%),Result\n';
      const csvRows = result.rows.map(calc => {
        const date = sanitizeCsvValue(new Date(calc.date).toLocaleString());
        const values = [
          date,
          sanitizeCsvValue(calc.species),
          sanitizeCsvValue(calc.product),
          sanitizeCsvValue(calc.cost),
          sanitizeCsvValue(calc.yield),
          sanitizeCsvValue(calc.result)
        ];
        return `"${values.join('","')}"`;
      }).join('\n');
      return sendCsv(res, 'calculations.csv', csvHeader, csvRows);
    }
  } catch (err) {
    console.error('Export error:', err);
    return res.status(500).json({ error: 'Failed to export data' });
  }
}

export default handleCors(requireAuth(handler));
