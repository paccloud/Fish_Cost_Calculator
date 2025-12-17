# Vercel Deployment Guide with Neon PostgreSQL

This guide will help you deploy Local Catch to Vercel with Neon PostgreSQL authentication.

## Prerequisites

- [x] Neon account (you mentioned you have one)
- [ ] Vercel account (free Hobby plan)
- [ ] GitHub repository

## Step 1: Neon Database Setup

### 1.1 Create Database Schema

1. Log into your Neon account at https://neon.tech
2. Create a new project or use existing one
3. Open the SQL Editor
4. Run the schema from `scripts/neon-schema.sql`

```sql
-- Copy and paste the entire contents of scripts/neon-schema.sql
```

5. **Save your connection string** - it looks like:
   ```
   postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### 1.2 Migrate Existing Data from SQLite

1. Export data from SQLite:

```bash
cd server
sqlite3 fish_app.db ".mode csv" ".headers on" ".output users_export.csv" "SELECT * FROM users;"
sqlite3 fish_app.db ".mode csv" ".headers on" ".output calculations_export.csv" "SELECT * FROM calculations;"
sqlite3 fish_app.db ".mode csv" ".headers on" ".output user_data_export.csv" "SELECT * FROM user_data;"
sqlite3 fish_app.db ".mode csv" ".headers on" ".output contributors_export.csv" "SELECT * FROM contributors;"
```

2. Import to Neon using SQL Editor or psql:

```sql
-- Upload each CSV file through Neon's SQL Editor or use psql
\copy users(id, username, password, role) FROM 'users_export.csv' WITH CSV HEADER;
\copy calculations(id, user_id, name, species, product, cost, yield, result, date) FROM 'calculations_export.csv' WITH CSV HEADER;
\copy user_data(id, user_id, species, product, yield, source) FROM 'user_data_export.csv' WITH CSV HEADER;
\copy contributors(id, user_id, display_name, organization, bio, show_on_page, created_at, updated_at) FROM 'contributors_export.csv' WITH CSV HEADER;

-- Reset sequences to avoid ID conflicts
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
SELECT setval('calculations_id_seq', (SELECT MAX(id) FROM calculations));
SELECT setval('user_data_id_seq', (SELECT MAX(id) FROM user_data));
SELECT setval('contributors_id_seq', (SELECT MAX(id) FROM contributors));
```

---

## Step 2: Generate JWT Secret

Run this command to generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Save this value - you'll need it for environment variables.

---

## Step 3: Push to GitHub

1. Create a new GitHub repository or use existing one
2. Commit all changes:

```bash
git add .
git commit -m "Add Vercel deployment configuration with Neon"
git push origin main
```

---

## Step 4: Deploy to Vercel

### 4.1 Connect Repository

1. Go to https://vercel.com
2. Click "Add New Project"
3. Import your GitHub repository
4. Vercel will auto-detect the configuration from `vercel.json`

### 4.2 Configure Environment Variables

Before deploying, add these environment variables in Vercel:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | Your Neon connection string | From Step 1.1 |
| `JWT_SECRET` | Your generated secret | From Step 2 (required; API fails fast if missing) |
| `ALLOWED_ORIGINS` | Comma-separated allowlist (e.g. `https://your-app.vercel.app,http://localhost:5173`) | Required for CORS |
| `CORS_ALLOW_CREDENTIALS` | `true` or `false` | Only enable when you need cookies across origins |
| `JWT_EXPIRES_IN_SECONDS` | Optional, default `86400` | JWT lifetime (same value should be used locally) |

**How to add:**
1. In Vercel project settings → Environment Variables
2. Add each variable for "Production" environment
3. Optionally add for "Preview" environments too

### 4.3 Deploy

Click "Deploy" and Vercel will:
- Install dependencies (root + app)
- Build the frontend (`app/dist`)
- Deploy serverless functions (`api/`)

---

## Step 5: Verify Deployment

### 5.1 Test Public Endpoints

1. Visit your Vercel URL: `https://your-app.vercel.app`
2. Test public pages:
   - Home (calculator) - works without login
   - Data Sources page - should load contributors
   - About page

### 5.2 Test Authentication

1. Register a new account
2. Login
3. Try:
   - Saving a calculation
   - Adding custom yield data
   - Uploading Excel file (under 4MB for Hobby plan)
   - Exporting data

### 5.3 Check API Logs

In Vercel Dashboard → Functions → View logs for any errors

---

## Step 6: Post-Deployment

### Update Frontend URL (Optional)

If you want to restrict CORS in production, set `ALLOWED_ORIGINS` to your live + preview URLs (for example `https://your-app.vercel.app,https://your-app-git-preview.vercel.app`). No code changes are required.

---

## Local Development After Deployment

### Option 1: Continue using SQLite for local dev

Keep the old `server/server.js` for local development:

```bash
# Terminal 1 - Old backend
cd server && node server.js

# Terminal 2 - Frontend
cd app && npm run dev
```

### Option 2: Test Neon locally

Create `.env.local` in project root:

```
DATABASE_URL=postgresql://user:pass@host.neon.tech/db?sslmode=require
JWT_SECRET=your-dev-secret
```

Then use Vercel CLI to test serverless functions locally:

```bash
npm install -g vercel
vercel dev
```

This will:
- Run serverless functions on http://localhost:3000
- Run frontend on http://localhost:5173
- Hot reload both

---

## Troubleshooting

### "Database connection failed"

- Check `DATABASE_URL` in Vercel environment variables
- Ensure connection string includes `?sslmode=require`
- Verify Neon project is running (not hibernated)

### "JWT verification failed"

- Ensure `JWT_SECRET` is set in Vercel
- Check that it's the same value used when tokens were created

### "File upload fails"

- Vercel Hobby plan has 4.5MB request limit
- Check file size in frontend before upload
- Consider upgrading to Pro if needed

### "CORS errors"

- Check browser console for specific error
- Verify `ALLOWED_ORIGINS` includes your current origin
- Test with public endpoints first (`/api/contributors`)

### Cold starts are slow

- Normal for serverless on first request
- Neon serverless driver is optimized for this
- Consider Vercel Pro for faster cold starts

---

## File Upload Limits

| Plan | Request Body Limit | Function Timeout |
|------|-------------------|------------------|
| Hobby (Free) | 4.5 MB | 10 seconds |
| Pro | 50 MB | 60 seconds |

Current configuration: `api/upload-data.js` limits files to 4MB (safe for Hobby).

To increase for Pro plan, edit `api/upload-data.js`:

```javascript
const form = formidable({
  maxFileSize: 50 * 1024 * 1024, // 50MB for Pro
  // ...
});
```

---

## Architecture Overview

```
Production:
┌─────────────────────────────────────┐
│   Vercel (your-app.vercel.app)      │
├─────────────────────────────────────┤
│  Frontend (app/dist)                │
│  - React 19 + Vite                  │
│  - Served as static files           │
├─────────────────────────────────────┤
│  API (api/*.js)                     │
│  - Serverless Functions             │
│  - Node.js 18+                      │
│  - Auto-scales                      │
└─────────────┬───────────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │  Neon PostgreSQL    │
    │  - Always-on        │
    │  - Auto-scaling     │
    └─────────────────────┘
```

---

## Next Steps

- [ ] Custom domain (optional) - Vercel supports free custom domains
- [ ] Add monitoring - Vercel provides basic analytics
- [ ] Set up staging environment - Use Vercel preview deployments
- [ ] Add database backups - Neon provides automated backups

---

## Support

- Vercel Docs: https://vercel.com/docs
- Neon Docs: https://neon.tech/docs
- Project Issues: [Your GitHub repo]/issues
