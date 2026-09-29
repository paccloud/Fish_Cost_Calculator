---
status: accepted
---

# Firebase Auth and Firestore, with no server of our own

The app ran two backends (Express + SQLite locally, Vercel functions + Neon in
production), a shared handler layer, a custom offline sync engine and two
sign-in systems, for about two accounts whose only jobs are keeping custom
yields and saved calculations across devices and sharing custom yields. We
chose Firebase Auth plus Cloud Firestore, reached directly from the browser:
security rules decide who reads and writes what, and Firestore's offline cache
replaces our sync engine. Firebase Auth was already in use, so no one signs up
again.

## Considered Options

- **Supabase** (Postgres, auth, row-level security): about as simple, but free
  projects pause after a week idle, and it would change the sign-in system a
  third time.
- **Keep Neon and delete the Express/SQLite backend** (the direction in
  `AUDIT_REPORT.md` item 2.1): smallest change, but we'd still own API code,
  token verification and a sync engine.
- **Firebase SQL Connect** (proved in `dataconnect/`): needs a paid Cloud SQL
  instance; more than this app needs.

## Consequences

- `api/`, `server/`, `shared/`, SQLite, Neon, the legacy password login and the
  custom sync layer go away, and so does the rule to change both backends.
- Excel/CSV import parses in the browser.
- The community dataset is also published as a CSV/JSON file, so other tools
  can use it without Firestore.
- The Firebase SDK makes the app download larger than today's REST calls.
- Local development and CI use the Firebase emulators.
- Supersedes `docs/AUTH_MIGRATION_ROADMAP.md` (Better Auth + Cloudflare).
