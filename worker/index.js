import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAuth } from './auth.js';
import { authMiddleware } from './middleware.js';
import { FISH_DATA, PROFILES_DATA, DATA_SOURCE } from '../app/src/data/fish_data_v3.js';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = new Hono();

// ---------------------------------------------------------------------------
// CORS — allow origins listed in the ALLOWED_ORIGINS env var
// ---------------------------------------------------------------------------
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowed = (c.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
  })
);

// ---------------------------------------------------------------------------
// Better Auth catch-all  (must come before other /api/auth/* routes)
// ---------------------------------------------------------------------------
app.all('/api/auth/*', async (c) => {
  const auth = createAuth(c.env.DB, c.env, c.req.raw);
  return auth.handler(c.req.raw);
});

// ---------------------------------------------------------------------------
// Public routes (no auth required)
// ---------------------------------------------------------------------------

// GET /api/public-calcs
app.get('/api/public-calcs', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT id, species, product, cost, yield, result, date
       FROM calculations
       ORDER BY date DESC
       LIMIT 100`
    ).all();

    return c.json(results);
  } catch (err) {
    console.error('Fetch public calculations error:', err);
    return c.json({ error: 'Failed to fetch calculations' }, 500);
  }
});

// GET /api/contributors
app.get('/api/contributors', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT c.id, c.display_name, c.organization, c.bio, c.show_on_page, c.created_at,
              u.name as username,
              (SELECT COUNT(*) FROM user_data WHERE user_id = c.user_id) +
              (SELECT COUNT(*) FROM calculations WHERE user_id = c.user_id) AS contribution_count
       FROM contributors c
       JOIN user u ON u.id = c.user_id
       WHERE c.show_on_page = 1
       ORDER BY contribution_count DESC`
    ).all();

    return c.json(results);
  } catch (err) {
    console.error('Fetch contributors error:', err);
    return c.json({ error: 'Failed to fetch contributors' }, 500);
  }
});

// GET /api/fish-data — return static fish data bundled from fish_data_v3.js
app.get('/api/fish-data', (c) => {
  return c.json({
    fishData: FISH_DATA,
    profiles: PROFILES_DATA,
    source: DATA_SOURCE,
  });
});

// ---------------------------------------------------------------------------
// Protected routes (require authenticated session)
// ---------------------------------------------------------------------------
const protectedApi = new Hono();
protectedApi.use('*', authMiddleware());

// GET /api/saved-calcs
protectedApi.get('/saved-calcs', async (c) => {
  const userId = c.get('user').id;
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM calculations WHERE user_id = ? ORDER BY date DESC'
    )
      .bind(userId)
      .all();

    return c.json(results);
  } catch (err) {
    console.error('Fetch calculations error:', err);
    return c.json({ error: 'Failed to fetch calculations' }, 500);
  }
});

