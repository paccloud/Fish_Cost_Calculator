# Firebase SQL Connect Proof

Issue #65 adds an isolated Firebase SQL Connect sandbox under `dataconnect/`.
It is a proof path only; it does not replace the existing Neon, Stack Auth, or
Vercel API behavior.

Issue #66 extends that sandbox with a Firebase Auth identity-mapping proof. The
new files remain isolated under `dataconnect/` and do not add Firebase Auth as a
third production auth path.

## Scope

- Model one public calculator/community read path in SQL Connect.
- Model how a signed-in Firebase Auth user maps to one canonical app user for
  future protected operations.
- Keep all schema and operations under `dataconnect/`.
- Avoid production secrets, service account keys, database URLs, and production
  data.
- Do not add Firebase runtime dependencies to the app until a later migration
  issue approves them.

## Files

- `dataconnect/firebase.proof.json`: Firebase CLI config for this proof only.
- `dataconnect/dataconnect.yaml`: SQL Connect service, Cloud SQL database, and
  connector layout.
- `dataconnect/schema/public_calculator.gql`: Relational schema for published
  species and published yield conversions.
- `dataconnect/schema/identity_mapping.gql`: Proof schema for canonical app
  users, Firebase UID mappings, and user-owned saved calculation rows.
- `dataconnect/public/queries.gql`: Public read operations protected with
  `@auth(level: PUBLIC)`.
- `dataconnect/public/connector.yaml`: Optional generated web SDK target that
  writes into `dataconnect/public/generated/public` and does not install into
  `app/package.json`.
- `dataconnect/identity/queries.gql`: Protected identity proof operations using
  `@auth(level: USER)`, `auth.uid`, and ownership filters.
- `dataconnect/identity/connector.yaml`: Optional generated web SDK target that
  writes into `dataconnect/identity/generated/identity` and does not install
  into `app/package.json`.
- `dataconnect/.gitignore`: Keeps local emulator caches, logs, and generated
  SDK output out of source control for this proof.

## Firebase Project Expectations

Use a non-production Firebase project for this proof. The project should have
SQL Connect enabled and should point at a disposable Cloud SQL for PostgreSQL
database. Suggested sandbox resource names are:

- SQL Connect service ID: `fish-cost-calculator-sandbox`
- Location: `us-central1`
- Cloud SQL instance ID: `fish-cost-calculator-sandbox`
- PostgreSQL database: `fish_cost_calculator_sandbox`

The checked-in files intentionally contain only resource names. They do not
contain credentials, connection strings, service account JSON, or production
data.

## Local Validation

The Firebase CLI should be installed locally, but it is not added to this repo
as a production dependency.

From the repository root:

```sh
cd dataconnect
firebase --config firebase.proof.json dataconnect:sdk:generate
firebase --config firebase.proof.json emulators:start --only dataconnect
```

The emulator uses a local PGlite database, so the schema and operations can be
prototyped without touching production Neon data. The generated SDK output is
kept under the proof directory and should not be imported by the existing app in
this issue.

For web SDK setup in a later issue, Firebase's SQL Connect flow supports:

```sh
firebase init dataconnect:sdk
firebase dataconnect:sdk:generate
```

Do not run SDK initialization against `app/package.json` until production
Firebase dependencies are approved.

## Public Read Operations

`ListPublicCalculatorYieldPaths` lists published yield conversions with species
metadata for calculator/community browsing.

`GetPublicSpeciesYieldPaths` lists published conversions for one published
species slug.

Both operations are public by design and only expose published reference data.
Future user-owned operations should use Firebase Auth data such as `auth.uid`
inside authorization filters instead of accepting caller-supplied user IDs.

## Firebase Auth Identity Mapping

The proof uses `CanonicalAppUser` as the stable application user table. A row in
`FirebaseAuthIdentity` links one Firebase Auth UID to one canonical app user.
Protected operations derive the caller identity from `auth.uid`; callers never
provide a Firebase UID.

The intended production contract for a later migration is:

1. Every migrated account gets exactly one `CanonicalAppUser.id`.
2. Every Firebase Auth account UID is represented by exactly one
   `FirebaseAuthIdentity.firebaseUid` row.
3. Password users and OAuth users can point at the same canonical app user when
   they are the same app account.
4. Protected SQL Connect operations use `@auth(level: USER)` and filter by
   `auth.uid` or by a canonical user ID that has first been constrained through
   the caller's `FirebaseAuthIdentity` row.
5. The current Neon, Stack Auth, Vercel API, and JWT auth code remains the
   production path until a separate migration issue explicitly rewires runtime
   behavior and approves Firebase dependencies.

`ResolveCurrentCanonicalUser` proves the main happy path: a signed-in Firebase
Auth user can resolve their canonical app user through
`FirebaseAuthIdentity.firebaseUid == auth.uid`.

`AssertCanonicalUserOwnership` proves the cross-user guard: even when a caller
passes a canonical app user ID, the operation only returns a row when that ID is
linked to the caller's Firebase UID.

`ListMyIdentityProofSavedCalculations` and
`GetMyIdentityProofSavedCalculation` prove ownership filters on user-owned rows.
They reject unauthenticated callers through `@auth(level: USER)` before SQL runs
and only return rows with `ownerFirebaseUid == auth.uid`.

