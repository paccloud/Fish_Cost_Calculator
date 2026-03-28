# Issue List (Security + Accessibility)

This list is scoped to what’s currently in-repo (local `server/`, Vercel `api/`, and `app/`). Priorities assume a public deployment exists.

## P0 — Fix ASAP (Security)

1. **Remove hardcoded JWT secret fallback (local server)**
   - Location: `server/server.js:14`
   - Risk: If a deploy ever runs without `JWT_SECRET`, tokens become forgeable.
   - Fix: Require `process.env.JWT_SECRET` in non-dev; fail fast on boot; update docs/env examples.
   - Done when: Server refuses to start without a secret (prod), and tests/manual login still work.

2. **Add JWT expiration (serverless + local)**
   - Locations: `api/login.js:35`, `server/server.js:108`
   - Risk: Stolen tokens remain valid indefinitely.
   - Fix: Add `expiresIn` (e.g., 1h/24h) and handle expiry client-side (re-auth / refresh strategy).
   - Done when: Tokens include `exp`, and expired tokens are rejected consistently.

3. **Fix CORS credentials + wildcard origin**
   - Location: `api/_lib/cors.js:6-10`
   - Risk: Misconfiguration; becomes dangerous if cookie auth/credentials are used.
   - Fix: Replace `*` with an allowlist; only set `Allow-Credentials` when required; include `Vary: Origin`.
   - Done when: Only approved origins work, and preflight/requests succeed in dev + prod.

4. **Harden file upload handling (local server)**
   - Location: `server/server.js:137-176`
   - Risk: DoS via large uploads; insufficient type checks; temp file cleanup gaps on error.
   - Fix: Add multer limits (size), validate extension/MIME, reject unexpected; ensure cleanup in `finally`.
   - Done when: Oversize/invalid files are rejected and no temp files remain.

5. **Prevent CSV injection in exports**
   - Locations: `api/export.js:26-50`, `server/server.js:240-277`
   - Risk: Spreadsheet formula execution when opening exported CSV.
   - Fix: Sanitize cells starting with `=`, `+`, `-`, `@` (prefix with `'` or space) + escape quotes safely.
   - Done when: Exported CSV opens safely in Excel/Sheets with malicious input neutralized.

6. **Re-evaluate public calculations endpoint privacy**
   - Location: `api/public-calcs.js:15-28`
   - Risk: Leaks potentially identifying free-form `name`/metadata at scale.
   - Fix options: Remove `name`, make it opt-in, or store/display an anonymized label; add rate limiting.
   - Done when: Public output cannot contain user-entered identifiers by default.

## P1 — Next (Security hardening)

7. **Add security headers for production**
   - Location: `vercel.json` (or Vercel project headers)
   - Fix: CSP baseline, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`.

8. **Input validation constraints**
   - Locations: `api/save-calc.js`, `api/register.js`, `api/contributor.js`, `server/server.js`
   - Fix: Validate types/ranges/lengths (e.g., `yield` 0–100, max string lengths).

9. **Avoid returning raw internal errors to clients**
   - Location: `api/upload-data.js:79-81`
   - Fix: Log detailed errors server-side; return a generic message to clients.

## P0 — Fix ASAP (Accessibility)

10. **Associate labels with inputs (forms)**
   - Locations: `app/src/components/Login.jsx`, `app/src/components/Calculator.jsx`, `app/src/components/ContributorProfile.jsx`
   - Fix: Add `id` + `htmlFor` (or wrap inputs in labels).
   - Done when: Screen readers announce label + control correctly.

11. **Keyboard/screen-reader accessible tooltips**
   - Location: `app/src/components/Calculator.jsx:8-25`
   - Fix: Open on focus/blur; use `role="tooltip"`; link via `aria-describedby`; ensure trigger is focusable.

12. **Accessible names for icon-only buttons**
   - Location: `app/src/components/DataManagement.jsx:199`
   - Fix: Add `aria-label` (don’t rely on `title` alone).

13. **Announce status/errors via aria-live**
   - Locations: `app/src/components/UploadData.jsx:105-110`, `app/src/components/Login.jsx:131`, `app/src/components/Calculator.jsx:621`
   - Fix: Use `role="alert"` for errors and `role="status"`/`aria-live="polite"` for success updates.

## Notes / Triage Guidance

- The deployed surface area is likely `api/` (Vercel). `server/` appears intended for local dev, but it should still be safe-by-default to avoid copy/paste deployments.
- Consider adding rate limiting (especially for auth + public endpoints) once the P0 items are addressed.
