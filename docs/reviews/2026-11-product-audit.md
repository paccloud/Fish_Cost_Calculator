# Product audit (November 2026)

Reviewed at commit `83c5f26` on 2026-11-10. It follows the [September platform review](2026-09-platform-review.md) and the decisions in `CONTEXT.md` and ADRs 0001–0004, and adds what changed on 2026-11-10: the audience is now **food producers (seafood first) and chefs**, the look should move upmarket, the stack should get simpler, and the product should ship as a **web app and an iOS app first, Android after**.

The companion to this document is [`docs/STYLE_GUIDE.md`](../STYLE_GUIDE.md).

## How this was checked

- Ran the project's own gates: `npm run lint`, `npm test`, `npm run build`, and `npm audit` in all four packages.
- Served the production build with **no backend** and drove it in a headless browser: every route at 390 px and 1280 px, in both themes, with axe (WCAG 2.2 AA rules), a tap-target measurement and a filled-in calculation.
- Read the open issues, the last workflow runs and the code paths named below.
- Read current App Store, Capacitor and Firebase requirements, and captured the three reference brands' sites on 2026-11-12. Section 9 says what could not be verified.

## Verdict

| Area | State | One line |
|---|---|---|
| Calculator | **Good** | Works offline, the math is right, and it is close to fully accessible. This is the asset. |
| Everything around it | **Mid-rebuild, stalled** | The Firebase move decided on 2026-09-29 has not started. Ten issues are open and the first one is waiting on a review. |
| Codebase | **Healthy gates, wrong weight** | Lint, tests and build pass. But there is more code for a secret scanner than for the app, and about 7,200 lines are already marked for deletion. |
| Security | **One open item, yours** | The leaked database credential is still not recorded as rotated (#22). The repository is public. |
| Design | **Functional, not yet premium** | The calculator has a real design system. The other seven screens don't use it. There is no logo, no single name, and the navigation is a website's, not an app's. |
| App Store | **Not ready** | Nothing blocks it technically, but eight specific things are missing (section 6). |
| Fit for chefs and producers | **Half the answer** | It gives cost per lb. A producer needs a sell price; a chef needs a portion cost. Neither is there. |

## 1. What passed

| Check | Result |
|---|---|
| Lint | 0 errors, 2 warnings (`DataContext.jsx:190`, `lifecycleTelemetry.js:34`) |
| Tests | 9,716 passed in 46 files, 125 s |
| Build | OK. Main chunk 382 kB (113 kB gzipped), precache 473 KiB |
| CI on `main` | CI and CodeQL green on the last three pushes |
| Accessibility (axe) | 0 violations on 8 of 9 routes in both themes. Community has 2 (section 4) |
| Layout at 390 px | No horizontal scroll on any route |
| Offline | With every `/api` call failing, the calculator loads its 89 species and 655 conversions from the bundle and works |
| Math | Sockeye, Round → Skinless Fillet, $4.50 at 46%: the app shows $9.78/lb. 4.50 ÷ 0.46 = 9.78 |

The September review's functional bugs (calculator dead-ending without the API, publish doing nothing, the blank profile, the Excel percent import, the add-only sync pull) were addressed in #113, #121 and #135. The calculator and offline behaviour were re-checked here by running the build; the others were not re-tested.

## 2. Findings, in priority order

### 2.1 The leaked database credential (#22) is still open

`SECURITY_NOTICE.md` opens with "Rotation is NOT recorded as done". Neon is still the production database, the repository is public, and the value was on `main` for about 3.4 months. Only the owner can do this: reset the Neon role, update `DATABASE_URL` in Vercel, revoke the retired Stack Auth key, and write the dates into the notice. It takes under an hour and nothing else here matters as much.

### 2.2 The simplification was decided six weeks ago and has not started

ADR 0001 (Firebase Auth + Firestore + Firebase Hosting, no server of our own) is the right call and nothing below changes it. But #123–#133 are all open and untouched since 2026-09-29. The three pull requests merged since then were a sync fix to the layer being deleted (#135), the secret scanner (#138) and a Tailwind warning (#139).

The blocker is #123, the first slice. It is labelled `ready-for-human` because it sets the Firestore data shape and rules that the other nine build on. Until it is reviewed, everything else, including the store launch, waits.

### 2.3 The repository's weight is in the wrong place

| What | Lines | Status |
|---|---:|---|
| The app (`app/src`, no tests, no fish data) | 8,736 | The product |
| …of which the sync, legacy-login and REST-auth layer | 2,317 | Deleted by ADR 0001 |
| `server/`, `api/`, `shared/`, `db/`, Neon scripts | 4,913 | Deleted by ADR 0001 |
| `dataconnect/` (Firebase SQL Connect proof) | 1,080 | Rejected by ADR 0001, still in the tree |
| `scripts/check-secrets.mjs` and its tests | 20,195 | A home-grown secret scanner, 2.3× the size of the app |

The scanner is 7,331 of the 9,716 tests and about 116 of the 125 seconds the suite takes. It was built for a good reason (#22), but a solo maintainer should not own a secret scanner. GitHub secret scanning with push protection, plus the `gitleaks` action in CI, does the same job with no code to maintain. Replacing it removes two thirds of the repository's JavaScript and takes the test run from about two minutes to about ten seconds.

After ADR 0001 lands and the scanner is replaced, the repository is roughly **6,500 lines of app code plus tests**. That is the simple stack.

### 2.4 It answers half of what the new audience asks

The calculator stops at cost per lb of finished product. For the two audiences named:

| Who | Their question | Today |
|---|---|---|
| Producer, direct marketer | "What do I charge?" | Not answered. No margin, no sell price. |
| Chef | "What does a 6 oz portion cost me, and what is that as food cost?" | Not answered. No portions, no ounces. |
| Both | "What if this fish cuts badly?" | The low / average / high buttons change the yield, but the price range is never shown side by side. |
| Both | "Send this to my buyer / my sous." | No share. Saving needs an account. |
| Both | Find the fish fast | A native select of 89 species, no search, no recents. |
| Canada, export, larger kitchens | kg, CAD | lb and $ only. |

The engine (`app/src/lib/calcEngine.js`) is clean and well tested, so each of these is a small, safe addition. They matter more to the audience than any visual change.

One naming note for "food producers, starting with fish": the data shape is already generic (item, `From → To`, yield %). Keep new collection and field names generic (`item`, not `fish`) in the Firestore work so meat and produce yields do not need a second migration.

### 2.5 Design: one good screen, seven older ones

Covered in section 4. In short: the calculator follows `docs/DESIGN_SYSTEM.md`; the other screens predate it and are visibly a different product (14 px text, 36 px buttons, centred icon-in-a-square headers). There is no logo, the product has three names, and guests hit "Login Required" walls on three routes.

### 2.6 Reference data quality (unchanged since September)

Measured on `fish_data_v3.js`: 89 species, 655 conversions.

- **48%** of conversions (312) have no range, so the low / high buttons and any price range have nothing to show for them.
- **16 rockfish species share three byte-identical yield tables** (groups of 10, 4 and 2). That may be what the source says, but the app presents them as 16 separate measured species.
- Starting forms are named inconsistently: `Round` (329), `Whole` (29), `Raw Whole` (27), `Cooked Whole` (6) and others. The plain-language names in the style guide need one vocabulary underneath.
- The MAB-37 PDF and its full OCR text are still in `research/` without written permission from Alaska Sea Grant (September review, section 7). This matters more once the app is on a store under your name.

### 2.7 Housekeeping

- **GitHub Pages fails on every push to `main`** ("pages build and deployment", runs 71 and 72). Pages is enabled in the repository settings but nothing is meant to deploy there. Turn it off.
- **`npm audit`:** app 19 (7 high), server 14 (2 critical, 4 high), root 4 (1 high), shared 0. All of the app's are in build and test tooling (Vite, Vitest, Workbox), not in shipped code, and `npm audit fix` clears most. The server's criticals (`tar`, `proxy-addr`) are in the local-only Express server that ADR 0001 deletes.
- **Node versions disagree:** the README and root `package.json` say 18, CI uses 20, Vite 7 needs 20.19+, and Capacitor 8 needs 22. Pin one (22) in `.nvmrc`, `engines` and CI.
- **Unused screens still in the tree:** `Footer.jsx`, `InstallPrompt.jsx`, `FeaturesRoadmap.jsx` and `SubmitRequest.jsx` are imported nowhere and use colour classes that no longer exist. `/profile` and `/inventory` are still routed although `CONTEXT.md` and ADR 0003 dropped both.
- **Docs have drifted:** `CLAUDE.md` lists routes `/calculator`, `/submit-request` and `/roadmap`, which do not exist. `AUDIT_REPORT.md` (June), `IMPLEMENTATION_SUMMARY.md`, `AUTH_ARCHITECTURE.md`, `PRD.md`, `docs/AUTH_MIGRATION_ROADMAP.md` and the two `firebase-sql-connect-*` documents describe systems that are gone or rejected. `CHANGELOG.md` stops in December 2025. Still missing: `SECURITY.md`, a code of conduct, issue templates, Dependabot.
- **One open pull request** (#137, a skill file) has been waiting since 2026-10-11.

## 3. The stack: today, and after

| | Today | After ADR 0001 + this audit |
|---|---|---|
| App | React 19 + Vite 7 + Tailwind 3, PWA | Same |
| Native | None | **Capacitor 8** wrapping the same build: iOS first, Android later |
| Sign-in | Firebase Auth over hand-written REST calls, plus legacy passwords and JWTs | Firebase Auth SDK. On iOS: Sign in with Apple and Google through one native plugin |
| Data | Neon Postgres + a custom offline sync engine + IndexedDB | Cloud Firestore from the browser, with its own offline cache |
| Servers | Express + SQLite (local) and 11 Vercel functions (production), kept in sync by hand | None |
| Hosting | Vercel (Hobby: non-commercial only) | Firebase Hosting |
| Analytics | `@vercel/analytics` | Remove, or Firebase Analytics if you want numbers. Either way it must be declared on the App Store privacy label |
| Secret scanning | 20,195 lines of our own | GitHub secret scanning + `gitleaks` in CI |
| Things to keep running | 2 backends, 2 databases, 2 SQL dialects, 3 auth paths, 1 sync engine | 1 app, 1 Firebase project |

**Why Capacitor and not a rewrite.** The app is a working, accessible, offline-capable React app. Capacitor wraps that exact build in a native shell, so there is one codebase for web, iOS and Android, and the same people can maintain all three. React Native or Expo would mean rebuilding every screen and re-plumbing auth and storage for weeks, to end up with the same features. That only pays if you need native-only UI, and a calculator does not.

**What a native shell costs you**, so it is not a surprise: an Apple Developer account ($99/year), a Mac (or a cloud build service) for iOS builds, a yearly Xcode and SDK update, and App Review on every release.

## 4. Design audit

Each screen was captured at phone and desktop width in both themes.

### What is already right, and should not change

- The calculator's structure: two numbered steps, tap tiles instead of dropdowns, big steppers, and a live result bar pinned to the bottom. No Calculate button.
- Control sizes (48 px and 56 px), 16 px inputs, a visible 3 px focus ring, reduced-motion support.
- Contrast is enforced by a test (`designTokens.test.js`), and axe finds nothing on the calculator in either theme.
- The palette. Deep-sea teal on warm paper with a brass highlight sits squarely in the family the reference brands use, and it is already tuned for glare. It does not need replacing; it needs to be used with more discipline.

### What reads as mid-market

| # | Finding | Evidence | Fix (see the style guide) |
|---|---|---|---|
| 1 | **Two visual languages.** The calculator uses the design system; Sign in, About, Data, Community, Upload and My Data use an older, smaller one. | Calculator body text is 18 px with 48–56 px controls. The other screens are mostly 14 px with 36–40 px buttons, and each opens with a centred icon in a teal square. | Rebuild the secondary screens from the same components as each one is touched by the Firebase work. Do not restyle screens that ADR 0003 deletes. |
| 2 | **One typeface for everything.** Inter at every size makes it look like any SaaS dashboard. | Every text node is Inter. | Pair it with a sturdy serif (Fraunces) for the names of things: species, products, screen titles. Inter stays for controls and every number. |
| 3 | **Teal is everywhere, so nothing stands out.** The top bar, primary buttons, selected tiles, the mode switch and the result bar are all the same teal. | `brand-teal` classes appear 43 times in components, besides every `bg-primary`. | Teal means "chosen" or "go" and nothing else. The top bar becomes paper. The result gets its own darker ink so the price is the heaviest thing on screen. |
| 4 | **No logo and three names.** | The nav says "Local Catch". The page title says "Fish Cost Calculator — Local Catch Network". The installed app is "Fish Calc". The mark is a stock icon in a square. | Decide the name (section 7), then commission a wordmark and an app icon. Until then, set the name in the display face. |
| 5 | **Website navigation.** Six top-level links on desktop and a hamburger on a phone. | Calculator, Data, Community, My Data, Upload, About. | Four tabs along the bottom: Calculate · My yields · Community · Account. This also helps App Review see an app, not a website. |
| 6 | **Trade codes lead.** | Tiles read "D/H-On", "D/H-Off (Thawed)". The help for them is at the very bottom of the page. | Plain words first ("Gutted, head on"), the code on the second line. |
| 7 | **Guests hit walls.** | `/upload`, `/manage-data` and `/profile` each show only "Login Required". The calculator says "Sign in to save". | Guests save on the phone (ADR 0002 already decides this). No screen is only a wall. |
| 8 | **Numbers have no source on them.** | The yield field says "Typical 41–49%" but not where that came from. Custom yields look the same as reference yields. | A small stamp on every yield: `MAB-37 · 41–49%`, `Your yield`, `Community · 12 cuts`. |
| 9 | **The phone page is long.** | With a product chosen the calculator is about 2,600 px tall at 390 px wide. Processing and shipping take a third of it and are optional. | Fold optional costs behind one "Add processing or shipping" button. |
| 10 | **Words are inconsistent.** | "Sign in", "Log in", "Login Required", "Go to Login", "Sign Up", "Welcome Back", "Community Data Pool" (the glossary says "community dataset"). | One name per thing; the table is in the style guide. |

### Defects found while looking

- **Community shows an error and an empty state together** when the API fails: "Failed to load community data" directly above "No community data yet. Be the first to share". It also offers "Download CSV" for zero entries.
- **Community has the only two axe failures:** the error text is `text-red-600` on `bg-red-50` (below 4.5:1 in light theme), and the "Log in" link in the last paragraph is distinguishable only by colour.
- **Small targets on the older screens:** "Need an account? Sign Up" and "Continue as Guest" are 20 px tall, "Sign in with Google" is 38 px, "Go to Login" and "Download CSV" are 36 px. The design system's floor is 44 px.
- **The home-screen icon will not show on iPhones.** `index.html` points `apple-touch-icon` at an SVG, which iOS does not accept, and the manifest lists SVG icons only. Add PNGs at 180, 192 and 512 px.
- **The font needs the network.** Inter loads from Google Fonts. A first launch with no signal gets the system font. Bundle the font files (the store build must not depend on a CDN in any case).

## 5. The reference brands

The brands named were resolved as **Sitka Seafood Market**, **Wild Alaskan Company**, and **Outerseas** (the new name of Alaskan Salmon Company). Their home pages were captured on 2026-11-12 at phone and desktop width, and the values below were read from the pages' computed styles.

| | Ink | Grounds | Highlight | Names and headlines | Everything else | Corners |
|---|---|---|---|---|---|---|
| Sitka Seafood Market | Navy `#003c71`, used for all text | White, warm off-white `#f7f5f3`, pale blue `#edf6fd` | Green `#51815b` buttons, rust `#ab5b2e` eyebrows | Frank Ruhl Libre (serif), regular weight | Funnel Sans; condensed capitals (Bebas Neue) for small labels | Square |
| Wild Alaskan Company | Navy `#0d334c` | White, cool grey `#e7edf1` | Gold `#ffb600` buttons with dark text | Their own sign-lettering face, in capitals | Seravek; 14 px uppercase, letter-spaced labels | Pills |
| Outerseas | Indigo `#0f0a30` | White, bone `#eeefe8` | Butter yellow `#fdf5a4` | GT Alpina Extended (a wide serif), light | Pitch Sans, a monospace, in capitals for navigation, buttons and prices | 4 px |

What all three do, and what the style guide does with it:

| They all | Local Catch |
|---|---|
| Set text in a dark blue, never black | Already true (`text-primary` is a teal-black). Kept. |
| Use one yellow or gold as the thing to look at | Brass is reserved for the price on the ticket. |
| Set names and headlines in a serif at a regular or light weight, and everything else in a plain face | Fraunces for species, products and titles at 500–600; Inter for controls and numbers. The first draft was heavier and was lightened after seeing them. |
| Use small uppercase, letter-spaced labels; Outerseas sets them in a typewriter face, like a price tag | Stamps: the source of every yield, set as a printed label. |
| Keep corners tight or square | Radii go from 8 and 12 px to 6 and 8 px. |
| Use white, near-white or bone grounds | The paper moves from `#f5f0eb`, which reads pink beside them, to `#f4f2ec`. |
| Show real boats, real people and a short provenance claim ("Traceable to the Source", "caught by us") | No stock imagery in the app; documentary photography on the store listing; provenance on every number. |

Not taken, on purpose: uppercase button labels (slower to read at a glance with wet hands), pill buttons, and full-bleed photography inside a tool.

**Chef software.** meez's page loaded without its stylesheet here (it is served from a host that is still blocked), so its design was not seen. From its copy, it sells control in numbers ("One source of truth for every kitchen"), which is the register the ticket's line items use.

## 6. What the App Store needs

Requirements are from Apple's published pages as of 2026-11-10 unless marked.

| Requirement | Why | State today |
|---|---|---|
| Built with Xcode 26 and the iOS 26 SDK | Required for uploads since 2026-04-28 | No native project yet |
| Feel like an app, not a wrapped website (guideline 4.2) | The most likely rejection for a web-based app | Works offline, which is the strongest argument. Needs the tab bar, the share sheet, safe-area layout, and no "sign in on our website" dead ends |
| Usable without an account (5.1.1(v)) | Required unless the app is account-based | The calculator already is |
| **In-app account deletion** (5.1.1(v)) | Required if the app lets people create an account | **Missing.** Not in #123–#133 either |
| **Sign in with Apple** alongside Google (4.8) | Required when a third-party login is offered | **Missing** |
| Native Google sign-in | Google blocks OAuth inside embedded web views, and the current redirect flow will not complete in one (from Google's developer blog, not re-verified) | The current flow is a browser redirect over REST |
| **Privacy policy URL** and the App Privacy label | Required for every submission | **No privacy policy or terms anywhere in the app** |
| Privacy manifests for bundled SDKs | Capacitor and Firebase are on Apple's list | Handled by current versions of both; check at build |
| PNG app icon (1024 px) and launch screen | Store and device requirement | SVG icons only |
| A demo account or demo mode for the reviewer | Review guideline 2.1 | None |
| The right to use the name | The store listing shows a seller and a name | "Local Catch" is the Local Catch Network's name (section 7) |

**A faster first release.** Version 1.0 on iOS could be the calculator alone: all reference yields, saved prices kept on the phone, share, and no accounts. With no sign-in, the Apple-login, native-Google and account-deletion rows above do not apply, and it does not have to wait for the Firebase migration. Accounts, sync and community yields arrive in 1.1. This is the route recommended here; it gets a useful app to the store soonest and puts the riskiest review items in a later, smaller update.

For Android later: Capacitor's Android target reuses the same build and plugins. A personal Google Play account must run a closed test with at least 12 testers for 14 days before going public (from Google's help centre, via search), so start that early. Registration is a one-time $25.

## 7. Decisions only you can make

1. **The name.** "Local Catch" belongs to the Local Catch Network. Shipping an app under it needs their agreement in writing, or a name of your own. This also decides the wordmark, the icon, the store listing and the web address. If the product will grow past fish, choose a name that allows it.
2. **Release route.** Calculator-only iOS 1.0 first (recommended), or wait for accounts and ship everything at once.
3. **Who publishes.** An individual Apple developer account is quick. An organisation account shows a company name as the seller but needs a D-U-N-S number, which can take weeks. Start now either way.
4. **A Mac for builds**, or a cloud build service (Xcode Cloud includes 25 hours a month with the developer account).
5. **Illustration and photography.** The style guide works in type alone. A set of species line drawings and a handful of real dock and kitchen photographs for the store listing would do more for "higher end" than any further change to the UI.
6. **MAB-37.** Write to Alaska Sea Grant for permission before the store launch.

## 8. Roadmap

**Now (you, about a day in total)**
- Rotate the Neon credential and close #22.
- Decide the name and the release route.
- Enrol in the Apple Developer Program.
- Review #123 so the Firebase work can start. Turn off GitHub Pages. Merge or close #137.

**Next: simplify (mostly agent work)**
- Replace the home-grown secret scanner with GitHub secret scanning and `gitleaks`.
- Delete `dataconnect/`, the four unused components, and the `/profile` and `/inventory` routes. Archive the superseded documents. Pin Node 22.
- Do #123–#129 in order. Build each screen from the style guide's components as it is rebuilt, so the redesign costs no extra pass.
- Then #131 (copy from Neon), #132 (Firebase Hosting) and #133 (delete the old backend).

**In parallel: make it answer the question (small, independent, safe)**
- Sell price at a margin; portion cost; the price range across the yield range.
- Ounces, kilograms and a currency setting.
- Species search with recents.
- Save on the phone for guests; share a price card.
- The four-tab navigation, the display typeface and the ticket, on the calculator first.

**Then: the store**
- Add Capacitor 8, PNG icons, a launch screen and bundled fonts.
- A privacy policy page.
- TestFlight, then submit 1.0 (calculator, saved prices, share).
- 1.1: accounts with Sign in with Apple and Google through the native plugin, in-app account deletion, App Check, community yields.
- Android: open the Play closed test as soon as 1.0 is stable.

## 9. What could not be verified

- **Chef software.** meez's site rendered without its stylesheet, and Galley and Choco were not opened, so the chef-software comparison rests on their copy, not their design.
- **Some platform facts** came from search snippets rather than the source page, because capacitorjs.com, firebase.google.com and Google's help centre were also blocked: Google's embedded-webview OAuth block, Firestore persistence details in WKWebView, the Play closed-test numbers, and Codemagic's free tier. Apple's requirements and the Capacitor and plugin versions were read from the source.
- **Production itself.** Nothing here touched the live site, Vercel, Neon or Firebase. Whether the credential in #22 has in fact been rotated cannot be seen from the repository.
- **Signed-in screens.** My Data, Upload and the profile were only seen in their signed-out state, because there was no backend or Firebase project to sign in to.
- **Real devices.** All captures are from headless Chromium, not Safari on an iPhone.
