# Repository Audit & Improvement Plan — Fish Cost Calculator

**Date:** 2026-06-10
**Scope:** Full repository at commit `f8b05a6` (branch `main`)
**Method:** Every claim below was verified against actual files (cited as `file:line`), or by running the project's own tooling (`npm test`, `npm run lint`, `npm run build`, `npm audit`). Facts and judgments are labeled where they could be confused.

---

## 1. Executive Summary

**Health grade: C−**

The frontend craft is genuinely good for a project at this maturity (accessible tooltips, offline-first IndexedDB store, PWA, dark mode, 1,788 passing data-validation tests). But the audit found that the app's flagship feature — offline-first sync — is **silently broken in at least four independent ways** due to client/server field-name mismatches and a missing endpoint, and that **OAuth users cannot use any authenticated API except the contributor profile** because the data layer only ever reads the password-auth JWT. Neither failure is caught by any test or CI gate, because the only CI is CodeQL and the only tests validate the static fish dataset.

### Top 3 Risks
1. **The sync engine and the API disagree on field names and routes** — synced calculations lose their yield value, custom-yield sync fails with a 400 on every attempt, pulled yields arrive as `undefined`, and deleted calculations resurrect because the DELETE endpoint doesn't exist (§3.1, Critical).
2. **Real credentials live in git history.** `SECURITY_NOTICE.md` documents the exposure and demands rotation; history was never scrubbed (28 secret-bearing lines still retrievable via `git log -p`). Whether rotation happened cannot be verified from the repo (§3.3, Critical-if-unrotated).
3. **Every saved calculation — including users' cost data — is published to all visitors** via `/api/public-calcs` with no opt-in and no disclosure at save time (§3.4, High).

### Top 3 Opportunities
1. **A real CI gate (lint + test + build) is one small YAML file away** — and would immediately surface that `npm run lint` currently fails with 22 errors.
2. **Fixing ~6 lines of field-name mismatches** restores the entire sync feature.
3. **A shared `getAuthHeaders()` helper** (the pattern already exists in `ContributorProfile.jsx:23-33`) unlocks the whole authenticated API surface for OAuth users.

---

## 2. Repo Map (Phase 1)

### Purpose & users
A fish-yield/cost calculator for small-scale fishers and seafood processors (Local Catch Network community). Given a species and a processing conversion (e.g., "Round → Skinless Fillet"), it computes the true cost per pound of finished product. Early-stage, single-maintainer, deployed on Vercel; maturity is "live hobby/community tool," not a commercial product.

### Stack
- **Frontend** (`app/`): React 19 + Vite 7, Tailwind 3, React Router 7, Stack Auth (`@stackframe/react`), `idb-keyval` for IndexedDB, `vite-plugin-pwa`, Vitest. Builds clean; main chunk exceeds 500 kB (Vite warning), PWA precache ≈ 1.97 MB.
- **Production backend** (`api/`): Vercel serverless functions, Neon PostgreSQL via `@neondatabase/serverless`, JWT (password) + Stack Auth (OAuth) dual auth, shared helpers in `api/_lib/`.
- **Local dev backend** (`server/server.js`): single-file Express 5 + SQLite, intended to mirror `api/` (per `CLAUDE.md`) — it has drifted (§3.6).
- **CI**: CodeQL only (`.github/workflows/codeql.yml`). No lint/test/build workflow.

### Data & control flow
1. Yield data is **static** in `app/src/data/fish_data_v3.js` (1,398 lines, 89 species — verified by import) and processed at module load in `Calculator.jsx:10-30`.
2. All calculations happen **client-side** (`Calculator.jsx:462-526`).
3. User data (saved calcs, custom yields) is written to IndexedDB first (`app/src/lib/localStore.js`), then pushed/pulled by `app/src/lib/syncEngine.js` against `/api/save-calc`, `/api/saved-calcs`, `/api/user-data`.
4. A **parallel, unused data path** exists: `api/fish-data.js` serves species/yields from Neon tables (populated by `scripts/import-fish-data-to-neon.js`), but the frontend never calls it — `Calculator.jsx:2` imports the static file.

