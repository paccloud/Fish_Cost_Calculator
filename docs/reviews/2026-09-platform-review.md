# Platform Review and Roadmap (September 2026)

Reviewed at commit `d6ee642` on 2026-09-28. Six parallel reviews covered design and UX, functionality and architecture, security and privacy, sign-up and auth, hosting economics and interoperability, and open-source and community readiness. Their key claims were checked against the code before being combined here.

> A separate security and privacy review was shared privately with the maintainer. Its fixes will land as ordinary PRs.

## Summary

| Area | State | Headline |
|---|---|---|
| Design & layout | Needs work | The teal-on-warm-paper palette is a strong base. Dark mode, the phone flow and form accessibility are broken, and the March 2026 brand spec was never implemented. |
| Core function | Broken in places | The calculator needs `/api/fish-data` to work at all. Publishing, the contributor profile and Excel percent import fail. |
| Sign-up | Needs work | Firebase email and Google sign-in work. There's no password reset. An open tab refreshes its token, but after a reload or reopening the installed app the session can expire within about an hour, because the refresh token is kept only in memory. There are no passkeys or email codes. |
| Hosting | Fragile | Roughly $0/month, but 11 of 12 Vercel Hobby functions are used, and Neon Free suspends the database when its compute quota runs out. |
| Open source | Not ready | CI, CodeQL and 2,197 tests exist. The README quick start crashes, and there's no data license, code of conduct or SECURITY.md. |

## 1. Functional bugs to fix first

| Bug | Where | Fix |
|---|---|---|
| The calculator dead-ends when `/api/fish-data` fails (offline, local dev, fresh deploys). None of the 655 bundled conversions has `from`/`to` fields, so the From dropdown is empty. Production also queries a `species_profiles` table that no script creates. | `app/src/components/Calculator.jsx:96,161`, `api/_lib/neonDb.js:199` | Derive from/to from the `"From → To"` keys at load time. Serve reference data as static JSON. Add a render test. |
| Publishing a calculation silently does nothing: `user?.getAuthHeaders?.()` doesn't exist, so the request returns 401 and the modal closes. | `app/src/context/DataContext.jsx:395,437` | Use `getAuthHeaders` from `useAuth()`, and show an error when publishing fails. |
| An Excel cell showing "42%" imports as 0.42%. Cells are stringified before the fraction check, which causes a ~100× cost error. The local server does the opposite. | `api/_lib/importRows.js:36,138`, `server/importRows.js` | Keep numeric cell values, add a real XLSX fixture test, and audit existing rows with yield ≤ 1. |
| The contributor profile loads blank in production because `/api/contributor/me` only exists in Express. `show_on_page === 1` is also false for Postgres booleans. | `app/src/components/ContributorProfile.jsx:24,54` | Call `/api/contributor` and use `Boolean(show_on_page)`. |
| Sync pull only adds records: edits from other devices never arrive, deletes leave ghost rows, and stale revisions cause spurious conflict dialogs. | `app/src/lib/localRepository.js:507-564` | Make pull server-authoritative for synced records. |
| The Calculator bypasses `DataContext`, so guests can't save, offline saves fail, and guest adoption is unreachable. | `Calculator.jsx:101-263` | Route saves and custom yields through `DataContext` and `calcEngine`. |
| Inputs aren't validated: yield 0 becomes 100%, and 420 and −42 are accepted. | `Calculator.jsx:221`, `shared/handlers/*` | Validate on both the client and the server. |

The core math is correct: hand-worked examples match the engine. Two open questions need a decision before labor and bulk tiers return to the UI:
- **Labor basis.** Labor is charged per output lb. If processors time lines per input lb, labor cost is understated by 58% at a 42% yield.
- **Bulk discount scope.** Bulk discounts apply to the whole cost stack, not just the purchase.

The reference-data audit found:
- 38 chained-yield inconsistencies larger than 5 points, likely OCR column drift.
- 16 of 18 rockfish sharing three identical tables.
- 48% of conversions with no range.
- Inconsistent state names (Round / Whole / Raw Whole).

## 2. Design and layout

**Keep:** the deep-sea teal and warm paper direction. Formalize it as tokens and rewrite the branding spec to match.

