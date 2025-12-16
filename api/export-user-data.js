import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;

  try {
    const result = await query(
      'SELECT * FROM user_data WHERE user_id = $1',
      [userId]
    );

    // Build CSV content
    const csvHeader = 'Species,Product,Yield (%),Source\n';
    const csvRows = result.rows.map(data => {
      return `"${data.species}","${data.product}",${data.yield},"${data.source || ''}"`;
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    // Set CSV headers
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=user_data.csv');

    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('Export user data error:', err);
    return res.status(500).json({ error: 'Failed to export user data' });
  }
}

export default handleCors(requireAuth(handler));
