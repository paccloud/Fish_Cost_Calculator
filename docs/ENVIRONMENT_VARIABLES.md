# Environment Variables Configuration

This document explains how to properly configure environment variables for the Local Catch application.

## Important: No Quotes in .env Files

When setting environment variables in `.env` files, **do NOT use quotes** around the values unless the quotes are part of the actual value. Vite will include quotes as part of the value if you add them.

### ❌ Wrong (with quotes)
```bash
VITE_STACK_PROJECT_ID='a55799cf-aec1-4699-94ce-fb42094552d9'
VITE_STACK_PUBLISHABLE_CLIENT_KEY='pck_cn8y47v9g8029134473btakf840y8feyar4jnkmjq2268'
```

### ✅ Correct (without quotes)
```bash
VITE_STACK_PROJECT_ID=a55799cf-aec1-4699-94ce-fb42094552d9
VITE_STACK_PUBLISHABLE_CLIENT_KEY=pck_cn8y47v9g8029134473btakf840y8feyar4jnkmjq2268
```

## Vercel Environment Variables

When adding environment variables to Vercel (either via dashboard or CLI), ensure they are added without quotes:

```bash
# Using printf to avoid quotes
printf 'your-value-here' | vercel env add VARIABLE_NAME production
```

## Required Environment Variables

### Frontend (Vite) - Client-side
These are bundled into the client code and exposed to the browser:
- `VITE_STACK_PROJECT_ID` - Stack Auth project ID
- `VITE_STACK_PUBLISHABLE_CLIENT_KEY` - Stack Auth public key
- `VITE_API_URL` - API base URL (empty for production, http://localhost:3000 for dev)
- `VITE_GEMINI_API_KEY` - **Required**; Gemini API key used for Gemini integration and **bundled into client code (exposed to the browser)** (e.g. `AIza...`)
- `VITE_OCR_ENDPOINT` - **Optional**; custom OCR backend endpoint URL (default: use the app's built-in OCR flow/config if unset; e.g. `http://localhost:3000/api/ocr`)

### Backend (Vercel Functions) - Server-side only

These are only accessible on the server:

- `STACK_PROJECT_ID` - Stack Auth project ID (server-side)
- `STACK_SECRET_SERVER_KEY` - Stack Auth secret key (**NEVER expose to client**)
- `JWT_SECRET` - Secret for signing JWT tokens (required; API/server will fail fast if missing)
- `JWT_EXPIRES_IN_SECONDS` - Optional; JWT lifetime in seconds (default 86400 / 24h)
- `DATABASE_URL` - PostgreSQL connection string
- All `POSTGRES_*` and `PG*` variables from Neon
- `GEMINI_API_KEY` - **MUST be server-side only** (no `VITE_` prefix); Gemini API key for AI features (e.g., spreadsheet parsing). **NEVER expose to client code**. All Gemini API calls must be routed through server endpoints (e.g., `/api/parse-spreadsheet`) - the browser should never have direct access to this key.

Mitigations / security guidance:

- **Client-side keys are not secrets**: anything prefixed with `VITE_` is shipped to browsers. Treat `VITE_GEMINI_API_KEY` as public.
- **Prefer server-side proxying** for privileged features: use `GEMINI_API_KEY` only in server routes/functions and enforce auth/authorization there.
- **Rate-limit Gemini-backed endpoints** to reduce abuse and cost exposure.
- **Restrict keys in Google Cloud**: apply API restrictions (enable only the needed APIs), lock down allowed origins/referrers for browser keys (for `VITE_GEMINI_API_KEY`), and restrict server keys by IP/service account where possible.
- **Scope and rotate keys**: use least-privilege API restrictions and rotate keys if exposure is suspected.

## Common Issues

### "Invalid project ID" Error
If you see an error like "Invalid project ID: ... Project IDs must be UUIDs", this usually means:
1. The environment variable has quotes around it
2. The environment variable wasn't set correctly in Vercel
3. The build needs to be redeployed after fixing the variables

**Solution**: Remove quotes from all environment variables and redeploy.

### Authentication 401 Errors
If you get 401 Unauthorized errors when logged in with OAuth:
1. Check that `VITE_STACK_PROJECT_ID` and `VITE_STACK_PUBLISHABLE_CLIENT_KEY` are set in Vercel
2. Verify they don't have quotes around them
3. Redeploy the application

## Local Development Setup

1. Copy `.env.example` to `.env.development`:
   ```bash
   cp app/.env.example app/.env.development
   ```

2. Fill in your values **without quotes**:
   ```bash
   VITE_API_URL=http://localhost:3000
   VITE_STACK_PROJECT_ID=your-project-id-here
   VITE_STACK_PUBLISHABLE_CLIENT_KEY=your-key-here
   DATABASE_URL=your-connection-string-here
   ```

3. Never commit `.env`, `.env.development`, or `.env.production` files - they're gitignored for security.

4. For the local Express server (`server/server.js`), create `server/.env` (or `.env.local`) with `JWT_SECRET` and `ALLOWED_ORIGINS` that match your dev URLs. See `server/.env.example` for defaults.

## Production Deployment

Environment variables for production are managed in Vercel:
1. Go to Vercel dashboard → Project Settings → Environment Variables
2. Add variables without quotes
3. Select appropriate environments (Production, Preview, Development)
4. Redeploy to apply changes