### Key directories
| Path | Role |
|---|---|
| `app/src/components/` | 11 page/feature components; `Calculator.jsx` (1,396 lines) is the core |
| `app/src/context/` | Auth, Data (sync orchestration), Theme |
| `app/src/lib/` | `localStore.js` (IndexedDB), `syncEngine.js` (push/pull) |
| `api/` + `api/_lib/` | Production serverless endpoints + db/auth/cors helpers |
| `server/` | Express+SQLite local dev backend |
| `scripts/` | Neon schema + one-off migration/import scripts |
| repo root | Docs (extensive), plus one-off Python scripts, a 2.7 MB source PDF, `pdf_content.txt` — all tracked in git |

### Surprises found during mapping
- `git ls-files` shows `datasets/% Yields NHCS.xlsx` is tracked even though `.gitignore:49` lists `datasets/` (tracked files override ignore rules).
- `server/.env.example` defines `JWT_SECRET` **twice** (lines 1 and 14) with different placeholder values, and documents a `GEMINI_API_KEY` that no code anywhere references (grep confirms only docs/env files mention it).
- Root `package.json:13` depends on `better-sqlite3` (a heavy native module) used only by the one-off `scripts/migrate-sqlite-to-neon.js`, yet `vercel.json:5` runs `npm install` at root on **every deploy**.

---

## 3. Audit Report (Phase 2)

Severity scale: **Critical** = core feature broken or security exposure; **High** = significant correctness/security/process risk; **Medium** = real but contained; **Low** = polish.

### 3.1 CRITICAL — Sync engine ↔ API contract is broken (4 distinct bugs)

These are **facts**, verified by reading both sides of each call:

**(a) Saved calculations sync with `yield = NULL`.**
`syncEngine.js:42` pushes `yield_value: calc.yield` to `POST /api/save-calc`, but the handler destructures `yield` (`api/save-calc.js:10`) — so `yieldVal` is `undefined` and the row is inserted with NULL yield. It also sends `mode` and `target_weight` (`syncEngine.js:39-41`) which the handler ignores and the schema has no columns for (`scripts/neon-schema.sql:18-28`), so weight-mode calculations sync as malformed cost calculations.

**(b) Custom-yield push fails 100% of the time.**
`syncEngine.js:96` sends `yield_percentage`, but `api/user-data/index.js:23-27` requires `yield` and returns `400 "Species, product, and yield are required"`. Every sync attempt for custom yields errors; the navbar sync dot (App.jsx:56-71) shows a permanent error state for affected users.

**(c) Pulled yields arrive as `undefined`.**
`GET /api/user-data` returns a `yield` column (`api/user-data/index.js:11`), but the merge reads `sy.yield_percentage` (`localStore.js:144`) — merged records get `yield: undefined`, which `Calculator.jsx:251` turns into `NaN`.

**(d) Deleted calculations resurrect.**
`syncEngine.js:65` issues `DELETE /api/saved-calcs/{id}`. No such route exists — `api/saved-calcs.js` is GET-only and there is no `api/saved-calcs/[id].js`; `server/server.js` has no DELETE either. Vercel returns 404, which `syncEngine.js:69` treats as success (`res.ok || res.status === 404`), so the local tombstone is removed while the server row survives — and gets re-pulled (and re-published via public-calcs) on the next sync.

**Why it matters:** this is the product's core differentiating feature ("offline-first, syncs when you log in"), and it fails silently. No test exercises any of these paths.

### 3.2 CRITICAL — OAuth users are locked out of the entire data API (except contributor profile)

**Fact:** the backend supports dual auth (`api/_lib/auth.js:36-59` accepts JWT *or* Stack Auth session), but the frontend data layer only ever sends the password-auth JWT from localStorage:
- `DataContext.jsx:63-64`: `const token = localStorage.getItem('token'); if (!token || !navigator.onLine) return;` — **sync never even starts** for OAuth users.
- `UploadData.jsx:28-33`: upload sends `Bearer ${localStorage.getItem('token')}` → `Bearer null` → 401 for OAuth users, even though the page renders for them.
- `Calculator.jsx:1199-1203`: "Export History" does the same → 401.

