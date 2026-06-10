import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';

const CSV_FORMULA_PREFIX = /^[=+\-@]/;
const sanitizeCsvValue = (value) => {
  const stringValue = value === null || value === undefined ? '' : String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return CSV_FORMULA_PREFIX.test(escaped.trimStart()) ? `'${escaped}` : escaped;
};

/**
 * Consolidated export endpoint
 * GET /api/export?type=calcs - Export calculations
 * GET /api/export?type=data - Export user data
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;
  const exportType = req.query?.type || 'calcs';

  try {
    if (exportType === 'data') {
      // Export user data
      const result = await query(
        'SELECT * FROM user_data WHERE user_id = $1',
        [userId]
      );

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

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=user_data.csv');
      return res.status(200).send(csvHeader + csvRows);

    } else {
      // Export calculations (default)
      const result = await query(
        'SELECT * FROM calculations WHERE user_id = $1 ORDER BY date DESC',
        [userId]
      );

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

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=calculations.csv');
      return res.status(200).send(csvHeader + csvRows);
    }
  } catch (err) {
    console.error('Export error:', err);
    return res.status(500).json({ error: 'Failed to export data' });
  }
}

export default handleCors(requireAuth(handler));
