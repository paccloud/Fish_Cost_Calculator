import { query } from './_lib/db.js';
import { handleCors } from './_lib/cors.js';

const CSV_FORMULA_PREFIX = /^[=+\-@]/;
function sanitizeCsvValue(value) {
  const s = value === null || value === undefined ? '' : String(value);
  const escaped = s.replace(/"/g, '""');
  return CSV_FORMULA_PREFIX.test(escaped.trimStart()) ? `'${escaped}` : escaped;
}

const DATA_QUERY = `
  SELECT ud.id, ud.species, ud.product, ud.yield, ud.source,
         COALESCE(c.display_name, u.username) AS contributor,
         c.organization
  FROM user_data ud
  JOIN users u ON ud.user_id = u.id
  LEFT JOIN contributors c ON ud.user_id = c.user_id
  WHERE ud.is_shared = true
  ORDER BY ud.species ASC, ud.product ASC
`;

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await query(DATA_QUERY, []);

    // ?format=csv — return downloadable CSV
    if (req.query.format === 'csv') {
      const header = 'Species,Product,Yield (%),Source,Contributor,Organization\n';
      const rows = result.rows.map(r =>
        `"${sanitizeCsvValue(r.species)}","${sanitizeCsvValue(r.product)}","${sanitizeCsvValue(r.yield)}","${sanitizeCsvValue(r.source || '')}","${sanitizeCsvValue(r.contributor || '')}","${sanitizeCsvValue(r.organization || '')}"`
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="community-yield-data.csv"');
      return res.status(200).send(header + rows);
    }

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('[community-data] error:', err);
    return res.status(500).json({ error: 'Failed to load community data' });
  }
}

export default handleCors(handler);
