import formidable from 'formidable';
import { promises as fs } from 'fs';
import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import {
  assertAllowedImportFile,
  normalizeYieldRows,
  parseImportRows,
  upsertImportedYieldRows,
} from './_lib/importRows.js';

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

    const { inserted, updated } = await upsertImportedYieldRows(userId, rows, query);

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
    const message = status === 400
      ? err.message
      : 'Failed to process file. Ensure it is a valid spreadsheet.';
    return res.status(status).json({ error: message });
  } finally {
    if (uploadedFilePath) await fs.unlink(uploadedFilePath).catch(() => {});
  }
}

export default handleCors(requireAuth(handler));
