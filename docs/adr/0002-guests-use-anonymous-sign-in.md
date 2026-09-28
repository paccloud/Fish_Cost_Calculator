# 2. Guests use Firebase anonymous sign-in

Date: 2026-09-28
Status: Accepted

## Context

The calculator works without an account, and people should be able to save
custom yields and calculations before deciding to sign up. Today the app keeps
guest data in the browser and runs its own code to copy it into the account on
sign-in (`guestAdoption.js`, `legacyMigration.js`).

## Decision

The first time a guest saves something, sign them in anonymously with Firebase
Auth. Their data lives in Firestore under that anonymous user, with the same
security rules as any account. When they sign in with Google or email, link the
new credential to the anonymous user so the data stays with them.

Nothing is saved until the guest's first save, so people who only use the
calculator never get an account.

## Consequences

- Delete the guest-adoption and legacy-migration code.
- Clearing browser data loses a guest's data, as it does today.
- Unused anonymous accounts accumulate in Firebase and may need occasional
  cleanup.
- Sharing to the community dataset requires a non-anonymous account, so every
  shared yield has a real owner.

## Alternatives considered

- **Sign in to save anything**: simplest, but loses "save first, sign up later".
- **Keep browser-only guest storage and copy on sign-in**: today's approach;
  custom code we'd have to maintain.
