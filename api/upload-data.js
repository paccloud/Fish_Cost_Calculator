import formidable from 'formidable';
import { promises as fs } from 'fs';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import {
  assertAllowedImportFile,
  normalizeYieldRows,
  parseImportRows,
} from './_lib/importRows.js';
import { makeNeonAdapter } from './_lib/neonDb.js';
import { handleUploadUserDataRows } from '../shared/handlers/index.js';

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

    const { status, body } = await handleUploadUserDataRows({
      userId,
      rows,
      skippedRows,
    }, makeNeonAdapter());

    return res.status(status).json(body);
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
