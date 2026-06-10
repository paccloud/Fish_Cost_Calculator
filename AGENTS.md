# Repository Guidelines

## Project Structure & Module Organization

- `app/`: React + Vite frontend.
  - `app/src/components/`: UI (calculator, auth, data management).
  - `app/src/context/`: React Context providers (auth/theme).
  - `app/src/data/`: Yield datasets + validators/tests (e.g. `fish_data_v3.js`).
  - `app/public/`: Static assets.
- `server/`: Local Express API + SQLite (`server/server.js`, `server/fish_app.db`, `server/uploads/`).
- `api/`: Vercel serverless endpoints; shared helpers live in `api/_lib/` (Neon/Stack Auth).
- `docs/`: `docs/ARCHITECTURE.md`, `docs/API.md`. `scripts/` contains migration/import utilities.

## Build, Test, and Development Commands

- Install dependencies:
  - Frontend: `cd app && npm install`
  - Local API: `cd server && npm install`
- Run locally (two terminals):
  - API: `cd server && node server.js` (defaults to `http://localhost:3000`)
  - UI: `cd app && npm run dev` (Vite proxies `/api` → `http://localhost:3000`)
- Quality and builds:
  - Lint: `cd app && npm run lint`
  - Test: `cd app && npm test`
  - Build/preview: `cd app && npm run build && npm run preview`

## Coding Style & Naming Conventions

- Frontend code is ESM (`app/package.json` has `"type": "module"`). Keep imports/exports consistent.
- Indentation: 2 spaces in `app/`; elsewhere, follow the existing file’s style.
- React components: `PascalCase.jsx`; hooks: `useThing()`.
- Yield conversion keys use the exact pattern `"From State → To State"` (note the arrow), with numeric `yield` and optional `[min, max]` `range`.

## Testing Guidelines

- Test framework: Vitest (see `app/src/data/fish_data.test.js`).
- When changing yield data or validators (`app/src/data/*`), run `cd app && npm test` before opening a PR.

## Commit & Pull Request Guidelines

- Use feature branches: `feature/...`, `fix/...`, `refactor/...`, `docs/...` (avoid direct commits to `main`).
- Prefer the commit style used in recent history: `feat:`, `fix:`, `refactor:`, `test(data):` + a short imperative summary.
- PRs should include: clear description of user impact, linked issue (if any), screenshots for UI changes, and citations for any new/updated yield data.

## Configuration & Security

- Do not commit secrets. Use example files like `app/.env.example` and `server/.env.example`, then local overrides (e.g. `.env.local`).
- Local development uses SQLite (`server/`); production deployment uses Vercel serverless endpoints in `api/` with Neon-backed storage.
