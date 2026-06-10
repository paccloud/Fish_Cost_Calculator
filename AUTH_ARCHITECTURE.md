# Auth Architecture

This project currently uses two authentication paths that map into the same
Neon PostgreSQL `users` table.

## Current System

### Password Auth

- Frontend login and registration call `POST /api/login` and `POST /api/register`.
- The API verifies passwords with `bcrypt` and signs JWTs with `jsonwebtoken`.
- The frontend stores the JWT in `localStorage` and sends it as a bearer token.
- API routes use `requireAuth()` from `api/_lib/auth.js`; that middleware checks
  the JWT path first.

### OAuth Auth

- OAuth is handled by Stack Auth through the Neon Auth integration.
- The React app initializes `StackClientApp` in `app/src/config/neonAuth.js`.
- `app/src/App.jsx` wraps the app in `StackProvider` and exposes Stack Auth's
  callback handler at `/handler/*`.
- The backend verifies Stack Auth sessions in `api/_lib/neon-auth.js` by calling
  Stack Auth's server API.
- OAuth users are linked to local database users by `neon_auth_id` first, then
  by email.

### Data Persistence

Neon PostgreSQL remains the application database. User-owned data is keyed to
`users.id`:

- `calculations.user_id`
- `user_data.user_id`
- `contributors.user_id`

Any auth migration must preserve those relationships so saved calculations,
custom yield data, and contributor profiles continue to sync across devices.

## Required Properties For Any Future Auth System

- Support OAuth providers such as Google and GitHub.
- Support email or password login for users who do not use OAuth.
- Persist identity across devices, not only in browser storage.
- Map every authenticated identity to the existing local user record.
- Keep `req.user` compatible with protected API routes that expect `id`,
  `username`, and `email`.
- Work with the selected hosting platform and Neon PostgreSQL.

## Operational Notes

Stack Auth OAuth redirects only work from domains registered in Stack Auth's
Trusted Domains settings. A deployed Vercel domain must be added there before
OAuth can complete. The callback route is `/handler/*`, but Stack Auth expects
the domain root to be trusted, not the full callback URL.

The Vercel integrations panel should only keep integrations that are actively
used. Clerk is not referenced in this codebase, and duplicate Neon integrations
make it harder to reason about which environment variables and auth project are
active.

## Migration Options

### Keep Stack Auth

This is the lowest-code option. It keeps the current OAuth flow and local JWT
password flow, but the team must maintain Trusted Domains and Vercel integration
settings carefully.

### Better Auth

Better Auth can consolidate email/password and OAuth into one self-hosted auth
system. The existing roadmap in `docs/AUTH_MIGRATION_ROADMAP.md` covers the
larger Stack Auth to Better Auth plus Cloudflare migration.

### Clerk

Clerk has strong React support and can run outside Vercel, but it is not wired
into this repository today. Connecting Clerk would require replacing the current
Stack Auth and JWT paths.

### Auth.js

Auth.js is open source and provider-agnostic. It would require more adapter and
session work than Stack Auth, but it avoids a hosted auth dependency.

### Supabase Auth

Supabase Auth works well when the database is also Supabase. Using it here would
introduce a second platform next to Neon unless the database is migrated too.

## Migration Checklist

- [ ] Inventory current Vercel and Stack Auth environment variables.
- [ ] Register production and preview domains in Stack Auth Trusted Domains.
- [ ] Remove unused Clerk integration from Vercel.
- [ ] Remove stale duplicate Neon integrations after confirming env ownership.
- [ ] Choose whether to keep dual auth or consolidate into one provider.
- [ ] Preserve the `users.id` mapping for calculations, custom data, and
      contributor profiles.
- [ ] Test password login, OAuth login, logout, saved calculations, custom data,
      and contributor profile updates after any auth change.
