/**
 * POST /api/upload-data — upload a CSV or XLSX file of yield data.
 *
 * File parsing (formidable multipart, ExcelJS byte parsing) is adapter-side.
 * The importRows helpers in api/_lib/importRows.js parse the buffer and
 * normalise rows; the shared handleUploadData handler owns the upsert logic.
 *
 * @module api/upload-data
 */

import formidable from 'formidable';
import { promises as fs } from 'fs';
import { makeNeonAdapter } from './_lib/neonDb.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { assertAllowedImportFile, normalizeYieldRows, parseImportRows } from './_lib/importRows.js';
import { handleUploadData } from '../shared/handlers/index.js';

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
    // Parse multipart form (adapter-side — formidable delivers a temp file)
    const [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, parsedFiles) => {
        if (err) reject(err);
        else resolve([fields, parsedFiles]);
      });
    });

    const file = files.file?.[0];
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    uploadedFilePath = file.filepath;

    // Adapter-side: parse the file into normalised rows
    const extension = assertAllowedImportFile(file);
    const buffer = await fs.readFile(file.filepath);
    const data = await parseImportRows(buffer, extension);
    const { rows, skippedRows } = normalizeYieldRows(data, 'Uploaded File');

    // Hand off to the handler core for the upsert logic
    const db = makeNeonAdapter();
    const { status, body } = await handleUploadData({ userId, rows, skippedRows }, db);
    return res.status(status).json(body);
  } catch (err) {
    console.error('Upload error:', err);
    const status = /unsupported file|parse csv|no valid/i.test(err.message || '') ? 400 : 500;
    return res.status(status).json({ error: err.message || 'Failed to process file' });
  } finally {
    if (uploadedFilePath) await fs.unlink(uploadedFilePath).catch(() => {});
  }
}

export default handleCors(requireAuth(handler));
