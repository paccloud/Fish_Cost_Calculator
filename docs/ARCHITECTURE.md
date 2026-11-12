# Architecture Overview

This document provides a technical overview of the Local Catch Fish Yield Calculator architecture.

> **This stack is being replaced.** [ADR 0001](adr/0001-firebase-auth-and-firestore.md) replaces everything on the server side of this document (`api/`, `server/`, `shared/`, SQLite, Neon, the legacy password login and the sync layer) with Firebase Auth, Cloud Firestore and Firebase Hosting, reached directly from the browser. The work is tracked in issues #123–#133. Until it lands, this is how the app works, and the backends get fixes only.

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     BROWSER (app/, a PWA)                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                 React 19 + Vite 7                      │  │
│  │  Calculator   My data / Upload   Community   Sign-in   │  │
│  │                                                        │  │
│  │  fish_data_v3.js  89 species, bundled with the app     │  │
│  │  calcEngine.js    all yield and cost math              │  │
│  │  IndexedDB        saved calculations and custom yields │  │
│  └───────────┬───────────────────────────────┬────────────┘  │
└──────────────┼───────────────────────────────┼───────────────┘
               │ REST, /api/*                  │ REST
               ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ API                          │   │ Firebase Auth            │
│  production: api/*.js        │   │  email/password, Google  │
│    Vercel functions + Neon   │   │  issues the ID token     │
│  local: server/server.js     │   └──────────────────────────┘
│    Express + SQLite          │
│  both call shared/handlers/  │
└──────────────────────────────┘
```

There are two backends. `api/` runs in production on Vercel against Neon PostgreSQL. `server/server.js` is for local development only and uses a SQLite file. Most endpoint logic is written once in `shared/handlers/` and called by both through a database adapter (`api/_lib/neonDb.js` and `server/adapters/sqliteDb.js`). Routing, file upload and export are still written separately in each backend.

## Data Flow

### 1. Reference yields

```
fish_data_v3.js ──────────────► Calculator.jsx
                                 └── species, From → To conversions, yield %
GET /api/fish-data ── if it returns usable conversions, replaces the bundled copy
```

The reference yields ship inside the app, so the calculator works with no backend and offline.

### 2. Sign-in

```
Login.jsx → Firebase Auth REST (firebaseRestAuth.js) → ID token + refresh token
                                                        ↓
                                                   AuthContext
                                                        ↓
                              Authorization: Bearer <ID token> on /api calls
```

- The app talks to Firebase Auth over its REST endpoints. There is no Firebase SDK in the bundle.
- The session is kept in `localStorage` under `firebaseAuthSession` and the ID token is refreshed before it expires.
- The API verifies the ID token against Firebase's public certificates (`api/_lib/firebase-auth.js`) and maps the Firebase user to a row in its own `users` table, creating the row on first sign-in.
- Accounts made before Firebase Auth can still sign in with a username and password through `POST /api/login`, which returns a JWT. The app uses this for a sign-in name with no `@` in it, and as a fallback when Firebase rejects an email sign-in.

### 3. Saved calculations and custom yields

```
My data (custom yields: add, edit, delete; publish a calculation)
        ↓
DataContext.jsx → localRepository.js → IndexedDB        (one store per account)
        ↕ when signed in and online
syncCoordinator.js → apiClient.js → /api/saved-calcs, /api/user-data → SQLite or Neon

Calculator "Save" ──► POST /api/save-calc     (straight to the API; the sync pulls it back)
Upload ─────────────► POST /api/upload-data   (straight to the API; the sync pulls it back)
```

- Saving, My data and Upload all ask for sign-in. The storage layer also has a guest store, which older versions of the app wrote to; when someone signs in, the app offers to move any guest records it finds into the account.
- Custom yields carry a revision number. An update or delete with a stale revision gets `409`, and the app asks which copy to keep.
- `fishDataMerge.js` layers custom yields over the reference yields for the calculator.

### 4. Community data

```
My data → POST /api/user-data/:id/share → user_data.is_shared
Community page ← GET /api/community-data (JSON, or CSV with ?format=csv)
```

The public feed never includes account identifiers. A display name and organization appear only when the owner has a contributor profile with "show on page" turned on.

## Key Components

### Frontend Components

| Component                | Purpose                                         | Key Dependencies                         |
| ------------------------ | ----------------------------------------------- | ---------------------------------------- |
| `Calculator.jsx`         | Main calculation interface (`/`)                | fish_data_v3, calcEngine, DataContext    |
| `DataManagement.jsx`     | Custom yields: add, edit, delete, share, export | DataContext, apiClient                   |
| `UploadData.jsx`         | Excel/CSV import                                | AuthContext, DataContext, FormData       |
| `CommunityData.jsx`      | Community dataset, search and CSV download      | fetch API                                |
| `DataTransparency.jsx`   | Data sources and contributors                   | fish_data_v3 (DATA_SOURCE)               |
| `ContributorProfile.jsx` | Display name, organization, bio                 | AuthContext                              |
| `Login.jsx`              | Sign in and sign up                             | AuthContext                              |
| `About.jsx`              | Project info, support                           | -                                        |
| `MoveNotice.jsx`         | Banner for the move to Firebase                 | config/move.js                           |

`AuthContext.jsx` holds the signed-in user. `DataContext.jsx` holds saved calculations, custom yields and sync state, and renders the guest-adoption, sign-out, conflict and recovery dialogs. `ThemeContext.jsx` holds the light or dark theme.

### Data Structures

#### fish_data_v3.js

```javascript
// Species entry structure (FISH_DATA_V3)
{
  "Species Name": {
    scientific_name: "Latin name",
    category: "Category",
    conversions: {
      "From State → To State": {
        yield: 45,        // Average yield %
        range: [40, 50]   // Min/Max range; missing for about half the conversions
      }
    }
  }
}

// Legacy format (FISH_DATA, generated from the above for backward compatibility)
FISH_DATA[species].conversions[product] = {
  yield: "45",
  range: "40-50",
  from: "Round",
  to: "Fillets"
}
```

### API Authentication

All protected endpoints require:

```
Authorization: Bearer <firebase_id_token_or_legacy_jwt>
```

The API tries the token as a Firebase ID token first. Handlers then receive:

```javascript
req.user = { id, username, email, authProvider: 'firebase' }
```

where `id` is the API's own `users.id`, not the Firebase UID. A legacy JWT carries `{ id, username }` and is accepted only while `JWT_SECRET` is set.

## Security Considerations

1. **Tokens** - Firebase ID tokens are checked for signature, issuer and audience against `FIREBASE_PROJECT_ID`.
2. **Legacy passwords** - Stored as bcrypt hashes (cost 10). `JWT_SECRET` comes from the environment; without it the production API refuses legacy logins.
3. **CORS** - Both backends allow only the origins in `ALLOWED_ORIGINS` (plus the deployment's own `VERCEL_URL`).
4. **Rate limiting** - The local Express server allows 300 requests per minute per IP on `/api`. The Vercel functions have no rate limit of their own.
5. **Public output** - The community and contributor feeds send an allowlist of fields. CSV exports prefix cells that start with `=`, `+`, `-` or `@` so a spreadsheet does not run them as formulas.
6. **Uploads** - `.xlsx` and `.csv` only, 4 MB at most.
7. **Secrets** - `node scripts/check-secrets.mjs` runs in CI on every pull request. See [`SECURITY_NOTICE.md`](../SECURITY_NOTICE.md) for the credential that leaked in the past and [`SECURITY.md`](../SECURITY.md) for how to report a problem.
8. **Read-only mode** - `API_READ_ONLY=true` makes both backends refuse every write except sign-in. See [`move-runbook.md`](move-runbook.md).

## What Changes Next

The earlier list of future improvements is done or dropped: production runs on PostgreSQL, there are tests and a CI pipeline, and the local server is rate-limited. What comes next is set by [ADR 0001](adr/0001-firebase-auth-and-firestore.md) through [ADR 0004](adr/0004-community-dataset-cc-by.md) and the [November 2026 product audit](reviews/2026-11-product-audit.md): the backends on this page are deleted, and the app ships on iOS through Capacitor.
