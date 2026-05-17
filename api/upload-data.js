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
    const sourceName = file.originalFilename || 'Uploaded File';

    // Read and parse the upload with non-SheetJS parsers. SheetJS xlsx was removed
    // because npm audit reports unfixed prototype-pollution/ReDoS advisories.
    const buffer = await fs.readFile(file.filepath);
    const data = await parseImportRows(buffer, extension);
    const { rows, skippedRows } = normalizeYieldRows(data, sourceName);

    let count = 0;
    for (const row of rows) {
      await query(
        'INSERT INTO user_data (user_id, species, product, yield, source) VALUES ($1, $2, $3, $4, $5)',
        [userId, row.species, row.product, row.yield, row.source]
      );
      count++;
    }

    return res.status(200).json({
      message: `Imported ${count} records successfully`,
      imported: count,
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
