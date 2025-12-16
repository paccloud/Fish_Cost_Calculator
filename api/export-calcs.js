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
      'SELECT * FROM calculations WHERE user_id = $1 ORDER BY date DESC',
      [userId]
    );

    // Build CSV content
    const csvHeader = 'Date,Species,Conversion,Cost,Yield (%),Result\n';
    const csvRows = result.rows.map(calc => {
      const date = new Date(calc.date).toLocaleString();
      return `"${date}","${calc.species}","${calc.product}",${calc.cost},${calc.yield},${calc.result}`;
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    // Set CSV headers
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=calculations.csv');

    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('Export calculations error:', err);
    return res.status(500).json({ error: 'Failed to export calculations' });
  }
}

export default handleCors(requireAuth(handler));