`ContributorProfile.jsx:23-33` shows the correct pattern (falls back to `x-stack-access-token` from `stackUser.getAuthJson()`), so the fix is to extract and reuse it. **Judgment:** since the login page leads with Google/GitHub buttons (`Login.jsx:70-88`), OAuth is likely the *majority* path, meaning most signed-in users get a permanently broken sync/upload/export experience.

### 3.3 CRITICAL (if unrotated) — Secrets in git history, history never scrubbed

**Facts:** `SECURITY_NOTICE.md` documents that real Stack Auth keys and the Neon `DATABASE_URL` (owner credentials) were committed and "MUST be rotated immediately." The files were sanitized in later commits, but history retains them: `git log -p -- app/.env.development app/.env.production` still yields 28 lines matching secret patterns across commits `ee0e0be`…`0d36e57`. The repo cannot show whether rotation actually happened. **If the keys were rotated, downgrade to Low** (history scrubbing is then optional hygiene); if not, this is an open door to the production database.

### 3.4 HIGH — All users' calculations are public, with cost data, no opt-in

`api/public-calcs.js:17-22` selects `species, product, cost, yield, result, date` from **every user's** saved calculations and serves them unauthenticated; `Calculator.jsx:217-226` displays them to all visitors as "Recent Calculations (Community)". **Judgment:** purchase cost per pound is commercially sensitive for fishers negotiating prices. Nothing in the save flow (`Calculator.jsx:528-547`) tells the user their numbers will be published. Note also bug 3.1(d) means even *deleted* calcs stay in this public feed.

### 3.5 HIGH — No abuse protection or password policy on auth endpoints

**Facts:** `api/register.js:10-14` accepts any non-empty username/password (`"a"`/`"a"` works); `api/login.js` and `server/server.js:154-171` have no rate limiting, lockout, or CAPTCHA; Vercel provides none of this by default. bcrypt cost 10 (`api/register.js:18`) is fine. **Why it matters:** unthrottled credential stuffing/brute force against a public login endpoint, and trivially weak passwords protecting data that syncs to a shared public feed.

### 3.6 HIGH — The dual backend has drifted; local dev exercises different code than prod

`CLAUDE.md` mandates keeping `server/server.js` and `api/` in sync. **Facts — they are not:**
- `server/server.js` has **no** `/api/public-calcs`, `/api/fish-data`, or `/api/export` routes; it has `/api/export-calcs` and `/api/export-user-data` instead (`server.js:372,400`). So in local dev the community feed fetch (`Calculator.jsx:218`) 404s on every page load, and "Export History" (`Calculator.jsx:1201`, calls `/api/export?type=calcs`) is broken locally.
- Upload validation differs materially: Express validates extension+MIME and parses `"42%"`-style strings (`server.js:196-215, 266-274`); the Vercel version accepts any file type, does naive `if (yieldVal < 1) yieldVal *= 100` with no numeric parsing or range check (`api/upload-data.js:80-84`), inserts row-by-row with no transaction (partial imports on row failure, `api/upload-data.js:74-92`), and leaks raw error messages to the client (`api/upload-data.js:100`).
- SQLite schema (`server.js:78-83`) lacks the `email`/`neon_auth_id`/`auth_provider` columns of the Neon schema (`scripts/neon-schema.sql:5-15`), so OAuth flows can't be exercised locally at all.

### 3.7 HIGH — CI gates: only CodeQL; lint currently fails; tests never run in CI

