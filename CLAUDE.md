# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fish Cost Calculator is a fish yield calculator for the seafood industry. It calculates the true cost of fish products after accounting for processing yields, helping fishers and processors determine prices for finished products.

## Commands

### Development
```bash
# Frontend (Vite + React) - runs on http://localhost:5173
npm run dev:frontend

# Cloudflare Worker (Hono API) - runs on http://localhost:8787
npm run dev:worker

# Local Express backend (SQLite) - runs on http://localhost:3000
npm run dev:server

# Lint frontend
cd app && npm run lint

# Run tests (Vitest)
cd app && npm test

# Build frontend for production
npm run build

# Deploy to Cloudflare (builds frontend + deploys Worker)
npm run deploy

# Apply D1 database migrations
npm run db:migrate
```

### First-time Setup
```bash
cd app && npm install
cd ../server && npm install
npm install
# Copy and configure env files (no quotes around values — Vite includes them literally)
cp app/.env.example app/.env.development
```

## Architecture

### Backend Design

The project has **two backend implementations** for different environments:

1. **`worker/`** — Cloudflare Worker using Hono framework for production. Deployed to Cloudflare with D1 (SQLite-based) database. Uses Better Auth for authentication (email/password + Google OAuth).
   - `index.js` — Hono app with all API routes
   - `auth.js` — Better Auth configuration with Kysely + D1 adapter
   - `middleware.js` — CORS handling and auth session middleware

2. **`server/server.js`** — Local development Express server with SQLite (`fish_app.db`). Single-file, JWT auth with bcrypt. Used when running `npm run dev:server`.

**Important:** Changes to API logic should be applied to both `worker/index.js` (production) and `server/server.js` (local dev) to stay in sync.

### Configuration
- `wrangler.toml` — Cloudflare Worker configuration, D1 database binding, asset directory
- `migrations/` — D1 SQL migration files applied via `npm run db:migrate`

### Frontend (`app/`)
- **React 19 + Vite 7** with Tailwind CSS 3
- Entry: `src/main.jsx` → `src/App.jsx`
- Auth: Better Auth (email/password + Google OAuth) via `src/context/AuthContext.jsx`
- API base URL configured in `src/config/api.js` — uses `VITE_API_URL` in dev (localhost:3000), empty string in prod (same-origin)
- Routes defined in `App.jsx`:
  - `/` (Home), `/calculator`, `/login`, `/upload`, `/about`, `/submit-request`
  - `/data-sources`, `/manage-data`, `/profile`, `/roadmap`
- Fish yield data in `src/data/fish_data_v3.js` — 60+ species with conversion yields from MAB-37 research publication

### Data Flow
1. Fish yield data is static in `fish_data_v3.js` (from MAB-37 PDF research document)
2. Users can add custom yield data stored in SQLite (local) or D1 (prod) `user_data` table
3. Calculator merges static + user data, performs yield/cost calculations client-side
4. Saved calculations stored in `calculations` table

### Key Data Structures
Fish conversions use "From State -> To Product" pattern with yield percentages:
```javascript
"Pink Salmon": {
  conversions: {
    "Round -> D/H-On": { yield: 91, range: [84, 94] },
    "Round -> Skinless Fillet": { yield: 42, range: [41, 46] }
  }
}
```
Common acronyms: Round (whole fish), D/H-On (dressed/head-on), D/H-Off (dressed/head-off), S/B or SIB (skinless/boneless)

## API Endpoints

Auth: `POST /api/auth/*` (Better Auth handles registration, login, OAuth)
Calculations: `GET/POST /api/saved-calcs`, `POST /api/save-calc`
User Data: `GET/POST/PUT/DELETE /api/user-data`, `POST /api/upload-data` (Excel/CSV)
Public: `GET /api/public-calcs`, `GET /api/contributors`, `GET /api/fish-data`
Export: `GET /api/export`

All endpoints except public ones require a valid Better Auth session.

## Deployment

Deployed on **Cloudflare Workers** with D1 database.
- `wrangler.toml` configures the Worker, D1 binding, and static asset directory (`app/dist`)
- Frontend is served as static assets from the Worker
- Environment secrets set via `wrangler secret put`:
  - `BETTER_AUTH_SECRET` — session signing secret
  - `GOOGLE_CLIENT_ID` — Google OAuth client ID
  - `GOOGLE_CLIENT_SECRET` — Google OAuth client secret
  - `ALLOWED_ORIGINS` — CORS origin allowlist
- Frontend env vars use `VITE_` prefix (bundled into client, not secret)
- **No quotes in `.env` files** — Vite includes them literally

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