**Top problems:**
1. **Dark mode.** 50 of 55 `text-brand-teal` uses have no dark variant, so headings, $/lb, yield % and the Publish button sit at about 1.5:1 contrast.
2. **Phone flow.** After tapping Calculate on a phone, the result renders about 335 px below the fold, with no scroll or live region. Editing inputs leaves a stale result on screen.
3. **Sun-glare legibility.** Input borders are 1.4:1 and muted text is 2.6:1. Inputs are 14 px, so iOS zooms on focus. Touch targets are as small as 28 px.
4. **Accessibility.** No calculator label is tied to its control (axe critical). Tooltips work on hover only. The upload drop zone can't be reached by keyboard. axe found 114 contrast failures in light mode and 173 in dark.
5. **Navigation.** The signed-in desktop navbar collides and wraps. There are three "data" destinations plus Upload. Profile is hidden. Documented routes `/calculator`, `/roadmap` and `/submit-request` return 404.
6. **Calculator output.** It stops at cost per lb: no price across the yield range, no sell price at a margin, no copy or share, no recent species.

**Direction:**
- **Four destinations:** Calculate · My yields · Community · Account, as a bottom tab bar on mobile and one account menu on desktop.
- **Calculator:** updates as you type, with a searchable species picker and recent chips, and plain-language starting forms ("Whole", "Gutted, head-on", with trade codes as secondary text).
  - Product cards show yield %, with your own yields inline next to the standard ones.
  - A sticky price bar sits at the bottom on mobile.
  - A result card shows low/typical/high prices across the yield range, a cost breakdown, a sell price at a margin, and Copy / Share / Save.
- **Privacy:** one privacy pill and one share sheet everywhere. Purchase prices are off by default when sharing, and email is never used for attribution.
- **Tokens:**
  - Theme-aware `brand`: `#014457` light, `#6FC3CF` dark.
  - `text-3`: `#5A717B`.
  - `border-strong`: `#74898F`, for inputs at ≥3:1 contrast.
  - 16 px base type with tabular numerals.
  - Touch targets: 48 px for primary controls, 44 px elsewhere.
  - An optional high-contrast "outdoor" theme.

**Quick wins (under a day each):** dark-mode tokens, offline calculator, live and visible result, label and ARIA fixes, 16 px inputs, nav consolidation, favicon and PWA icons, and deleting or routing the orphaned `Footer`, `InstallPrompt`, `FeaturesRoadmap` and `SubmitRequest` components.

## 3. Architecture: one backend

Express + SQLite (`server/`) and the Vercel functions (`api/`) duplicate about 1,350 lines across two SQL dialects, and they have drifted. Differences include:
- publish routes
- upload parsing
- CSV export
- the contributor profile path
- CORS methods

Recommendation:
1. Move upload, export and community-data into `shared/handlers`.
2. Serve every route from one **Hono** app, which runs unchanged on Node, Vercel and Cloudflare Workers.
3. Use Postgres everywhere, with **PGlite** or Docker for local development and **dbmate** for plain-SQL migrations.
4. Parse spreadsheets in the browser.
5. Delete the SQLite server and adapter.

The "change both backends" rule then goes away, and Vercel function count stops being a constraint.

## 4. Sign-up and auth

**Recommended flow:**
1. Use the calculator as a guest.
2. At Save or Share, choose "Continue with Google", "Continue with Apple" or "Email me a 6-digit code".
3. Guest records carry over through the existing adoption flow.
4. Offer a passkey once.
5. Stay signed in.

Email codes beat magic links on phones, because links open outside the installed PWA. SMS or WhatsApp codes come later, only with demand and fraud controls.

**Phases:**

