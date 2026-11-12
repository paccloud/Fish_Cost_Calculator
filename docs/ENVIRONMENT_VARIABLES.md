# Environment Variables Configuration

This document explains how to properly configure environment variables for the Local Catch application.

> **This stack is being replaced.** The backend variables below belong to the Vercel + Neon API and the local Express server, which [ADR 0001](adr/0001-firebase-auth-and-firestore.md) replaces with Firebase (issues #123–#133). They stay accurate until that work lands.

## Important: No Quotes in .env Files

When setting environment variables in `.env` files, **do NOT use quotes** around the values unless the quotes are part of the actual value. Vite will include quotes as part of the value if you add them.

### ❌ Wrong (with quotes)
```bash
VITE_FIREBASE_PROJECT_ID='local-catch-prod'
VITE_FIREBASE_API_KEY='AIza...'
```

### ✅ Correct (without quotes)
```bash
VITE_FIREBASE_PROJECT_ID=local-catch-prod
VITE_FIREBASE_API_KEY=AIza...
```

## Vercel Environment Variables

When adding environment variables to Vercel (either via dashboard or CLI), ensure they are added without quotes:

```bash
# Using printf to avoid quotes
printf 'your-value-here' | vercel env add VARIABLE_NAME production
```

## Environment Variables

Checked against the code in November 2026. "Read by" names the file that uses the value.

### Frontend (Vite) - Client-side

These are bundled into the client code and exposed to the browser. None of them is a secret.

| Variable | Needed? | Read by | What it is |
|---|---|---|---|
| `VITE_FIREBASE_API_KEY` | **Required** for sign-in | `app/src/lib/firebaseRestAuth.js` | Firebase web app API key (public browser config) |
| `VITE_API_URL` | Optional | `app/src/config/api.js` | API base URL. Empty in production (same origin); `http://localhost:3000` in development |
| `VITE_MOVE_STAGE` | Optional | `app/src/config/move.js` | Stage of the move to Firebase: `off` (default), `notice` or `read-only`. See `docs/move-runbook.md` |
| `VITE_NEW_APP_URL` | Optional | `app/src/config/move.js` | The new app's address, shown in the move banner (e.g. `https://local-catch.web.app`) |

The rest of the Firebase web config is in the env templates but **no code reads it today**, because the app calls Firebase Auth's REST endpoints with the API key alone: `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID` and `VITE_FIREBASE_STORAGE_BUCKET`. `VITE_FIREBASE_PROJECT_ID` is read only by the API, as a last fallback when `FIREBASE_PROJECT_ID` is not set. Setting them does no harm.

### Backend (Vercel Functions) - Server-side only

These are only accessible on the server:

| Variable | Needed? | Read by | What it is |
|---|---|---|---|
| `DATABASE_URL` | **Required** | `api/_lib/db.js`, `scripts/*.js` | Neon PostgreSQL connection string. A secret |
| `FIREBASE_PROJECT_ID` | **Required** | `api/_lib/firebase-auth.js` | Firebase project ID used to verify Firebase Auth ID tokens |
| `ALLOWED_ORIGINS` | **Required** in production | `api/_lib/cors.js`, `server/server.js` | Comma-separated allowlist for CORS (e.g. `https://your-app.vercel.app,http://localhost:5173`). Defaults to the two localhost origins |
| `JWT_SECRET` | Only for legacy login | `api/_lib/auth.js`, `api/login.js`, `server/server.js` | Signs and checks legacy JWTs. Without it `/api/login` returns 500 and legacy tokens are rejected. A secret |
| `JWT_EXPIRES_IN_SECONDS` | Optional | `api/login.js`, `server/server.js` | Legacy JWT lifetime in seconds (default 86400 / 24h) |
| `CORS_ALLOW_CREDENTIALS` | Optional | `api/_lib/cors.js`, `server/server.js` | Set to `true` only if you need to send cookies with cross-origin requests |
| `API_READ_ONLY` | Optional | `shared/readOnly.js` | Set to `true` to make both backends refuse every write except sign-in (503, `{"error":"read_only"}`). Off by default. See `docs/move-runbook.md` |

Vercel sets `VERCEL_URL` itself, and the API adds that address to the CORS allowlist. The Neon integration also adds `POSTGRES_*` and `PG*` variables to the Vercel project; the code reads only `DATABASE_URL`.

The local Express server reads the same variables from `server/.env`, except `DATABASE_URL` (it uses a SQLite file), plus `PORT` (default 3000). With `NODE_ENV=development` and no `JWT_SECRET` it makes up a signing secret for that run.

### Documented before, used by nothing

`VITE_GEMINI_API_KEY`, `VITE_OCR_ENDPOINT` and `GEMINI_API_KEY` were listed here as required or optional, and `VITE_GEMINI_API_KEY` is still in `app/.env.example`. No code reads any of them and there is no Gemini or OCR feature in the app. Do not set them. If such a key was ever created, see step 4.1 in [`SECURITY_NOTICE.md`](../SECURITY_NOTICE.md).

Anything prefixed with `VITE_` is shipped to every browser, so never put a secret behind that prefix.

## Common Issues

### Firebase Authentication 401 Errors
If protected endpoints return 401 after Firebase sign-in, check:
1. `FIREBASE_PROJECT_ID` on the backend names the Firebase project that `VITE_FIREBASE_API_KEY` belongs to (the same value as `VITE_FIREBASE_PROJECT_ID` in the templates) — a mismatch causes every token verification to fail.
2. Your Firebase credentials have not expired or been revoked.
3. Any variable change requires a full redeploy to take effect.

**Note**: Some deployment providers preserve literal quotes in variable values. If that applies to your host, remove the surrounding quotes from your Firebase environment variables and redeploy.

## Local Development Setup

1. Create an untracked local file from the template. Vite loads `app/.env.development.local` after `app/.env.development`, so its values win, and `.gitignore` keeps it out of git:
   ```bash
   [ -e app/.env.development.local ] || cp app/.env.example app/.env.development.local
   ```
   Do **not** copy the template over `app/.env.development` or `app/.env.production`. Those two files are tracked in git.

2. Fill in your values **without quotes**:
   ```bash
   VITE_API_URL=http://localhost:3000
   VITE_FIREBASE_API_KEY=your-firebase-web-api-key
   VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_APP_ID=your-firebase-web-app-id
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   ```
   The frontend never reads `DATABASE_URL`, so it does not belong in this file. For `vercel dev`, run `vercel pull`, which stores the project settings and environment variables under `.vercel/`. For the scripts in `scripts/`, `export DATABASE_URL=...` in your shell. See "For new developers" in [`SECURITY_NOTICE.md`](../SECURITY_NOTICE.md).

3. Never put a real value in a tracked file. `.gitignore` covers only `.env`, `.env.local` and the `.env*.local` files (such as `app/.env.development.local`). `app/.env.development`, `app/.env.production`, `app/.env.example` and `server/.env.example` are **tracked** and must stay placeholder-only; the `Secret scan` CI job fails if a real-looking credential lands in a tracked file. If one already did, follow [`SECURITY_NOTICE.md`](../SECURITY_NOTICE.md).

4. For the local Express server (`server/server.js`), create `server/.env` with `FIREBASE_PROJECT_ID`, `JWT_SECRET`, and `ALLOWED_ORIGINS` that match your dev URLs. See `server/.env.example` for defaults. The server loads **only** `server/.env`: it calls `require('dotenv').config()` with no path, which reads `.env` from the directory you run `cd server && node server.js` in. A `server/.env.local` file is silently ignored, so do not put server settings there. The root `.env.local` is a separate file used only by `vercel dev`.

## Production Deployment

Environment variables for production are managed in Vercel:
1. Go to Vercel dashboard → Project Settings → Environment Variables
2. Add variables without quotes
3. Select appropriate environments (Production, Preview, Development)
4. Redeploy to apply changes
