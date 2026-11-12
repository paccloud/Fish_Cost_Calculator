# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local Catch is a fish yield calculator for the seafood industry. It calculates the true cost of fish products after accounting for processing yields, helping fishers and processors determine prices for finished products.

## Direction

Read these before changing anything:

- `CONTEXT.md` — the project's vocabulary. Use its terms.
- `docs/adr/` — accepted decisions. ADR 0001 replaces both backends with Firebase Auth, Firestore and Firebase Hosting.
- `docs/reviews/2026-11-product-audit.md` — the current state of the product and what to do next.
- `docs/STYLE_GUIDE.md` — the look, the words and the components.

The two backends described below (`server/` and `api/`) are in maintenance only until the move to Firebase (issues #123–#133); fix what is broken, but do not build new features on them. Short-term work is the calculator itself, on the web and on iOS through Capacitor (see `docs/ios.md`). Use Node 22.

Documents in `docs/archive/` are superseded. Do not follow them.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `paccloud/Fish_Cost_Calculator`. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default Matt Pocock engineering-skill triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.

## Commands

### Development
```bash
# Frontend (Vite + React) - runs on http://localhost:5173
cd app && npm run dev

# Backend (Express + SQLite) - local dev only, runs on http://localhost:3000
cd server && node server.js

# Alternative: test Vercel serverless functions locally (uses Neon DB)
vercel dev

# Lint frontend
cd app && npm run lint

# Run tests (Vitest) - also covers api/, shared/ and scripts/check-secrets.mjs; takes about two minutes
cd app && npm test

# Build frontend for production
cd app && npm run build

# Scan tracked files for secrets (also a CI job)
node scripts/check-secrets.mjs
```

### First-time Setup
```bash
# Four packages, four installs. The tests and the local server import from api/ and shared/,
# so the root and shared/ installs are needed even for frontend-only work.
npm install
cd app && npm install
cd ../shared && npm install
cd ../server && npm install
cd ..
# Create your untracked local env files (no quotes around values — Vite includes them literally).
# Never overwrite the tracked app/.env.development or app/.env.production; see SECURITY_NOTICE.md.
[ -e app/.env.development.local ] || cp app/.env.example app/.env.development.local
[ -e server/.env ] || cp server/.env.example server/.env
```

## Architecture

### Dual Backend Design

The project has **two separate backend implementations** that serve different environments:

1. **`server/server.js`** — Local development Express server with SQLite (`fish_app.db`). Single-file local API that accepts Firebase ID tokens and legacy JWTs during migration. Used when running `node server.js`.

2. **`api/`** — Vercel serverless functions for production. Each file is a separate endpoint. Uses Neon PostgreSQL via `@neondatabase/serverless`. Shared helpers in `api/_lib/`:
   - `db.js` — Neon connection pool
   - `neonDb.js` — the Neon data adapter the shared handlers call
   - `auth.js` — Firebase ID token auth plus legacy JWT compatibility, with `requireAuth()` HOF
   - `cors.js` — Origin allowlist from `ALLOWED_ORIGINS` env var, with `handleCors()` HOF
   - `firebase-auth.js` — Firebase ID token verification + local user auto-creation
   - `importRows.js` — Excel/CSV parsing for uploads

Most endpoint logic lives once in **`shared/handlers/`**, behind a small database interface (`shared/db/interface.js`). `api/*.js` calls it with the Neon adapter and `server/server.js` calls it with the SQLite adapter (`server/adapters/sqliteDb.js`).

**Important:** A change to shared handler logic reaches both backends. Routing, uploads (`upload-data`) and exports (`export`) are still written twice, so a change there must be applied to both `server/server.js` (local) and the corresponding `api/*.js` file (production).

### Frontend (`app/`)
- **React 19 + Vite 7** with Tailwind CSS 3, installable as a PWA (`vite-plugin-pwa`)
- Entry: `src/main.jsx` → `src/App.jsx`
- Auth: Firebase Auth (email/password and Google) over Firebase's REST endpoints in `src/lib/firebaseRestAuth.js`, held in `src/context/AuthContext.jsx`. Firebase ID tokens are sent to protected API routes. There is no Firebase SDK in the app yet.
- API base URL configured in `src/config/api.js` — uses `VITE_API_URL` in dev (localhost:3000), empty string in prod (same-origin)
- Routes defined in `App.jsx`:
  - `/` (calculator), `/login`, `/upload`, `/about`
  - `/data-sources`, `/manage-data`, `/profile`, `/community-data`, `/account`
- Fish yield data in `src/data/fish_data_v3.js` — 89 species with conversion yields from MAB-37 research publication
- Calculation math in `src/lib/calcEngine.js`
- Offline data: `src/context/DataContext.jsx` keeps a copy of the account's saved calculations and custom yields in IndexedDB (`src/lib/localRepository.js`) and syncs it with the API when signed in (`src/lib/syncCoordinator.js`)

### Data Flow
1. Reference yields are bundled in `fish_data_v3.js` (from the MAB-37 PDF research document). The calculator also asks `GET /api/fish-data` and uses the answer only if it holds usable conversions, so it works with no backend.
2. Custom yields (added on `/manage-data`, signed in) are written to IndexedDB first and then synced to the `user_data` table in SQLite (local) or Neon PostgreSQL (prod).
3. Calculator merges reference + custom yields (`src/lib/fishDataMerge.js`), performs yield/cost calculations client-side
4. Saving a calculation writes it to IndexedDB first through `DataContext.saveCalc`, for guests and signed-in people alike, and `/manage-data` lists it from there. For a signed-in person the sync then pushes it to `/api/save-calc` (the `calculations` table).

### Key Data Structures
Fish conversions use "From State → To Product" pattern with yield percentages:
```javascript
"Pink Salmon": {
  conversions: {
    "Round → D/H-On": { yield: 91, range: [84, 94] },
    "Round → Skinless Fillet": { yield: 42, range: [41, 46] }
  }
}
```
Common acronyms: Round (whole fish), D/H-On (dressed/head-on), D/H-Off (dressed/head-off), S/B or SIB (skinless/boneless)

## API Endpoints

Auth: `POST /api/register`, `POST /api/login` (legacy password accounts only; the app signs in through Firebase)
Calculations: `GET/POST /api/saved-calcs`, `POST /api/save-calc` (old name for the same POST), `DELETE /api/saved-calcs/:id`, `PATCH /api/saved-calcs/:id/publish|unpublish` (production only)
User Data: `GET/POST /api/user-data`, `PUT/PATCH/DELETE /api/user-data/:id`, `POST /api/user-data/:id/share|unshare`, `POST /api/upload-data` (.xlsx/.csv)
Contributor profile: `GET/POST /api/contributor`
Public: `GET /api/public-calcs`, `GET /api/contributors`, `GET /api/fish-data`, `GET /api/community-data`
Export: `GET /api/export`

All protected endpoints require `Authorization: Bearer <firebase_id_token>`; legacy JWTs are accepted only during the migration window. See `docs/API.md`.

## Deployment

Deployed on **Vercel** with Neon PostgreSQL. See `DEPLOYMENT.md` for full guide.
- `vercel.json` configures build, output dir (`app/dist`), and API rewrites
- Frontend env vars use `VITE_` prefix (bundled into client, not secret)
- Server env vars: `DATABASE_URL`, `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS`; `JWT_SECRET` only for legacy JWT login compatibility
- **No quotes in `.env` files** — Vite includes them literally. See `docs/ENVIRONMENT_VARIABLES.md`

## Git Workflow

**IMPORTANT: Always use feature branches for ALL work, including bug fixes.**

### Branch Naming Convention
- Features: `feature/<short-description>`
- Bug fixes: `fix/<short-description>`
- Refactors: `refactor/<short-description>`
- Docs: `docs/<short-description>`

### Required Workflow
1. Create a new branch before starting any work
2. Make changes and commit frequently with clear messages
3. Push the branch and create a Pull Request via `gh pr create`
4. **Never commit directly to main** — all changes must go through PRs

### Commit Message Format
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- Present tense, under 70 characters
- Reference issue numbers when applicable