| Phase | Work | Effort |
|---|---|---|
| 0 | Close legacy registration, restrict the Firebase API key, and archive `docs/AUTH_MIGRATION_ROADMAP.md` as superseded. Before retiring legacy login and JWT verification, inventory the remaining password-only accounts (they can own calculations, yields and profiles) and move them to Firebase with a verified-email reset-and-link flow; `AuthContext.login()` still routes non-email usernames to `/api/login`. | 2–4 days |
| 1 (Firebase) | Persistent sessions (the refresh token is currently memory-only), password reset, social buttons on both tabs, Apple, smoother email verification, and Spanish and Vietnamese auth screens. | 6–10 days |
| 2 (provider-neutral) | Verify tokens with `jose` (`createRemoteJWKSet` + `jwtVerify`) configured by issuer, audience and JWKS URL. Add an `auth_identities (issuer, subject)` table, explicit linking rules (link by email only when verified by a trusted issuer), and Firebase Auth Emulator dev mode. | 4–6 days |
| 3 (suite identity) | When passkeys, email codes, team accounts, or sign-in for third-party (non-Firebase) tools are needed, adopt **Logto** (MPL-2.0; cloud free tier, self-host later), or **Better Auth** (MIT) if the team prefers to own the code. Add organizations with owner / manager / crew roles. | 6–10 days |

Firebase is fine today but can't be the end state. It has no native passkeys, no email-code sign-in (only magic links, capped on the free plan), and it isn't a general OIDC provider for third-party tools. Sibling apps registered in the same Firebase project can share its user store, so a second suite app alone doesn't require a migration.

**How auth works in an open-source project:**
- **What's public and what's secret.**
  - Firebase web API keys and OAuth client IDs are public by design. Restrict them to your domains.
  - Database URLs, OAuth client secrets, service-account keys and email/SMS keys belong only in the host's environment variables.
  - Never put secrets in a `VITE_*` variable, because those ship to every browser.
