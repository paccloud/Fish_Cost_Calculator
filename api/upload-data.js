import formidable from 'formidable';
import * as xlsx from 'xlsx';
import { promises as fs } from 'fs';
import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';

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

    // Read file buffer
    const buffer = await fs.readFile(file.filepath);

    // Parse Excel/CSV file
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    let count = 0;

    // Process each row
    for (const row of data) {
      // Heuristic column mapping (same as original)
      const species = row['Common name'] || row['Species'] || row['Name'];
      let yieldVal = row['% Yield'] || row['Yield'];
      const product = row['Product'] || 'General';

      if (species && yieldVal !== undefined && yieldVal !== null) {
        // Convert decimal to percentage if needed
        if (yieldVal < 1) {
          yieldVal = yieldVal * 100;
        }

        await query(
          'INSERT INTO user_data (user_id, species, product, yield, source) VALUES ($1, $2, $3, $4, $5)',
          [userId, species, product, yieldVal, file.originalFilename || 'Uploaded File']
        );
        count++;
      }
    }

    // Clean up temp file
    await fs.unlink(file.filepath).catch(() => {});

    return res.status(200).json({ message: `Imported ${count} records successfully` });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message || 'Failed to process file' });
  }
}

export default handleCors(requireAuth(handler));