`CreateMyIdentityProofSavedCalculation` is a transactional proof mutation. It
checks that the signed-in Firebase UID maps to exactly one canonical app user,
then writes a saved calculation proof row with both the derived canonical
`appUserId` and the server-derived `ownerFirebaseUid`. The caller supplies only
calculator metadata, not user identity.

## Migration Assumptions

Password migration should use Firebase Auth import or a controlled reset flow so
the resulting Firebase UID can be linked once to the existing app user. The
legacy app user identifier can be retained in `CanonicalAppUser.legacyUserId`
for reconciliation, but new protected operations should authorize through
Firebase Auth UID mapping rather than trusting that legacy ID from a request.

OAuth migration should link each provider account to the same canonical app user
when the current app treats those identities as one account. Provider details
belong in `FirebaseAuthIdentity.providerId`, `providerSubject`, and
`emailAtLink` for audit and reconciliation. Email alone is not a sufficient
ownership proof when linking OAuth identities.

The proof assumes migration writes are performed by a trusted backfill or admin
path outside these user-facing operations. User-facing SQL Connect operations
must not create arbitrary Firebase UID mappings for themselves.

## Issue #66 Validation Expectations

- Successful identity mapping: seed one `CanonicalAppUser` row and one matching
  `FirebaseAuthIdentity.firebaseUid`, authenticate as that Firebase UID, and run
  `ResolveCurrentCanonicalUser`.
- Unauthenticated rejection: run any `dataconnect/identity/queries.gql`
  operation without Firebase Auth; `@auth(level: USER)` should reject it before
  protected SQL executes.
- Cross-user rejection: authenticate as Firebase UID A and call
  `AssertCanonicalUserOwnership` with canonical app user B; the operation should
  return no identity row.

## Saved Calculations

Issue #67 adds a production-shaped `SavedCalculation` proof table. It is
separate from the earlier `IdentityProofSavedCalculation` table and models the
future migrated saved-calculation path more directly.

Saved-calculation operations live in
`dataconnect/saved-calculations/queries.gql` and are all authenticated with
`@auth(level: USER)`. They derive ownership from `auth.uid`, never from a
caller-supplied Firebase UID.

- `ListMySavedCalculations` lists only rows whose `ownerFirebaseUid` matches
  `auth.uid`, newest first.
- `GetMySavedCalculation` filters by both calculation ID and `auth.uid`.
- `CreateMySavedCalculation` resolves the caller's canonical app user through
  `FirebaseAuthIdentity.firebaseUid == auth.uid`, then writes a row with the
  derived `appUserId` and server-derived `ownerFirebaseUid`.
- `ImportMyLegacySavedCalculationProof` adds migration-shape fields such as
  `legacyCalculationId` and `legacyOwnerUserId`.
- `DeleteMySavedCalculation` checks ownership in the same transaction before
  deleting.

`dataconnect/saved-calculations/migration-fixture.example.json` documents the
sample no-production-data shape for moving legacy saved calculation rows into
the SQL Connect proof model.

## Custom Yield Data

Issue #68 adds `CustomYield` proof rows under
`dataconnect/schema/custom_yields.gql` and custom-yield operations under
`dataconnect/custom-yields/queries.gql`.

The custom-yield proof mirrors the current app's user-owned custom yield data:

- `CreateMyCustomYield` derives the canonical app user and owner Firebase UID
  from the authenticated caller.
- `ListMyCustomYields` and `GetMyCustomYield` filter by
  `ownerFirebaseUid == auth.uid`.
- `DeleteMyCustomYield` uses an ownership-constrained delete filter.
- `legacyUserDataId` and `localYieldId` preserve migration and local-sync
  reconciliation hooks.

The proof does not replace the existing IndexedDB sync engine. Auth or network
failures must continue preserving pending local records until a later runtime
migration explicitly changes that behavior.

## Contributor Profiles And Community Reads

Issue #69 adds contributor/community proof rows under
`dataconnect/schema/community_profiles.gql` and operations under
`dataconnect/community/queries.gql`.

Private contributor profile operations are authenticated with
`@auth(level: USER)` and derive ownership from `auth.uid` through the
`FirebaseAuthIdentity` mapping:

- `GetMyContributorProfile`
- `GetMyContributorProfileById`
- `CreateMyContributorProfile`
- `UpsertMyContributorProfile`
- `UpdateMyContributorProfile`

Public community operations are authenticated with `@auth(level: PUBLIC)` and
only expose intentionally public fields:

- `ListPublicContributorProfiles`
- `GetPublicContributorProfile`
- `ListPublicCommunityCalculations`
- `GetPublicCommunityCalculation`

Public contributor reads filter to `showOnPage == true`. Public community
calculation reads filter to `isPublished == true` and omit `ownerFirebaseUid`,
canonical app user IDs, and legacy owner IDs. `contributionCount` is represented
as a public ordering/display field and is not user-editable through the profile
mutations.

## Combined Validation

The combined proof has been validated with the Firebase SQL Connect emulator:

```sh
firebase --config dataconnect/firebase.proof.json \
  --project demo-fish-cost-calculator \
  emulators:exec --only dataconnect true
```

The validation intentionally uses a `demo-` project and local emulator state.
Generated SDK output and emulator caches are ignored by `dataconnect/.gitignore`
and should not be committed for this proof.