- **Each deployment owns its users.** Every deployment (the main site, a fork, a co-op's copy) creates its own auth project. Users belong to whoever runs that deployment. For a suite, the organization running it should own the domain, the identity tenant and the Google, Apple and Meta registrations, with at least two admins.
- **Local development.** Contributors should never need production credentials. The Firebase Auth Emulator with a `demo-*` project plus seeded users covers local development.
- **Forks.** Verify standard OIDC/JWKS tokens rather than one vendor's, so forks can plug in any provider through env vars.

## 5. Hosting and cost

| Option | ~100 MAU | ~1k MAU | ~10k MAU | Notes |
|---|---|---|---|---|
| Vercel Hobby + Neon Free (today) | $0 | $0* | $10–20 | *Neon may run out in peak months unless public reads are cached. Hobby is non-commercial only, one seat, 12 functions. |
| Vercel Pro + Neon | $20 | $20 | $30–40 | About $0 while Vercel Open Source Program credits last. |
| Cloudflare Workers + Hyperdrive → Neon | $0 | $0 | $0 + Neon | No function cap, commercial use allowed, 10 ms CPU per request on free. |
| VPS + Coolify + Postgres | $6–10 | $6–10 | $6–12 | One flat bill for a future suite; you handle backups and patching. |
| Supabase | $0 | $25 | $25 | Free projects pause after 7 idle days. |
| Firebase + Cloud SQL (SQL Connect) | ~$10 | ~$10–15 | ~$10–20 | No scale-to-zero. Close this track. |

Assumptions behind these figures: about 40 API requests per active user per month (two public reads per calculator visit, about 6 visits, plus sync for the roughly 30% who sign in), about 2 MB of static transfer per user (the PWA caches after the first visit), a database under 50 MB, and no CDN caching of public reads. Neon compute time is the only meter likely to bill at this scale, and caching public reads roughly halves it. Different traffic patterns can move these numbers a lot. Vendor figures came from web search on 2026-09-28. Check them before committing money.

**Now:**
- Add `Cache-Control` to public reads, or ship fish data as static JSON, so anonymous visits stop waking Neon.
- Add a Neon usage alert.
- Apply to the Vercel Open Source Program and the Neon Open Source Program.

**After the single-backend work**, choosing a host is a config change:
- **Vercel Pro**, if the open-source credits come through.
- **Otherwise, Cloudflare Workers** with Hyperdrive in front of Neon.

## 6. Interoperability for a harvester tool suite

Publish the data before building an API:
1. **Stable IDs.** Add `species_id` and `product_form_id`, cross-referenced to FAO ASFIS 3-alpha codes, WoRMS AphiaIDs and ITIS TSNs.
2. **Controlled vocabularies.**
   - Product forms mapped to the EU/FAO presentation codes (WHL, GUT, GUH, FIL, SKI…).
   - Explicit units (lb/kg) and currency (USD/CAD).
3. **Consent and license.** Record license consent (CC BY 4.0) on shared yields.
4. **Versioned dataset releases.**
   - A Frictionless Data Package (CSV plus `datapackage.json`) on GitHub Releases.
   - A Zenodo DOI and `CITATION.cff`.
   - Static JSON at `/data/v1/`.
5. **Programmable layer.**
   - An OpenAPI 3.1 `/api/v1` and `llms.txt`.
   - Shareable price links and QR price cards.
   - An embeddable `<localcatch-calculator>` web component.
   - A stateless remote MCP server.
   - Partner API keys and signed webhooks.
6. **"Publish my prices" integrations.**
   - First, CSV exports in each platform's import format.
   - Then Shopify (Admin GraphQL) and Square (Catalog API) pushes.
   - Align with the DFC standard used by Open Food Network.
   - Local Line, GrazeCart and Barn2Door are reachable mainly through Zapier or CSV. Harvie shut down at the end of 2024.

Keep traceability (GDST 1.2 / EPCIS 2.0) in a sibling "catch story" app. Under the FSMA Food Traceability Rule, covered entities handling finfish on FDA's Food Traceability List (Siluriformes such as catfish are excluded, and some entities qualify for exemptions) will need traceability records. FDA has proposed moving compliance to 2028-07-20, and Congress separately barred FDA from spending appropriated funds to administer or enforce the rule before that date.

Suggested suite layout, starting from `shared/` as a workspace root:
- **Packages:** `vocab`, `yield-data`, `calc-engine` (from `app/src/lib/calcEngine.js`), `ui` (web components), `api` (Hono) and `mcp`.
- **Apps:** the calculator (this repo) and the widget.
- **Shared services:** one identity provider with organizations, and one Postgres database.

## 7. Open source and community

**Repo health:**
- GitHub's community profile scores 57%.
- Missing: CODE_OF_CONDUCT (Contributor Covenant 3.0), SECURITY.md, and private vulnerability reporting.
- Missing: issue forms (bug, feature, yield submission, data correction), a PR template, Discussions and Dependabot.
- Missing: releases, and the CHANGELOG stops in Dec 2025.

**Contributor experience:**
- The README quick start crashes (`ERR_MODULE_NOT_FOUND: bcrypt`) because the `shared/` and root installs that CI runs are undocumented.
- The README says Node 18, but Vite 7 needs ≥ 20.19.
- Fix both with npm workspaces, `npm run setup`, `npm run dev`, `.nvmrc`, an emulator dev login, seed data, and a CI smoke test that boots the server.

**Data licensing:**

| Asset | Recommendation |
|---|---|
| Code | MIT. Fix `server/package.json` ("ISC"). |
| MAB-37-derived reference yields | Individual values are facts, very likely reusable with attribution. Remove the copyrighted PDF and full OCR text from `research/` and link the NOAA IR / Alaska Sea Grant copy instead. Ask Alaska Sea Grant for written permission and a review of the flagged values. |
| Community yields | CC BY 4.0 outbound, with contributor terms that allow relicensing through governance (the lesson from OpenStreetMap's 2012 relicense). Record `terms_version` and `consented_at` per row. |
| FishBase data | Don't import it. CC BY-NC conflicts with a tool for commercial fishers. |

**Community contribution model:**
- **Visibility per observation.** Four levels:
  - Private: the default.
  - Aggregate-only: the default when sharing.
  - Pseudonymous: a handle, never an email.
  - Named: by opt-in.
- **Community medians** for a species × cut are shown only with at least 5 contributors, with no contributor holding more than 50% of the weight and one vote per contributor.
- **Pool yields, not individual prices.** Any price benchmark must be aggregated and lagged, and cleared by counsel first.
- **Verification tiers:** Unverified → Plausible (automated checks) → Corroborated (3+ independent contributors agree) → Reviewed (a Sea Grant agent or data steward) → Flagged. Outliers are flagged, not rejected.
- **Structured observation schema:** species, from/to form, input/output weights, sample size, method, processor type, coarse region and season.
- **Quarterly dataset releases** with a DOI and contributor credits.

**Governance and partners:**
- Add GOVERNANCE.md: maintainer(s), a data steward (ideally from Sea Grant or LCN), a small fisher advisory group, and ADRs in `docs/adr/`.
- Replace localStorage roadmap voting with GitHub Discussions.
- The Local Catch Network (hosted by UMaine) was selected in August 2026 to lead outreach for the USDA Office of Seafood, which makes this a good time to formalize co-stewardship.
- Funding routes:
  - Open Collective via Open Source Collective.
  - NOAA Saltonstall-Kennedy.
  - Sea Grant.
  - USDA LAMP (seafood eligible).

**Reach:** Spanish first, then Vietnamese and French. Add kg/lb and USD/CAD preferences.

## 8. Roadmap

**This week**
- Security fixes from the private review.
- Calculator from bundled data, publish auth header, profile path and Excel percent import.
- Cache public reads, add a Neon usage alert, and apply to the open-source programs.
- Fix the quick start. Add SECURITY.md and a code of conduct, and enable private vulnerability reporting.

**This month**
- Dark-mode tokens, form accessibility, 16 px inputs, and a live, visible result.
- Persistent sessions, password reset, Google on sign-up, and Apple.
- One share sheet with a preview, prices opt-in, and Terms and Privacy pages.
- DATA_LICENSE and contributor terms. Remove the MAB-37 PDF and write to Alaska Sea Grant.
- The sync pull fix. Route the calculator through `DataContext`.
- npm workspaces, an emulator dev login, seed data and docs consolidation.

**This quarter**
- One Hono API, Postgres only, PGlite locally, and spreadsheet parsing in the browser.
- The `jose` JWKS verifier and the `auth_identities` table.
- 4-tab navigation, the calculator redesign, component primitives and an import preview.
- Observation schema v2, k≥5 aggregates, verification tiers and stable species IDs.
- The first dataset release with a DOI, static JSON and OpenAPI.
- Spanish, kg and CAD. The LCN partnership and GOVERNANCE.md.

**When the suite arrives**
- **Host:** Vercel Pro on open-source credits, or Cloudflare Workers with Hyperdrive.
- **Identity:** a suite identity provider (Logto or Better Auth) with organizations, passkeys and email codes.
- **Data:** npm packages, the widget, an MCP server, partner keys and webhooks.
- **Integrations:** Shopify and Square price pushes, DFC alignment, and QR price cards.
- **Price sheet:** one incoming price produces every cut, with margins.

## Selected sources

- Vercel Hobby plan: https://vercel.com/docs/plans/hobby. Vercel Open Source Program: https://vercel.com/open-source-program
- Neon plans: https://neon.com/docs/introduction/plans. Neon Open Source Program: https://neon.com/programs/open-source
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/. Hono: https://hono.dev/docs. PGlite: https://pglite.dev/docs/about. dbmate: https://github.com/amacneil/dbmate
- Firebase Auth limits: https://firebase.google.com/docs/auth/limits. Auth Emulator: https://firebase.google.com/docs/emulator-suite/connect_auth. API keys: https://firebase.google.com/docs/projects/api-keys
- Logto: https://github.com/logto-io/logto. Better Auth: https://github.com/better-auth/better-auth. jose: https://github.com/panva/jose
- FIDO Passkey Index 2025: https://fidoalliance.org/passkey-index-2025/
- MAB-37: https://seagrant.uaf.edu/bookstore/pubs/MAB-37.html and https://repository.library.noaa.gov/view/noaa/14823
- FAO ASFIS: https://www.fao.org/fishery/collection/asfis/en. WoRMS web service: https://www.marinespecies.org/aphia.php?p=webservice. ITIS: https://www.itis.gov/ws_description.html
- DFC standard: https://dfc-standard.org/. GDST: https://thegdst.org/. Frictionless Data Package v2: https://datapackage.org/
- OSM licence change: https://osmfoundation.org/wiki/Licence/About_The_Licence_Change. Contributor Covenant 3.0: https://www.contributor-covenant.org/version/3/0/code_of_conduct/
- UMaine / LCN and the USDA Office of Seafood: https://umaine.edu/news/2026/08/umaine-partners-with-usda-to-expand-federal-support-for-us-seafood-industry/
- NOAA Saltonstall-Kennedy grants: https://www.fisheries.noaa.gov/grant/saltonstall-kennedy-grant-competition. USDA LAMP: https://www.ams.usda.gov/services/grants/lamp
