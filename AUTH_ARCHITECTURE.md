# Auth Architecture

The application now uses Firebase Auth for browser sign-in while preserving the
existing Neon PostgreSQL `users` table as the app-owned identity map.

## Current System

### Firebase Email/Password Auth

- The React login form signs in and registers users through Firebase Auth REST
  endpoints.
- The frontend stores the Firebase refresh token and current ID token in
  `localStorage` under `firebaseAuthSession`.
- API calls send the Firebase ID token as `Authorization: Bearer <idToken>`.
- The frontend refreshes expiring Firebase ID tokens before using them for sync
  or protected API calls.

### API Verification

- Protected Vercel functions use `requireAuth()` from `api/_lib/auth.js`.
- `requireAuth()` verifies Firebase ID tokens against Firebase public
  certificates and requires issuer/audience to match `FIREBASE_PROJECT_ID`.
- Local Express development uses the same Firebase verifier so Vite-proxied API
  calls match production behavior.
- Legacy password JWTs are still accepted as a temporary compatibility path, but
  the active React UI no longer creates them.

### Local User Mapping

Neon PostgreSQL remains the application database. Firebase users are mapped to
local users by `users.firebase_uid` first, then by email when the existing local
user is not linked to another Firebase UID.

Protected routes still receive `req.user` with:

```js
{ id, username, email, authProvider: 'firebase' }
```

User-owned data continues to key off the app-owned user ID:

- `calculations.user_id`
- `user_data.user_id`
- `contributors.user_id`

## Required Environment

Frontend:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_STORAGE_BUCKET` (optional)

Backend:

- `FIREBASE_PROJECT_ID`
- `DATABASE_URL`
- `JWT_SECRET` only if the legacy `/api/login` JWT endpoint remains enabled

## Migration Notes

- Stack Auth frontend code and the `@stackframe/react` dependency have been
  removed.
- The old `/handler/*` Stack callback route has been removed.
- New Firebase users are linked to existing local users by email so saved
  calculations, custom yield data, and contributor profiles can continue to
  attach to the same `users.id`.
- Google/GitHub provider sign-in should be implemented with the Firebase Web SDK
  or provider-specific OAuth bridge if social auth is reintroduced.