**Facts:** `.github/workflows/codeql.yml` is the only workflow. `npm run lint` fails with **22 errors** (12 `no-unused-vars`, 3 `react-refresh/only-export-components`, plus `react-hooks` immutability errors in `ThemeContext.jsx:32-38` and others) across 9 files. `npm test` passes (1,788 tests) and `npm run build` passes — but nothing enforces either on PRs. **Why it matters:** every bug in §3.1 would have been catchable by one integration test; instead the contract rotted across refactors (the git log shows the API consolidation happened in `0d36e57`/`6fe2dbf`).

### 3.8 MEDIUM — Test suite has zero coverage of business logic

**Fact:** all 1,788 tests live in `fish_data.test.js` and validate the static dataset's shape/consistency (a genuine strength — keep them). **Gap:** no tests for `calculate()` (`Calculator.jsx:462-526` — cost math, incoming/outgoing processing-cost application, discounts, labor), `syncAll()`, `localStore` merge/tombstone logic, or any API handler. The calculation logic is also untestable as written because it's embedded in a 1,396-line component (see §3.10).

### 3.9 MEDIUM — OAuth account linking by unverified email

`api/_lib/neon-auth.js:96-111` links a Stack Auth login to any existing local user with a matching email, without checking that Stack Auth marks the email verified. **Judgment:** if a provider (GitHub allows unverified emails) returns an attacker-controlled email matching a victim's password account, the attacker inherits that account's data. Local password accounts have no email column populated via `api/register.js` today, which narrows the practical window — but the code path is live.

### 3.10 MEDIUM — `Calculator.jsx` is a god component

**Fact:** 1,396 lines mixing pure math, data merging, URL-param parsing, share/export I/O, three modals/sections, and ~25 `useState` hooks. The next-largest components are fine. **Why it matters:** it's the file every feature touches, the logic can't be unit-tested, and it's where the `localStorage`-token bug (§3.2) hides among 1,200 lines of JSX.

### 3.11 MEDIUM — Dependency findings

- `npm audit`: app — several moderate advisories in the build/PWA chain (`@babel/plugin-transform-modules-systemjs`, `fast-xml-parser`, `fast-uri`, `brace-expansion`); root — 3 (2 moderate, 1 high: `tmp`/`uuid`); server — 6 (5 moderate, 1 high). All have `npm audit fix` paths; none are in runtime request-handling code paths I could identify. (Fact: counts; judgment: low runtime exposure.)
- Root `better-sqlite3` (native build) installed on every Vercel deploy for a one-off migration script (`package.json:13`, `vercel.json:5`).
- `api/_lib/auth.js:7-9` throws at module import if `JWT_SECRET` is unset, turning a config error into an opaque function crash for *every* authenticated route — while `api/login.js:20-23` handles the same condition gracefully. Inconsistent failure mode.

### 3.12 MEDIUM — Docs drift (the docs are plentiful but several lie)

- `README.md:140` says Excel parsing uses `xlsx`; it's ExcelJS everywhere. `README.md:34` says "60+ species"; the dataset has 89. `README.md:114` references a `data/` directory that doesn't exist. The schema section omits `contributors`.
- `docs/API.md` documents register's success response as `{"message": "User created successfully"}`; the API returns `{id, username}` (`api/register.js:27`). Export/public-calcs/fish-data endpoints in `CLAUDE.md:88-91` don't exist on the local server (§3.6).
- `server/.env.example`: duplicate `JWT_SECRET`, unused `GEMINI_API_KEY`, unused `JWT_EXPIRES_IN`/`CORS_ORIGINS` (the code reads `JWT_EXPIRES_IN_SECONDS`/`ALLOWED_ORIGINS`, `server.js:15,26`).

### 3.13 LOW — Repo hygiene
2.7 MB source PDF, `pdf_content.txt`, seven one-off Python scripts, and a tracked `.xlsx` at/near the root (`git ls-files` confirms all tracked). Harmless but noisy; the Python scripts have no documented runtime or requirements.

### 3.14 LOW — Performance
Main JS chunk > 500 kB (build output) — fine for a PWA that precaches anyway; consider code-splitting `fish_data_v3.js` and the Stack SDK later. `api/upload-data.js` does per-row INSERTs (N+1) — only matters for large files, capped at 4 MB. No other hot-path concerns found; the calculator is client-side and fast.

