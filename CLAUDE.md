# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local Catch is a fish yield calculator for the seafood industry. It calculates the true cost of fish products after accounting for processing yields, helping fishers and processors determine prices for finished products.

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

# Run tests (Vitest)
cd app && npm test

# Build frontend for production
cd app && npm run build
```

### First-time Setup
```bash
cd app && npm install
cd ../server && npm install
# Copy and configure env files (no quotes around values — Vite includes them literally)
cp app/.env.example app/.env.development
```

## Architecture

### Dual Backend Design

The project has **two separate backend implementations** that serve different environments:

1. **`server/server.js`** — Local development Express server with SQLite (`fish_app.db`). Single-file, JWT auth with bcrypt. Used when running `node server.js`.

2. **`api/`** — Vercel serverless functions for production. Each file is a separate endpoint. Uses Neon PostgreSQL via `@neondatabase/serverless`. Shared helpers in `api/_lib/`:
   - `db.js` — Neon connection pool
   - `auth.js` — Dual auth: JWT tokens (password) + Neon Auth/Stack Auth sessions (OAuth), with `requireAuth()` HOF
   - `cors.js` — Origin allowlist from `ALLOWED_ORIGINS` env var, with `handleCors()` HOF
   - `neon-auth.js` — Stack Auth session verification + local user auto-creation

**Important:** Changes to API logic must be applied to both `server/server.js` (local) and the corresponding `api/*.js` file (production) to stay in sync.

### Frontend (`app/`)
- **React 19 + Vite 7** with Tailwind CSS 3
- Entry: `src/main.jsx` → `src/App.jsx`
- Auth: Stack Auth (OAuth) via `@stackframe/react` wrapping the entire app, plus custom JWT-based password auth via `src/context/AuthContext.jsx`
- API base URL configured in `src/config/api.js` — uses `VITE_API_URL` in dev (localhost:3000), empty string in prod (same-origin)
- Routes defined in `App.jsx`:
  - `/` (Home), `/calculator`, `/login`, `/upload`, `/about`, `/submit-request`
  - `/data-sources`, `/manage-data`, `/profile`, `/roadmap`
  - `/handler/*` (Stack Auth handler routes)
- Fish yield data in `src/data/fish_data_v3.js` — 60+ species with conversion yields from MAB-37 research publication

### Data Flow
1. Fish yield data is static in `fish_data_v3.js` (from MAB-37 PDF research document)
2. Users can add custom yield data stored in SQLite (local) or Neon PostgreSQL (prod) `user_data` table
3. Calculator merges static + user data, performs yield/cost calculations client-side
4. Saved calculations stored in `calculations` table

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

Auth: `POST /api/register`, `POST /api/login`
Calculations: `GET/POST /api/saved-calcs`, `POST /api/save-calc`
User Data: `GET/POST/PUT/DELETE /api/user-data`, `POST /api/upload-data` (Excel/CSV)
Public: `GET /api/public-calcs`, `GET /api/contributors`, `GET /api/fish-data`
Export: `GET /api/export`

All endpoints except register/login/public require JWT Bearer token or Stack Auth session.

## Deployment

Deployed on **Vercel** with Neon PostgreSQL. See `DEPLOYMENT.md` for full guide.
- `vercel.json` configures build, output dir (`app/dist`), and API rewrites
- Frontend env vars use `VITE_` prefix (bundled into client, not secret)
- Server env vars: `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `STACK_SECRET_SERVER_KEY`
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
