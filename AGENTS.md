# Repository Guidelines

## Direction

Read these before changing anything:

- `CONTEXT.md` — the project's vocabulary. Use its terms.
- `docs/adr/` — accepted decisions. ADR 0001 replaces both backends with Firebase Auth, Firestore and Firebase Hosting.
- `docs/reviews/2026-11-product-audit.md` — the current state of the product and what to do next.
- `docs/STYLE_GUIDE.md` — the look, the words and the components.

The two backends (`server/` and `api/`) are in maintenance only until the move to Firebase (issues #123–#133); fix what is broken, but do not build new features on them. Short-term work is the calculator itself, on the web and on iOS through Capacitor (see `docs/ios.md`). Use Node 22.

Documents in `docs/archive/` are superseded. Do not follow them.

## Project Structure & Module Organization

- `app/`: React + Vite frontend.
  - `app/src/components/`: UI (calculator, sign-in, data management, community data).
  - `app/src/context/`: React Context providers (auth, data and sync, theme).
  - `app/src/lib/`: Calculation engine, local storage, sync, API client and their tests.
  - `app/src/data/`: Yield datasets + validators/tests (e.g. `fish_data_v3.js`).
  - `app/public/`: Static assets.
- `server/`: Local Express API + SQLite (`server/server.js`; the database file `server/fish_app.db` is created on first run and is not tracked).
- `api/`: Vercel serverless endpoints; shared helpers live in `api/_lib/` (Neon DB/Firebase Auth).
- `shared/`: Endpoint logic used by both `server/` and `api/` (`shared/handlers/`).
- `db/migrations/`: SQL to run by hand against the Neon database.
- `scripts/`: Neon schema, migration/import utilities, and the secret scanner (`scripts/check-secrets.mjs`).
- `docs/`: `docs/ARCHITECTURE.md`, `docs/API.md`, decisions in `docs/adr/`, reviews in `docs/reviews/`. `docs/archive/` holds superseded documents.

Routes (in `app/src/App.jsx`): `/` (calculator), `/login`, `/upload`, `/about`, `/data-sources`, `/manage-data`, `/profile`, `/community-data`, `/account`.

## Build, Test, and Development Commands

- Install dependencies (four packages; the tests and the local API import from `api/` and `shared/`, so all four are needed):
  - API helpers: `npm install` (repository root)
  - Frontend: `cd app && npm install`
  - Shared handlers: `cd shared && npm install`
  - Local API: `cd server && npm install`
- Run locally (two terminals):
  - API: `cd server && node server.js` (defaults to `http://localhost:3000`)
  - UI: `cd app && npm run dev` (Vite proxies `/api` → `http://localhost:3000`)
- Quality and builds:
  - Lint: `cd app && npm run lint`
  - Test: `cd app && npm test` (about two minutes; most of that is the secret scanner's own tests)
  - Build/preview: `cd app && npm run build && npm run preview`
  - Secret scan: `node scripts/check-secrets.mjs` (repository root)

## Coding Style & Naming Conventions

- Frontend code is ESM (`app/package.json` has `"type": "module"`). Keep imports/exports consistent.
- Indentation: 2 spaces in `app/`; elsewhere, follow the existing file’s style.
- React components: `PascalCase.jsx`; hooks: `useThing()`.
- Yield conversion keys use the exact pattern `"From State → To State"` (note the arrow), with numeric `yield` and optional `[min, max]` `range`.

## Testing Guidelines

- Test framework: Vitest. Tests sit beside the code (`app/src/lib/*.test.js`, `app/src/data/fish_data.test.js`) and in `app/src/lib/__tests__/`, which also holds the tests for `api/`, `shared/` and the secret scanner.
- When changing yield data or validators (`app/src/data/*`), run `cd app && npm test` before opening a PR.

## Commit & Pull Request Guidelines

- Use feature branches: `feature/...`, `fix/...`, `refactor/...`, `docs/...` (avoid direct commits to `main`).
- Prefer the commit style used in recent history: `feat:`, `fix:`, `refactor:`, `test(data):` + a short imperative summary.
- PRs should include: clear description of user impact, linked issue (if any), screenshots for UI changes, and citations for any new/updated yield data.

## Configuration & Security

- Do not commit secrets. Use example files like `app/.env.example` and `server/.env.example`, then gitignored local copies: `app/.env.development.local` for the frontend, `server/.env` for the local Express server (it loads only `server/.env`, not `server/.env.local`), and the root `.env.local` only for `vercel dev`.
- Local development uses SQLite (`server/`); production deployment uses Vercel serverless endpoints in `api/` with Neon-backed storage.
- Report a vulnerability privately; see `SECURITY.md`.