### Strengths (genuinely good, keep doing these)
- **Data quality discipline:** 1,788 tests including compound-yield-chain consistency checks (`fish_data.test.js:127-159`) — rare and valuable for a data product.
- **Security fundamentals mostly right:** parameterized SQL everywhere (no injection found in any handler), bcrypt, CSV formula-injection sanitization in both export paths (`api/export.js:5-10`, `server.js:63-68`), CORS allowlist with HOF pattern, ownership checks on update/delete (`api/user-data/[id].js:13-21`).
- **Offline-first architecture** (`localStore.js` tombstones + sync states) is well-designed *as a design* — it's the wiring that's broken.
- **Accessibility effort:** labeled inputs, `role="status"`/`aria-live`, keyboard-accessible help tooltips (`Calculator.jsx:61-92`).
- **Docs volume and honesty:** `SECURITY_NOTICE.md` openly documents the credential incident; `AUTH_ARCHITECTURE.md`, `DEPLOYMENT.md`, CHANGELOG exist.

---

## 4. Improvement Strategy (Phase 3)

### Theme 1 — Restore contract integrity between client and API
**Target state:** one documented request/response shape per endpoint, exercised by integration tests that run in CI.
**Principle:** a contract that isn't tested is a rumor. The sync layer and handlers must share field names (`yield`), and every route the client calls must exist.

### Theme 2 — One auth path for the data layer
**Target state:** a single `getAuthHeaders()` used by DataContext, syncEngine, UploadData, Calculator export — JWT if present, else Stack Auth token (the `ContributorProfile.jsx` pattern).
**Principle:** auth is cross-cutting; it must live in one module, not be re-derived per component.

### Theme 3 — Make CI the safety net
**Target state:** PRs fail on lint errors, test failures, or build breakage; lint is at zero errors.
**Principle:** the repo already has good tests and lint config — they're just not enforced, so they decay.

### Theme 4 — Collapse the dual-backend drift
**Target state:** local dev runs the *same* handler code as production. Recommended: make `server/server.js` a thin Express adapter that mounts the `api/*` handlers against a local Postgres (or Neon dev branch), or standardize on `vercel dev` and demote the Express server to legacy. Either way, delete the CLAUDE.md "keep two implementations in sync by hand" rule — it has empirically failed.
**Principle:** duplicated logic with manual sync discipline always drifts; share code instead of intentions.

### Theme 5 — Privacy & abuse hardening
**Target state:** public feed is opt-in (or anonymized with cost removed); login/register rate-limited; upload validation matched to the stricter Express version; credential rotation confirmed.
**Principle:** default-private for user business data; defense at the public edges.

### Explicitly NOT fixing (effort vs. payoff)
- **TypeScript migration** — high effort, the contract tests in Theme 1 buy most of the safety for 10% of the cost at this codebase size.
- **Moving yield data into the database** (`api/fish-data.js` path) — the static file is faster, versioned, and already test-covered; decide the parallel path's fate (Open Question #5) but don't build it out now.
- **Bundle-size optimization / code splitting** — a warning, not a problem, for a precached PWA.
- **Full design-system refactor of Calculator's JSX** — only extract the *logic* (Task 2.2); the markup works.

### Definition of "done" (measurable signals)
1. CI fails on lint errors, test failures, or build failure; `main` is green.
2. An integration test suite covers save-calc push, user-data push/pull, and delete round-trip — and passes against the real handlers.
3. `eslint .` exits 0.
4. An OAuth-only manual test account can: sync a calc, upload a file, export CSV.
5. `calculate()` logic has unit tests covering both modes, incoming/outgoing processing cost, and discount tiers (target: 100% of branches in the extracted module).
6. `/api/public-calcs` returns only rows whose owners opted in, and never returns `cost` unless opted in.
7. Login/register return 429 under burst traffic (verify with a 20-request loop).

---

## 5. Detailed Task Plan (Phase 4)

