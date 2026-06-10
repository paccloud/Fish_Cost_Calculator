import formidable from 'formidable';
import { promises as fs } from 'fs';
import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { assertAllowedImportFile, normalizeYieldRows, parseImportRows } from './_lib/importRows.js';

// Disable default body parser for multipart form data
export const config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;

  // Create form parser with 4MB limit (safe for Vercel Hobby plan)
  const form = formidable({
    maxFileSize: 4 * 1024 * 1024, // 4MB
    keepExtensions: true,
  });

  let uploadedFilePath;

  try {
    // Parse multipart form
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    const file = files.file?.[0];
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    uploadedFilePath = file.filepath;

    const extension = assertAllowedImportFile(file);
    const buffer = await fs.readFile(file.filepath);
    const data = await parseImportRows(buffer, extension);
    const { rows, skippedRows } = normalizeYieldRows(data, 'Uploaded File');

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const existing = await query(
        'SELECT id FROM user_data WHERE user_id = $1 AND LOWER(species) = LOWER($2) AND LOWER(product) = LOWER($3) LIMIT 1',
        [userId, row.species, row.product]
      );

      if (existing.rows?.[0]) {
        await query(
          'UPDATE user_data SET yield = $1, source = $2 WHERE id = $3 AND user_id = $4',
          [row.yield, row.source, existing.rows[0].id, userId]
        );
        updated++;
      } else {
        await query(
          'INSERT INTO user_data (user_id, species, product, yield, source) VALUES ($1, $2, $3, $4, $5)',
          [userId, row.species, row.product, row.yield, row.source]
        );
        inserted++;
      }
    }

    const parts = [];
    if (inserted > 0) parts.push(`${inserted} added`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (skippedRows.length > 0) parts.push(`${skippedRows.length} skipped`);

    return res.status(200).json({
      message: parts.length ? parts.join(', ') : 'No valid records found',
      inserted,
      updated,
      skipped: skippedRows.length,
      skippedRows,
    });
  } catch (err) {
    console.error('Upload error:', err);
    const status = /unsupported file|parse csv|no valid/i.test(err.message || '') ? 400 : 500;
    return res.status(status).json({ error: err.message || 'Failed to process file' });
  } finally {
    if (uploadedFilePath) await fs.unlink(uploadedFilePath).catch(() => {});
  }
}

export default handleCors(requireAuth(handler));
