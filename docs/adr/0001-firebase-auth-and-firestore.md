# 1. Firebase Auth and Firestore, with no server of our own

Date: 2026-09-28
Status: Accepted

## Context

Local Catch should be a very simple app. Today it runs two backends
(Express + SQLite for local dev, Vercel functions + Neon in production), a
shared handler layer, a custom offline store and sync engine, Firebase sign-in
and a legacy username/password path. Every API change has to be made twice.

An **Account** has only two jobs (see `CONTEXT.md`): keep a person's custom
yields and saved calculations across devices, and share custom yields to the
community dataset. The live site has about two accounts, so moving them costs
almost nothing.

## Decision

Use Firebase Auth for sign-in and Cloud Firestore for data. The browser talks to
Firestore directly; Firestore security rules enforce who can read and write:

- a person reads and writes only their own custom yields and saved
  calculations;
- anyone can read shared yields;
- no document ever holds a public email.

Firestore's offline cache is the offline store and sync.

## Consequences

- Delete `api/`, `server/`, `shared/`, the SQLite database, the Neon database,
  the legacy JWT login and register endpoints, and the custom sync layer
  (`localRepository.js`, `syncCoordinator.js` and helpers).
- The "make every API change in both backends" rule goes away.
- Excel/CSV import parses in the browser.
- The community dataset is also published as a CSV/JSON file so other tools
  can use it without Firestore.
- Contributor profile pages and publishing saved calculations publicly are
  dropped; neither is one of an account's two jobs.
- The app bundles the Firebase SDK, which is larger than today's REST calls.
- Local development and CI use the Firebase emulators.

## Alternatives considered

- **Supabase** (Postgres + auth + row-level security): about as simple, but
  free projects pause after a week idle, and it would change the sign-in
  system a third time.
- **Keep Neon, delete the Express/SQLite backend**: smallest change, but we'd
  still own API code, token verification and a custom sync engine.
- **Firebase SQL Connect** (proved in `dataconnect/`): needs a paid Cloud SQL
  instance; more than this app needs.