Effort: S < 2 h · M = half-day · L = 1–2 days · XL = needs breakdown.

### Milestone 0 — Safety net (do first; everything else depends on it)

| # | Task | Files | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| 0.1 | **Add CI workflow: lint + test + build** on PR & push to main | new `.github/workflows/ci.yml` | PR fails if any of `npm run lint`, `npm test`, `npm run build` fails in `app/` | **S** ⚡ | None | — |
| 0.2 | **Fix the 22 lint errors** so 0.1 can be enforced | 9 files listed by `eslint .` (Calculator, DataManagement, InstallPrompt, Login, SubmitRequest, UploadData, AuthContext, DataContext, ThemeContext) | `eslint .` exits 0; no rule disabled globally to get there | **S** ⚡ | Low — mostly unused vars; the `react-hooks/immutability` ones in ThemeContext need a real (small) fix | — |
| 0.3 | **Write failing integration tests for the sync contract** (they will fail — that's the point; they define Milestone 1) | new `app/src/lib/syncEngine.test.js` (mock fetch against recorded handler behavior) + new `api/__tests__/` harness invoking handlers with stub req/res | Tests encode: push calc preserves yield; push yield succeeds; pull maps `yield`; delete round-trip | **M** | Low | 0.1 |
| 0.4 | **Verify/perform credential rotation** (Stack Auth keys, Neon password) and record the date in SECURITY_NOTICE.md | `SECURITY_NOTICE.md` (+ external dashboards) | Old DATABASE_URL from git history no longer authenticates | **S** ⚡ | None | — |

### Milestone 1 — Critical fixes (correctness & security)

| # | Task | Files | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| 1.1 | **Fix sync field names** (`yield_value`→`yield` on push; `yield_percentage`→`yield` on merge) and decide weight-mode handling (either add `mode`/`target_weight` columns or stop sending them) | `app/src/lib/syncEngine.js:42,96`, `app/src/lib/localStore.js:144`; optionally `scripts/neon-schema.sql`, `api/save-calc.js`, `server/server.js:174-184` | 0.3 tests pass; a calc saved on device A appears with correct yield on device B | **S** ⚡ | Low | 0.3 |
| 1.2 | **Add `DELETE /api/saved-calcs/:id`** (Vercel `api/saved-calcs/[id].js` + Express route), with ownership check; remove the `404 == success` masking or keep it only after the route exists | new `api/saved-calcs/[id].js`, `server/server.js`, `app/src/lib/syncEngine.js:65-79` | Deleting a synced calc removes the server row; it does not reappear after re-sync; it leaves the public feed | **S** ⚡ | Low | 0.3 |
| 1.3 | **Unify auth headers for OAuth + JWT** — extract `getAuthHeaders()` into `app/src/lib/authHeaders.js`; use it in DataContext/syncEngine/UploadData/Calculator export; gate sync on "has any credential," not localStorage token | `app/src/context/DataContext.jsx:62-64`, `app/src/lib/syncEngine.js:21-24`, `app/src/components/UploadData.jsx:27-35`, `app/src/components/Calculator.jsx:1197-1216`, reuse pattern from `ContributorProfile.jsx:23-33` | An OAuth-only account can sync, upload, and export (manual test, signal #4) | **M** | Medium — touches every API call; mitigated by 0.3 tests | 0.3 |
| 1.4 | **Make the public feed opt-in and drop `cost` from it** (or anonymize fully); disclose at save time | `api/public-calcs.js`, `scripts/neon-schema.sql` (add `is_public boolean default false` to calculations), `api/save-calc.js`, `Calculator.jsx` save UI, `server/server.js` | Signal #6; existing rows default to private | **M** | Medium — product decision needed (Open Question #2) | — |
| 1.5 | **Rate-limit login/register + minimum password length** (e.g., Upstash/Vercel KV sliding window or `@upstash/ratelimit`; 8-char minimum) | `api/login.js`, `api/register.js`, `server/server.js:140-171` | Signal #7; register rejects < 8 chars with a clear error | **M** | Low | — |
| 1.6 | **Harden serverless upload to Express parity**: extension+MIME allowlist, `parseYield()` (port from `server.js:266-274`), 0–100 range check, wrap inserts in a transaction, return a generic error instead of `err.message` | `api/upload-data.js:47-54,74-101` | Uploading a `.exe` is rejected; `"42%"` parses; a bad row aborts cleanly with row count message; no internal error text in responses | **M** | Low | — |
| 1.7 | **Require verified email for OAuth account linking** (check Stack Auth's `primary_email_verified`; if unverified, create a new account instead of linking) | `api/_lib/neon-auth.js:95-112` | Unverified-email OAuth login can no longer attach to an existing email-matching account | **S** ⚡ | Low | — |

### Milestone 2 — High-leverage (makes all future work easier)

| # | Task | Files | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| 2.1 | **Collapse the dual backend**: extract handler logic into shared modules consumed by both `api/*.js` and an Express adapter (or retire `server/server.js` in favor of `vercel dev` + Neon dev branch); update CLAUDE.md/docs | `api/`, `server/server.js`, `CLAUDE.md`, `README.md`, `docs/` | Local dev serves `/api/public-calcs`, `/api/export`, identical upload validation; one implementation of each route exists | **XL** → break down: (a) pick approach, (b) shared handlers for user-data + calcs, (c) auth/upload, (d) docs | High if big-bang; do route-by-route | 1.1–1.3 |
| 2.2 | **Extract calculation engine from Calculator.jsx** into a pure module (`calculateCost`, `calculateInputWeight`, discount resolution, labor cost) + unit tests | new `app/src/lib/calcEngine.js` + test; `Calculator.jsx:462-526` | Signal #5; Calculator.jsx shrinks and contains no arithmetic | **M** | Low — pure-function extraction | 0.1 |
| 2.3 | **Split Calculator.jsx** into TimeTracking, EconomyOfScale, ShareMenu, CustomSpeciesModal, PublicHistory components | `app/src/components/Calculator.jsx` → `app/src/components/calculator/` | No file > 400 lines; behavior unchanged (smoke-test) | **L** | Medium — JSX moves; do after 2.2 | 2.2 |
| 2.4 | **Decide and prune the parallel fish-data path**: either delete `api/fish-data.js` + Neon species tables + import script, or wire the frontend to it behind a flag | `api/fish-data.js`, `scripts/import-fish-data-to-neon.js` | One canonical data source documented in CLAUDE.md | **S** ⚡ | Low | Open Q #5 |
| 2.5 | **Dependency hygiene**: `npm audit fix` in all three trees; move `better-sqlite3` to a script-local package.json or devDependencies; remove unused `pg`? (verify) | `package.json`, `server/package.json`, `app/package.json`, lockfiles | `npm audit` ≤ moderate, 0 high; Vercel build no longer compiles better-sqlite3 | **S** ⚡ | Low — lockfile churn only | 0.1 |

### Milestone 3 — Quality & polish

| # | Task | Files | Acceptance criteria | Effort | Risk |
|---|---|---|---|---|---|
| 3.1 | Fix doc drift: README (xlsx→ExcelJS, 89 species, schema, structure), docs/API.md responses, CLAUDE.md endpoint table, dedupe `server/.env.example`, remove unused GEMINI/JWT_EXPIRES_IN/CORS_ORIGINS vars | `README.md`, `docs/API.md`, `CLAUDE.md`, `server/.env.example` | Every documented endpoint/response matches code | **S** ⚡ | None |
| 3.2 | Repo hygiene: move PDF + Python scripts + pdf_content.txt to a `research/` dir or a release asset; untrack `datasets/*.xlsx` | root files | Repo root contains only project dirs + docs | **S** | None |
| 3.3 | Consistent module-load behavior for missing `JWT_SECRET` in `api/_lib/auth.js` (return 500 JSON instead of import-crash) | `api/_lib/auth.js:5-9` | Misconfig produces a clear JSON error in logs/responses | **S** | Low |
| 3.4 | Consolidate AuthContext's duplicated token-expiry logic (two effects both parse/clear the JWT) | `app/src/context/AuthContext.jsx:13-131` | One code path for expiry; behavior covered by a unit test | **S** | Low |
| 3.5 | Code-split the main bundle (lazy-load Stack handler routes, About/Roadmap pages) | `app/src/App.jsx` | Main chunk < 500 kB | **M** | Low |

### ⚡ Quick wins (high impact, S effort)
0.1 CI workflow · 0.2 lint zero · 0.4 rotation check · 1.1 sync field names · 1.2 delete endpoint · 1.7 verified-email linking · 2.4 prune fish-data path · 2.5 audit fix · 3.1 doc drift.

### Implementation sketches — top 3 tasks

**Task 1.1 + 1.2 (sync contract):**
```js
// syncEngine.js:42  — was: yield_value: calc.yield
body: JSON.stringify({
  name: calc.name || '', species: calc.species, product: calc.product,
  cost: calc.cost, yield: calc.yield, result: calc.result,
}),
// localStore.js:144 — was: yield: sy.yield_percentage
yield: sy.yield,
// syncEngine.js:96  — was: yield_percentage: yld.yield
body: JSON.stringify({ species: yld.species, product: yld.product,
  yield: yld.yield, source: yld.source || 'User Input' }),
```
```js
// new api/saved-calcs/[id].js
import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';
async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const result = await query(
    'DELETE FROM calculations WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, req.user.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  return res.status(200).json({ message: 'Deleted' });
}
export default handleCors(requireAuth(handler));
```
Mirror the route in `server/server.js`. Keep `res.status === 404` as success in syncEngine *only after* this ships (it then correctly means "already gone").

**Task 1.3 (unified auth headers):**
```js
// new app/src/lib/authHeaders.js
import { stackClientApp } from '../config/neonAuth';
export async function getAuthHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  const jwt = localStorage.getItem('token');
  if (jwt) { headers.Authorization = `Bearer ${jwt}`; return headers; }
  const stackUser = await stackClientApp.getUser();
  const auth = await stackUser?.getAuthJson();
  if (auth?.accessToken) headers['x-stack-access-token'] = auth.accessToken;
  return headers;
}
export async function hasCredentials() {
  if (localStorage.getItem('token')) return true;
  return !!(await stackClientApp.getUser());
}
```
Then: `DataContext.triggerSync` gates on `await hasCredentials()`; `syncAll()` takes headers (or calls the helper) instead of a token string; `UploadData` uses it *without* Content-Type (FormData sets its own boundary); Calculator export uses it.

**Task 0.1 (CI workflow):**
```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push: { branches: [main] }
jobs:
  frontend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: app/package-lock.json }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```
(Land 0.2's lint fixes in the same PR or the gate blocks everything.)

---

## 6. Open Questions

1. **Were the exposed Stack Auth keys and Neon password actually rotated** after `SECURITY_NOTICE.md` was written? Everything in §3.3 hinges on this. If not, rotate today.
2. **Is the public "Community" calculations feed an intentional product feature?** If yes, what fields are acceptable to publish (species/yield probably fine; cost probably not), and should it be opt-in per save or per account?
3. **Which backend is canonical for local development going forward** — keep Express+SQLite (and invest in Task 2.1's shared handlers), or standardize on `vercel dev` + a Neon dev branch and retire `server/`?
4. **Should weight-mode calculations sync?** The schema has no `mode`/`target_weight` columns; either add them (migration) or document that weight-mode results are local-only.
5. **What is the future of the Neon fish-data path** (`api/fish-data.js`, `species`/`fish_yields` tables)? It's currently dead weight; PRD.md implies it's the future. Pick one so contributors stop maintaining two data models.
6. **Is `mailto:` the intended long-term submission flow** for `SubmitRequest.jsx:91`, or should it become an API endpoint/GitHub issue template?
