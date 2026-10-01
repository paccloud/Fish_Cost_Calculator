# Firestore: data shape, rules and emulators

The decisions behind this layout are in `docs/adr/0001-firebase-auth-and-firestore.md`;
the words are from `CONTEXT.md`. Issue #123 introduced the first collection; each
later slice adds its own paths here and in `firestore.rules`.

## Data shape

```
users/{uid}                                  reserved (the display name arrives with #128)
users/{uid}/customYields/{yieldId}           one document per custom yield
users/{uid}/savedCalculations/{calcId}       reserved for #126
communityYields/{yieldId}                    reserved for #128/#129: the public copy of an
                                             approved yield (species, from, to, yield,
                                             display name only), same id as the private one
```

### A custom yield

A custom yield is a **conversion** (starting form → finished product) on a species,
with a **yield** above 0 and up to 100 and an optional private source note.

| Field       | Type      | Rule                                                                 |
|-------------|-----------|----------------------------------------------------------------------|
| `ownerUid`  | string    | equals the `{uid}` in the path. Kept in the document so later slices can query across owners (`collectionGroup`) and the rules can tie the record to its owner. |
| `species`   | string    | 1–120 characters after trimming                                      |
| `from`      | string    | the starting form, up to 80 characters; may be blank for a yield copied from Neon (#131) or imported without one (#127). The calculator only offers a yield that has a starting form. |
| `to`        | string    | the finished product, 1–80 characters                                |
| `yield`     | number    | above 0 and up to 100 (a percentage, never a fraction)               |
| `source`    | string    | private note, up to 500 characters, `''` when absent                 |
| `status`    | string    | `'private'` in this slice. #128 adds `submitted`, `approved`, `rejected`, with the review note and submission details on this same private document. |
| `createdAt` | timestamp | set by the server on create, never changed                           |
| `updatedAt` | timestamp | set by the server on every write                                     |

Document ids are Firestore auto-ids. Every write sends the whole document: the rules
check the exact field list, so a partial update is refused. The client validates with
`app/src/lib/customYield.js`, which mirrors the rules, so a write queued offline never
fails validation once it reaches the server.

## Rules layout (`firestore.rules`)

- Helpers: `signedIn()`, `isOwner(uid)`, `str(value, max)`, `validCustomYield(data, uid)`.
- `users/{uid}/customYields/{yieldId}`: read, create, update and delete for the owner
  only. Create requires `createdAt == request.time`; update requires `createdAt`
  unchanged. Both require `updatedAt == request.time`, which `serverTimestamp()`
  satisfies even for writes that were queued offline.
- A closing `match /{document=**} { allow read, write: if false; }` keeps every
  reserved path shut until its slice opens it.

Later slices extend this file rather than replacing it: #125 adds caps and
sign-in-provider checks inside `validCustomYield`, #126 copies the owner-only block for
saved calculations, #128 adds the reviewer check, the status transitions and the
`communityYields` match.

The rules tests are in `app/test/rules/customYields.rules.test.js`.

## Offline cache and sign-out

The browser uses Firestore's persistent cache (`persistentLocalCache` with the
multi-tab manager, `app/src/lib/firebase.js`). A write made offline shows up at once
with `pending: true` and reaches Firestore when the connection returns; a reload in
between keeps it.

The cache keeps a person's private data in the browser after sign-out, so signing out
(`app/src/lib/firebaseSignOut.js`) stops the listeners, waits for pending writes, and
if they do not arrive within eight seconds asks whether to keep waiting or to discard
them. It then signs out, terminates the Firestore instance, clears its IndexedDB
cache and starts a fresh instance. If another tab still holds the database open the
cache cannot be cleared; the page says so, and the next sign-out clears it.

Manual check of the offline path (DevTools → Network → Offline): add a yield on
My data, reload, confirm it is still listed with "Not yet saved to the cloud", go
online, and see the document appear in the Emulator UI (http://127.0.0.1:4000).

## Emulators

`firebase.json` configures the Auth (9099) and Firestore (8080) emulators and the
Emulator UI (4000). Everything runs under the `demo-local-catch` project id: a `demo-`
project never reaches a real Firebase project and needs no credentials.

```bash
cd app
npm run emulators       # Auth + Firestore emulators with the UI
npm run dev             # .env.development points the app at them
npm run test:emulated   # rules tests + repository tests, emulators started around them
npm run deploy:rules    # owner only, after `npx firebase login`
```

The Auth emulator shows a fake Google account picker, so no real Google account is
needed locally. The Firestore emulator is a Java program (Java 21 or later). CI runs
`npm run test:emulated` in the `Rules · Emulator tests` job.

Against the real project, the owner enables Cloud Firestore and the Google sign-in
provider in the Firebase console, adds the app's domains under Auth → Authorized
domains, and deploys the rules with `npm run deploy:rules`.
