# Auth Migration Roadmap: Stack Auth → Better Auth + Cloudflare

> Tracking issue: [#15](https://github.com/paccloud/Fish_Cost_Calculator/issues/15)
> Related: [#14](https://github.com/paccloud/Fish_Cost_Calculator/issues/14) (redirect URL bug)

## Executive Summary

Migrate from Vercel + Stack Auth to Cloudflare Pages/Workers + Better Auth, keeping Neon PostgreSQL. Consolidates the dual auth system (custom JWT + Stack Auth OAuth) into one. Target cost: **$0/month**.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────┐
│ Vercel                                              │
│                                                     │
│  ┌──────────────┐    ┌───────────────────────────┐  │
│  │ React SPA    │    │ Serverless Functions (api/)│  │
│  │              │    │                           │  │
│  │ StackProvider│───>│ requireAuth()             │  │
│  │ AuthContext  │    │  ├─ JWT verify (password) │  │
│  │              │    │  └─ Stack Auth verify     │──│──> api.stack-auth.com
│  └──────────────┘    │      (OAuth fallback)     │  │
│                      │                           │  │
│                      │ @neondatabase/serverless  │──│──> Neon PostgreSQL
│                      └───────────────────────────┘  │
│                                                     │
│  Integrations: Neon x2, Clerk x1 (unused)           │
└─────────────────────────────────────────────────────┘
```

### Auth Flow Today

1. **Password login:** Frontend → `POST /api/login` → bcrypt verify → JWT token → localStorage
2. **OAuth login:** Frontend → Stack Auth SDK → Google/GitHub → `/handler/*` callback → cookie session
3. **API auth:** `requireAuth()` checks JWT first, falls back to Stack Auth session via `api.stack-auth.com/api/v1/users/me`
4. **User linking:** OAuth users linked to password accounts by email match

### Pain Points

- Stack Auth configured through Vercel integration panel (not portable)
- Duplicate Neon integrations + unused Clerk integration
- Two separate auth systems to maintain
- Stack Auth redirect URL errors on new domains (#14)
- No password reset flow
- No JWT revocation mechanism

---

## Target Architecture

```
┌─────────────────────────────────────────────────────┐
│ Cloudflare                                          │
│                                                     │
│  ┌──────────────┐    ┌───────────────────────────┐  │
│  │ Pages        │    │ Workers (API)             │  │
│  │ React SPA    │    │                           │  │
│  │              │───>│ Better Auth middleware     │  │
│  │ Better Auth  │    │  ├─ Email/password        │  │
│  │ React plugin │    │  ├─ Google OAuth          │  │
│  │              │    │  └─ GitHub OAuth          │  │
│  └──────────────┘    │                           │  │
│                      │ Hyperdrive ───────────────│──│──> Neon PostgreSQL
│                      └───────────────────────────┘  │
│                                                     │
│  No external auth API calls. All auth in-Worker.    │
└─────────────────────────────────────────────────────┘
```

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| Hosting | Vercel | Cloudflare Pages + Workers |
| Auth (OAuth) | Stack Auth via Neon integration | Better Auth (self-hosted in Worker) |
| Auth (password) | Custom JWT + bcrypt | Better Auth email/password plugin |
| Auth verification | External API call to stack-auth.com | Local session check in Worker |
| DB connection | `@neondatabase/serverless` (HTTP) | Cloudflare Hyperdrive (TCP pooling) |
| Auth data | Stack Auth managed + custom `users` table | Better Auth tables in Neon |

### What Stays the Same

- Neon PostgreSQL (same database, same data)
- React frontend (same components, routing, UI)
- API endpoint structure (`/api/save-calc`, `/api/user-data`, etc.)
- Fish yield data (`fish_data_v3.js`) and calculation logic
- User data tables (calculations, user_data, contributors)

---

## Phase 0: Cleanup (Day 1)

**Goal:** Fix immediate issues, remove dead integrations.

| Task | Risk | Notes |
|------|------|-------|
| Fix Stack Auth trusted domains | None | Add production URL via Neon integration → Manage |
| Remove Clerk integration from Vercel | Low | Zero code references, possibly intercepting auth |
| Remove old Neon integration (12/19/24) | Low | Confirm it doesn't own env vars first |
| Document all current env vars and sources | None | Needed for CF migration |

**Verification:** OAuth login works on production domain.

---

## Phase 1: Better Auth Setup (Days 2-3)

**Goal:** Better Auth running locally alongside existing auth.

```bash
cd app && npm install better-auth @better-auth/react
```

### 1.1 Server-side config

Create `api/_lib/better-auth.js`:
- Connect to Neon via `DATABASE_URL`
- Configure email/password plugin
- Configure Google + GitHub OAuth providers
- Set session cookie options

### 1.2 Auth schema

Better Auth needs these tables (auto-created or manual):
- `ba_users` — id, email, name, image, emailVerified, createdAt, updatedAt
- `ba_sessions` — id, userId, token, expiresAt, ipAddress, userAgent
- `ba_accounts` — id, userId, providerId, providerAccountId, accessToken, refreshToken

**Key decision:** Use Better Auth's schema alongside existing `users` table during transition. Map via email.

### 1.3 Client-side config

Create `app/src/config/auth.js`:
```javascript
import { createAuthClient } from "@better-auth/react";
export const authClient = createAuthClient({ baseURL: "/api/auth" });
```

### 1.4 OAuth provider setup

- Create Google OAuth credentials (or reuse existing from Stack Auth)
- Create GitHub OAuth app (or reuse existing)
- Set callback URLs to new Better Auth endpoints

**Verification:** Can sign up, log in, and OAuth with Better Auth locally. Old auth still works.

---

## Phase 2: Backend Migration (Days 4-5)

**Goal:** All API endpoints use Better Auth for verification.

### 2.1 New auth middleware

Replace `requireAuth()` in `api/_lib/auth.js`:
```
Before: JWT verify → Stack Auth API call fallback
After:  Better Auth session verify (local, no external calls)
```

### 2.2 User migration strategy

```sql
-- Map existing users to Better Auth users by email
INSERT INTO ba_users (email, name, image)
SELECT email, username, avatar_url FROM users
WHERE email IS NOT NULL;

-- Link existing password users
INSERT INTO ba_accounts (userId, providerId, providerAccountId)
SELECT ba.id, 'credential', ba.id
FROM ba_users ba
JOIN users u ON u.email = ba.email
WHERE u.password IS NOT NULL;
```

**Foreign key mapping:** Update `calculations.user_id`, `user_data.user_id`, `contributors.user_id` to reference Better Auth user IDs, OR keep existing `users` table as the canonical source and add `ba_user_id` column.

### 2.3 Endpoint updates

All 8 protected endpoints use `requireAuth(handler)` — the middleware change handles them all. No individual endpoint changes needed if the middleware returns the same `{ id, username, email }` shape.

### 2.4 Remove old auth

- Delete `api/_lib/neon-auth.js`
- Delete `api/login.js` (Better Auth handles this)
- Delete `api/register.js` (Better Auth handles this)
- Simplify `api/_lib/auth.js`

**Verification:** All 8 protected endpoints work with Better Auth sessions. Password + OAuth login both work.

---

## Phase 3: Frontend Migration (Days 5-6)

**Goal:** Frontend uses Better Auth React SDK.

### 3.1 Replace providers

```diff
- import { StackProvider, StackTheme } from "@stackframe/react";
+ import { AuthProvider } from "./context/AuthContext";  // simplified

- <StackProvider app={stackClientApp}>
-   <StackTheme>
-     <App />
-   </StackTheme>
- </StackProvider>
+ <AuthProvider>
+   <App />
+ </AuthProvider>
```

### 3.2 Rewrite AuthContext

Replace dual JWT + Stack Auth session checking with:
```javascript
const { data: session } = authClient.useSession();
```

### 3.3 Update Login component

- Replace Stack Auth OAuth buttons with Better Auth `signIn.social()`
- Replace custom JWT login form with Better Auth `signIn.email()`
- Remove registration form (Better Auth `signUp.email()`)

### 3.4 Route cleanup

- Remove `/handler/*` Stack Auth callback route
- Add Better Auth callback route (if needed, or handled by SDK)

### 3.5 Remove Stack Auth dependencies

```bash
cd app && npm uninstall @stackframe/react
```

Delete:
- `app/src/config/neonAuth.js`

**Verification:** Full auth flow works — sign up, log in (password + OAuth), log out, cross-device session persistence, saved calculations load for correct user.

---

## Phase 4: Cloudflare Deployment (Days 7-9)

**Goal:** App runs on Cloudflare Pages + Workers.

### 4.1 Project setup

```bash
npm install wrangler
npx wrangler pages project create fish-cost-calculator
```

### 4.2 wrangler.toml

```toml
name = "fish-cost-calculator"
compatibility_flags = ["nodejs_compat"]

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<hyperdrive-config-id>"
```

### 4.3 Hyperdrive setup

```bash
npx wrangler hyperdrive create fish-cost-db \
  --connection-string="postgresql://agent:...@ep-xxx.us-east-2.aws.neon.tech/neondb"
```

### 4.4 API migration

Convert Vercel serverless functions (`api/*.js`) to Cloudflare Workers format:
- Vercel: `export default function handler(req, res)`
- Workers: `export default { async fetch(request, env, ctx) }`

Options:
- **Hono** framework (lightweight, CF-native, Better Auth adapter exists)
- **itty-router** (minimal)
- Manual `fetch()` handler with routing

### 4.5 Environment variables

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put BETTER_AUTH_SECRET
```

### 4.6 Frontend deployment

```bash
cd app && npm run build
npx wrangler pages deploy dist
```

### 4.7 Custom domain

```bash
npx wrangler pages project add-domain fish-cost-calculator fishcostcalculator.com
```

**Verification:** Full app works on Cloudflare — auth, calculations, data persistence, cross-device sync.

---

## Phase 5: Cutover & Cleanup (Day 10)

| Task | Notes |
|------|-------|
| Verify all auth flows on CF | Password, Google, GitHub, logout, session persistence |
| Verify data operations | Save calc, load calcs, upload data, export |
| Migrate DNS (if custom domain) | Point to Cloudflare |
| Remove Vercel deployment | Or keep as staging |
| Remove Stack Auth env vars | From all environments |
| Remove Neon Vercel integrations | Both of them |
| Remove Clerk Vercel integration | Unused |
| Update `CLAUDE.md` | New architecture, commands, deployment info |
| Update `docs/ENVIRONMENT_VARIABLES.md` | New env var list |
| Update `docs/ARCHITECTURE.md` | New diagrams |

---

## Cost Comparison

| | Vercel (Current) | Cloudflare (Target) |
|--|-------------------|---------------------|
| Hosting | Free (Hobby) | Free (Pages) |
| Serverless | 100K req/mo free | 100K req/day free |
| Database | Neon free (0.5GB) | Neon free (0.5GB) |
| Auth | Stack Auth via Neon (60K MAU) | Better Auth (self-hosted, unlimited) |
| Connection pooling | Neon PgBouncer | Hyperdrive (free) |
| **Total** | **$0/mo** | **$0/mo** |

Cloudflare's free tier is significantly more generous (100K req/day vs 100K req/month), and auth is fully self-hosted with no MAU limits.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing users lose access | Medium | High | Email-based linking preserves accounts. Run parallel auth during transition. |
| OAuth credentials need recreation | Low | Low | Can reuse Google/GitHub OAuth apps, just update callback URLs |
| Better Auth CF Workers bugs | Low | Medium | Well-documented, active community. Fallback to Hono adapter. |
| Neon cold starts on CF | Low | Low | Hyperdrive connection pooling minimizes impact |
| bcrypt hashes incompatible | Low | Medium | Better Auth supports bcrypt. Can import existing hashes. |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep Neon PostgreSQL | Zero data migration, works on CF via Hyperdrive, generous free tier |
| Better Auth over Clerk | Free (self-hosted), no MAU limits, Neon Auth is built on it |
| Better Auth over Auth.js | Better CF Workers support, simpler API, active development |
| Hyperdrive over HTTP driver | Lower latency, native TCP pooling, recommended by both Neon and CF |
| Hono for API (suggested) | Lightweight, CF-native, Better Auth adapter, similar to Express |

---

## Timeline Estimate

| Phase | Duration | Can Parallelize? |
|-------|----------|-----------------|
| Phase 0: Cleanup | 1 day | No (do first) |
| Phase 1: Better Auth setup | 2 days | No |
| Phase 2: Backend migration | 2 days | Partially with Phase 3 |
| Phase 3: Frontend migration | 2 days | Partially with Phase 2 |
| Phase 4: CF deployment | 3 days | No (needs Phase 2+3) |
| Phase 5: Cutover | 1 day | No (do last) |
| **Total** | **~10 days** | |
