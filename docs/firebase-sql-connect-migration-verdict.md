# Firebase SQL Connect Migration Verdict

Parent PRD: https://github.com/paccloud/Fish_Cost_Calculator/issues/64

## Verdict

Do not proceed with a full production migration yet.

Proceed with Firebase Auth plus Firebase SQL Connect as the preferred next
runtime-integration candidate, but keep the current Neon, Stack Auth/JWT, Vercel
API, and IndexedDB sync production path until a second phase proves generated
SDK or server-wrapper integration in the app.

## What The Proof Demonstrated

- Firebase SQL Connect can model the Fish Cost Calculator's relational shape:
  public species/yield references, canonical app users, Firebase UID mappings,
  saved calculations, custom yield data, contributor profiles, and public
  community calculation snapshots.
- Firebase Auth ownership can be represented in SQL Connect operations with
  `@auth(level: USER)`, `auth.uid`, and canonical-user lookup through
  `FirebaseAuthIdentity`.
- Public reads can be separated from private operations with
  `@auth(level: PUBLIC)`, explicit published/visible filters, and field
  selection that omits owner identity fields.
- Existing Neon-backed runtime code can remain untouched while the SQL Connect
  proof lives under `dataconnect/`.
- The combined proof compiles in the Firebase SQL Connect emulator using a demo
  project and no production data.

## What The Proof Did Not Demonstrate

- It did not add Firebase production dependencies to the React app.
- It did not generate or import SQL Connect SDK code into app runtime.
- It did not replace Vercel API routes, the Neon adapter, Stack Auth, JWT auth,
  or local SQLite development.
- It did not prove end-to-end browser login, generated SDK calls, or live
  Firebase Auth tokens.
- It did not replace the existing IndexedDB sync engine.
- It did not migrate production Neon data.

## Comparison To Current Architecture

The current architecture already has a good relational fit in Neon PostgreSQL.
Firebase SQL Connect does not win because it is "more relational" than Neon; it
wins only if platform consolidation is worth the migration.

Firebase Auth plus SQL Connect could reduce auth complexity by replacing the
custom JWT plus Stack Auth split with one identity source. It could also reduce
some server/API ownership boilerplate if generated SQL Connect operations become
the runtime boundary.

The current Neon/Vercel path remains lower risk today because it is already wired
into the app, tests, sync engine, public endpoints, and production deploy path.
The SQL Connect proof is credible but still isolated.

## Cost Drivers

Firebase SQL Connect cost has two relevant parts:

- SQL Connect service usage and generated-operation traffic.
- The Cloud SQL for PostgreSQL instance behind SQL Connect.

That means the cost decision should not be compared only against Firebase Auth
or Firestore free-tier assumptions. A full migration should estimate expected
Cloud SQL baseline cost, SQL Connect operation volume, and any hosting changes.

## Runtime Integration Needed Next

Before a full migration decision, run one second-phase implementation issue:

- Get explicit approval for Firebase production dependencies in the React app.
- Generate the SQL Connect SDK for one connector.
- Wire one non-production route or feature-flagged path through Firebase Auth and
  SQL Connect.
- Prove browser auth, protected operation execution, public operation execution,
  and build/test compatibility.
- Compare generated-client usage against keeping server-side Vercel wrappers.

## Data Migration Requirements

A reversible production migration would need:

- A trusted backfill that creates one canonical app user for each existing app
  account.
- A deterministic mapping from password and OAuth identities to Firebase Auth
  UIDs.
- Saved calculation migration preserving legacy calculation IDs and owner user
  IDs.
- Custom yield data migration preserving legacy user data IDs and local sync IDs
  where available.
- Contributor profile migration preserving public visibility and contribution
  count behavior.
- A rollback plan where Neon remains authoritative until Firebase data parity is
  verified.

## Sync Engine Position

Keep the existing IndexedDB sync engine for now.

SQL Connect offers generated SDKs and caching patterns, but this proof did not
demonstrate Firestore-style offline persistence or a replacement for the app's
pending local record behavior. The current sync engine should stay until a
separate runtime proof shows that SQL Connect can safely preserve local pending
saved calculations and custom yield data across auth and network failures.

## Follow-Up Issues To Create If Continuing

- Approve Firebase runtime dependencies and wire one generated SQL Connect SDK
  path behind a non-production flag.
- Add emulator-backed operation tests with seeded Firebase Auth contexts for
  successful ownership, unauthenticated rejection, and cross-user rejection.
- Build a sanitized Neon-to-SQL-Connect migration fixture runner.
- Decide whether runtime access should use generated React clients directly or
  server-side wrappers that preserve the current API contract.

## Final Recommendation

Keep Neon and the current runtime path in production for now.

Continue with Firebase Auth plus Firebase SQL Connect only as a controlled
runtime-integration phase. The proof is strong enough to justify that next
phase, but not enough to justify a production database/auth migration yet.