// POST /api/save-calc
protectedApi.post('/save-calc', async (c) => {
  const userId = c.get('user').id;
  const { name, species, product, cost, yield: yieldVal, result } = await c.req.json();

  if (!species || !product || cost == null || yieldVal == null || result == null) {
    return c.json({ error: 'Missing required fields: species, product, cost, yield, result' }, 400);
  }

  try {
    const info = await c.env.DB.prepare(
      `INSERT INTO calculations (user_id, name, species, product, cost, yield, result)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(userId, name, species, product, cost, yieldVal, result)
      .run();

    return c.json(
      { id: info.meta.last_row_id, message: 'Calculation saved successfully' },
      201
    );
  } catch (err) {
    console.error('Save calculation error:', err);
    return c.json({ error: 'Failed to save calculation' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Export (CSV)
// ---------------------------------------------------------------------------
const CSV_FORMULA_PREFIX = /^[=+\-@]/;
function sanitizeCsvValue(value) {
  const str = value === null || value === undefined ? '' : String(value);
  const escaped = str.replace(/"/g, '""');
  return CSV_FORMULA_PREFIX.test(escaped.trimStart()) ? `'${escaped}` : escaped;
}

protectedApi.get('/export', async (c) => {
  const userId = c.get('user').id;
  const exportType = c.req.query('type') || 'calcs';

  try {
    if (exportType === 'data') {
      const { results } = await c.env.DB.prepare(
        'SELECT * FROM user_data WHERE user_id = ?'
      )
        .bind(userId)
        .all();

      const header = 'Species,Product,Yield (%),Source\n';
      const rows = results
        .map((d) => {
          const vals = [
            sanitizeCsvValue(d.species),
            sanitizeCsvValue(d.product),
            sanitizeCsvValue(d.yield),
            sanitizeCsvValue(d.source || ''),
          ];
          return `"${vals.join('","')}"`;
        })
        .join('\n');

      return new Response(header + rows, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=user_data.csv',
        },
      });
    }

    // Default: export calculations
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM calculations WHERE user_id = ? ORDER BY date DESC'
    )
      .bind(userId)
      .all();

    const header = 'Date,Species,Conversion,Cost,Yield (%),Result\n';
    const rows = results
      .map((calc) => {
        const date = sanitizeCsvValue(
          new Date(calc.date).toLocaleString()
        );
        const vals = [
          date,
          sanitizeCsvValue(calc.species),
          sanitizeCsvValue(calc.product),
          sanitizeCsvValue(calc.cost),
          sanitizeCsvValue(calc.yield),
          sanitizeCsvValue(calc.result),
        ];
        return `"${vals.join('","')}"`;
      })
      .join('\n');

    return new Response(header + rows, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=calculations.csv',
      },
    });
  } catch (err) {
    console.error('Export error:', err);
    return c.json({ error: 'Failed to export data' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Contributor profile
// ---------------------------------------------------------------------------
protectedApi.get('/contributor', async (c) => {
  const userId = c.get('user').id;
  try {
    const row = await c.env.DB.prepare(
      'SELECT * FROM contributors WHERE user_id = ?'
    )
      .bind(userId)
      .first();

    if (!row) {
      return c.json({ error: 'Profile not found' }, 404);
    }
    return c.json(row);
  } catch (err) {
    console.error('Fetch contributor profile error:', err);
    return c.json({ error: 'Failed to fetch profile' }, 500);
  }
});

protectedApi.post('/contributor', async (c) => {
  const userId = c.get('user').id;
  const { display_name, organization, bio, show_on_page } = await c.req.json();
  const showFlag =
    show_on_page === true || show_on_page === 'true' || show_on_page === 1
      ? 1
      : 0;

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM contributors WHERE user_id = ?'
    )
      .bind(userId)
      .first();

    if (existing) {
      await c.env.DB.prepare(
        `UPDATE contributors
         SET display_name = ?, organization = ?, bio = ?, show_on_page = ?,
             updated_at = datetime('now')
         WHERE user_id = ?`
      )
        .bind(display_name, organization, bio, showFlag, userId)
        .run();

      return c.json({ message: 'Profile updated successfully' });
    }

    const info = await c.env.DB.prepare(
      `INSERT INTO contributors (user_id, display_name, organization, bio, show_on_page)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, display_name, organization, bio, showFlag)
      .run();

    return c.json(
      { id: info.meta.last_row_id, message: 'Profile created successfully' },
      201
    );
  } catch (err) {
    console.error('Save contributor profile error:', err);
    return c.json({ error: 'Failed to save profile' }, 500);
  }
});

// ---------------------------------------------------------------------------
// User data CRUD
// ---------------------------------------------------------------------------
protectedApi.get('/user-data', async (c) => {
  const userId = c.get('user').id;
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, species, product, yield, source FROM user_data WHERE user_id = ?'
    )
      .bind(userId)
      .all();

    return c.json(results);
  } catch (err) {
    console.error('Fetch user data error:', err);
    return c.json({ error: 'Failed to fetch user data' }, 500);
  }
});

protectedApi.post('/user-data', async (c) => {
  const userId = c.get('user').id;
  const { species, product, yield: yieldVal, source = 'User Input' } = await c.req.json();

  if (!species || !product || yieldVal === undefined) {
    return c.json({ error: 'Species, product, and yield are required' }, 400);
  }

  try {
    const info = await c.env.DB.prepare(
      'INSERT INTO user_data (user_id, species, product, yield, source) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(userId, species, product, yieldVal, source)
      .run();

    return c.json(
      { id: info.meta.last_row_id, message: 'Data added successfully' },
      201
    );
  } catch (err) {
    console.error('Add user data error:', err);
    return c.json({ error: 'Failed to add data' }, 500);
  }
});

protectedApi.put('/user-data/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const { species, product, yield: yieldVal, source } = await c.req.json();

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM user_data WHERE id = ? AND user_id = ?'
    )
      .bind(id, userId)
      .first();

    if (!existing) {
      return c.json({ error: 'Entry not found or not owned by user' }, 404);
    }

    await c.env.DB.prepare(
      `UPDATE user_data
       SET species = COALESCE(?, species),
           product = COALESCE(?, product),
           yield = COALESCE(?, yield),
           source = COALESCE(?, source)
       WHERE id = ? AND user_id = ?`
    )
      .bind(species, product, yieldVal, source, id, userId)
      .run();

    return c.json({ message: 'Updated successfully' });
  } catch (err) {
    console.error('Update user data error:', err);
    return c.json({ error: 'Failed to update data' }, 500);
  }
});

protectedApi.delete('/user-data/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM user_data WHERE id = ? AND user_id = ?'
    )
      .bind(id, userId)
      .first();

    if (!existing) {
      return c.json({ error: 'Entry not found or not owned by user' }, 404);
    }

    await c.env.DB.prepare(
      'DELETE FROM user_data WHERE id = ? AND user_id = ?'
    )
      .bind(id, userId)
      .run();

    return c.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('Delete user data error:', err);
    return c.json({ error: 'Failed to delete data' }, 500);
  }
});

// ---------------------------------------------------------------------------
// File upload (Excel / CSV)
// ---------------------------------------------------------------------------
protectedApi.post('/upload-data', async (c) => {
  const userId = c.get('user').id;

  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded' }, 400);
    }

    const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: 'File too large. Maximum size is 4MB.' }, 400);
    }

    // Try dynamic import of xlsx — may not be available in Workers runtime
    let data;
    let xlsx;
    try {
      xlsx = await import('xlsx');
    } catch (_e) {
      // xlsx not available in Workers runtime — CSV only
      xlsx = null;
    }

    if (xlsx) {
      const buffer = await file.arrayBuffer();
      const workbook = xlsx.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      data = xlsx.utils.sheet_to_json(sheet);
    } else {
      // Fallback: CSV-only parsing
      if (!file.name?.endsWith('.csv')) {
        return c.json(
          { error: 'Only CSV files are supported in this environment. Excel support coming soon.' },
          400
        );
      }
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        return c.json({ error: 'CSV file is empty or has no data rows' }, 400);
      }
      const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
      data = lines.slice(1).map((line) => {
        const values = line.split(',').map((v) => v.replace(/^"|"$/g, '').trim());
        const row = {};
        headers.forEach((h, i) => {
          row[h] = values[i] || '';
        });
        return row;
      });
    }

    let count = 0;
    for (const row of data) {
      const species = row['Common name'] || row['Species'] || row['Name'];
      let yieldVal = row['% Yield'] || row['Yield'];
      const product = row['Product'] || 'General';

      if (species && yieldVal !== undefined && yieldVal !== null) {
        if (yieldVal < 1) {
          yieldVal = yieldVal * 100;
        }

        await c.env.DB.prepare(
          'INSERT INTO user_data (user_id, species, product, yield, source) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(userId, species, product, yieldVal, file.name || 'Uploaded File')
          .run();
        count++;
      }
    }

    return c.json({ message: `Imported ${count} records successfully` });
  } catch (err) {
    console.error('Upload error:', err);
    return c.json({ error: err.message || 'Failed to process file' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Mount protected routes under /api
// ---------------------------------------------------------------------------
app.route('/api', protectedApi);

// ---------------------------------------------------------------------------
// Export Hono app as the default Worker entry
// ---------------------------------------------------------------------------
export default app;
