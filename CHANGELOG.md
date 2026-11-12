# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Everything merged to `main` since 1.0.0. Entries from March 2026 on were rebuilt from the commit history in November 2026; the number is the pull request, or the commit where there was none.

### Added
- `SECURITY.md` (how to report a vulnerability privately) and `CODE_OF_CONDUCT.md`
- Notice of the coming move to a new address: a banner, a read-only stage for the app, a file download of changes that have not synced, and a switch that makes the API refuse writes ([#134])
- Domain glossary (`CONTEXT.md`) and decision records for moving to Firebase Auth and Firestore with no server of our own ([#122])
- Platform review and roadmap of September 2026 ([#112])
- Calculator rebuilt for phones: tap tiles for what you have and what you are making, plus and minus steppers, and a live result bar in place of the Calculate button ([#121])
- Processing and shipping can each be charged on incoming or outgoing weight, and the result shows the fish, processing and shipping parts ([#121])
- Help text that opens on tap and from the keyboard, a skip link, a visible focus ring and reduced-motion support ([#118])
- Design system notes in `docs/DESIGN_SYSTEM.md` ([#118])
- A confirmation before a custom yield is shared, listing what becomes public and how it will be credited ([#119])
- Recovery of records saved by older versions of the app, with a choice to assign them to the account or discard them ([#108])
- A preview before a saved calculation is published ([#105]), and publish and unpublish that queue while offline ([#106])
- A choice of which copy to keep when a custom yield was edited on two devices ([#104])
- A warning before signing out or switching account with changes that have not synced ([#103])
- An offer, after sign-in, to move records saved on the device as a guest into the account (`240b555`)
- Sync status in the navigation bar, with details and a manual retry ([#100])
- Saved data kept separately for each account and for the guest on a device ([#97])
- Google sign-in, and email verification before the first email sign-in ([#63])
- Community page: a searchable table of shared custom yields with a CSV download, and a share switch on each custom yield ([#62])
- Excel (.xlsx) export of saved calculations from the calculator ([#74])
- Upload page: drag and drop, a file preview and a template to download ([#75])
- Offline use: reference yields load from the app itself, a copy of the account's data is kept on the device and synced in the background, and the app can be installed ([#13])
- Checks on every pull request: lint, tests and build ([#48]), CodeQL (`ca31830`), and a secret scan of tracked files and of the commits in the change ([#120], [#138])
- Vercel Web Analytics integration for tracking application usage
- Comprehensive fish data validation testing suite
- Data validation module for ensuring fish data integrity

### Changed
- Four unused components (`Footer`, `InstallPrompt`, `FeaturesRoadmap`, `SubmitRequest`) and the rejected SQL Connect proof (`dataconnect/`) were removed, and superseded documents moved to `docs/archive/`
- The calculator is the home page; the old landing page content moved to About ([#13])
- New look: teal, terracotta and yellow brand with named colour tokens ([#72]), readable in light and dark themes with contrast checked by a test ([#118])
- Sign-in moved from Stack Auth to Firebase Auth; existing accounts are matched by verified email ([#63])
- Saved calculations are private unless their owner publishes them ([#98])
- Custom yields carry a revision number, so a stale edit is detected and not written over a newer one ([#99])
- The custom yield export in My Data is a CSV made on the device, so it works offline and can be imported again ([#107])
- Spreadsheet upload accepts `.xlsx` and `.csv` only; `.xls` is no longer accepted ([#17])
- Most API endpoints have one implementation shared by the local server and production ([#51], [#54], [#60], `8ac46ae`)
- The app's calculation math, API calls and yield merging each live in one tested module ([#49], [#50], [#52], [#53])
- Sync code left over from before the per-account storage was removed ([#111])
- Documentation corrected against the code, and research files moved to `research/` ([#47])

### Fixed
- Custom yields appear in the calculator with no signal, and follow edits and deletions made on other devices ([#135])
- The calculator, publishing a calculation, the profile page and Excel import of percentage cells work again ([#113])
- Amounts typed as `$4.50`, `1,000` or `4,50` are read correctly; anything unreadable is marked invalid and no longer counts as 0 ([#121])
- Saving can no longer pair edited inputs with an old result ([#121])
- Saving the profile form no longer changes the "show on page" choice by itself ([#119])
- Text that was unreadable in dark mode and links with too little contrast ([#118])
- A yield of `0.5` in a CSV no longer imports as 50% ([#107])
- A deleted calculation stays deleted on other devices ([#55])
- Spreadsheet import handles percent signs and malformed files ([#59])
- Export answering 404 in local development ([#50])
- Mismatches between the app and the API in sync and sign-in ([#36])
- The local server and production disagreeing on uploaded yields, status codes and export dates ([#17])
- A build warning from Tailwind reading test files ([#139])
- Contributor profile OAuth authentication flow
- Mobile menu navigation issues
- Yield range return format (now returns array instead of string)
- Neon database fish data import including tuna and PDF species

### Security
- The public community feed and contributors list no longer include account emails, usernames or user ids, and a name is shown only with the owner's consent ([#119])
- Legacy login gives the same answer for an unknown user, an account with no password and a wrong password ([#119])
- The API takes the owner of a record from the verified sign-in token and from nowhere else ([#114])
- The database connection string and auth keys committed in December 2025 were removed from the tracked env files ([#13]). They are still in git history; rotation is tracked in `SECURITY_NOTICE.md` ([#120])
- The unmaintained `xlsx` spreadsheet parser was replaced with ExcelJS ([#17], `2c3d952`)
- Dependency advisories cleared ([#46], [#77], [#78], [#82], `bf89be0`)

### Data
- Imported Tuna and Albacore profiles to fish_data_v3
- Updated Pacific Halibut conversion yields
- Normalized Walleye Pollock roe yield to integer values
- Completed comprehensive fish yield data from MAB-37 PDF research publication

## [1.0.0] - 2025-12-16

### Added
- React 19 + Vite 7 frontend with modern build tooling
- Tailwind CSS styling with responsive design
- User authentication system with JWT and bcrypt password hashing
- Save and export fish yield calculations
- Custom user yield data management with Excel/CSV upload support
- Contributor profile system for data transparency
- User data management interface with full CRUD operations
- About page with project mission and Local Catch Network information
- Data sources transparency page documenting MAB-37 research
- Comprehensive REST API with 15 endpoints
  - Authentication: `/api/register`, `/api/login`
  - Calculations: `/api/saved-calcs`, `/api/save-calc`, `/api/export-calcs`
  - User Data: `/api/user-data` (GET/POST/PUT/DELETE), `/api/upload-data`, `/api/export-user-data`
  - Contributors: `/api/contributors`, `/api/contributor`, `/api/contributor/me`
- Vercel serverless deployment support
- Neon PostgreSQL database integration
- SQLite to PostgreSQL migration scripts
- Comprehensive documentation:
  - API documentation (`docs/API.md`)
  - Architecture documentation (`docs/ARCHITECTURE.md`)
  - Deployment guide (`DEPLOYMENT.md`)
  - Contributing guidelines (`CONTRIBUTING.md`)
  - Implementation summary (`IMPLEMENTATION_SUMMARY.md`, now in `docs/archive/`)

### Data
Based on Marine Advisory Bulletin No. 37 (MAB-37) research publication "Recoveries and Yields from Pacific Fish and Shellfish" by Chuck Crapo, Brian Paust, and Jerry Babbitt (Alaska Sea Grant, 2004):

**Salmon Species (5)**
- Pink Salmon
- Chum Salmon
- Coho Salmon
- Sockeye Salmon
- Chinook Salmon

**Rockfish Species (17)**
- Black Rockfish
- Blue Rockfish
- Yelloweye Rockfish
- Canary Rockfish
- Copper Rockfish
- Quillback Rockfish
- Widow Rockfish
- Yellowtail Rockfish
- Bocaccio
- Chilipepper
- Shortbelly Rockfish
- Silvergray Rockfish
- Splitnose Rockfish
- Stripetail Rockfish
- Greenstriped Rockfish
- Rosethorn Rockfish
- Sharpchin Rockfish

**Flatfish Species (13)**
- Pacific Halibut
- Arrowtooth Flounder
- Petrale Sole
- Dover Sole
- English Sole
- Rock Sole
- Flathead Sole
- Starry Flounder
- Greenland Turbot
- Alaska Plaice
- Yellowfin Sole
- Rex Sole
- Butter Sole

**Shark Species (7)**
- Spiny Dogfish
- Blue Shark
- Shortfin Mako
- Thresher Shark
- Common Thresher
- Bigeye Thresher
- Leopard Shark

**Crab Species (4)**
- Dungeness Crab
- Red King Crab
- Blue King Crab
- Golden King Crab

**Shellfish Species (12+)**
- Pacific Geoduck
- Manila Clam
- Pacific Oyster
- Weathervane Scallop
- Pink Shrimp
- Spot Prawn
- Sidestripe Shrimp
- Coonstripe Shrimp
- Pacific Razor Clam
- Littleneck Clam
- Butter Clam
- Horse Clam

**Other Species (15+)**
- Walleye Pollock
- Pacific Cod
- Lingcod
- Sablefish
- Pacific Whiting
- Albacore Tuna
- Yellowfin Tuna
- Bigeye Tuna
- Pacific Herring
- Pacific Sardine
- Northern Anchovy
- Pacific Mackerel
- Jack Mackerel
- Striped Bass
- California Sheephead

### Technical Stack
- **Frontend**: React 19.0.0, Vite 7.2.4, Tailwind CSS 4.x
- **Backend**: Vercel Serverless Functions, Express 5.2.1
- **Database**: Neon PostgreSQL (@neondatabase/serverless)
- **Authentication**: jsonwebtoken 9.x, bcrypt 5.x
- **File Processing**: formidable, xlsx
- **Deployment**: Vercel with edge runtime support

## [0.1.0] - 2023-08-16

### Added
- Initial project setup
- Basic repository structure
- Project scaffolding

[Unreleased]: https://github.com/paccloud/Fish_Cost_Calculator/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/paccloud/Fish_Cost_Calculator/releases/tag/v1.0.0
[0.1.0]: https://github.com/paccloud/Fish_Cost_Calculator/releases/tag/v0.1.0

[#13]: https://github.com/paccloud/Fish_Cost_Calculator/pull/13
[#17]: https://github.com/paccloud/Fish_Cost_Calculator/pull/17
[#36]: https://github.com/paccloud/Fish_Cost_Calculator/pull/36
[#46]: https://github.com/paccloud/Fish_Cost_Calculator/pull/46
[#47]: https://github.com/paccloud/Fish_Cost_Calculator/pull/47
[#48]: https://github.com/paccloud/Fish_Cost_Calculator/pull/48
[#49]: https://github.com/paccloud/Fish_Cost_Calculator/pull/49
[#50]: https://github.com/paccloud/Fish_Cost_Calculator/pull/50
[#51]: https://github.com/paccloud/Fish_Cost_Calculator/pull/51
[#52]: https://github.com/paccloud/Fish_Cost_Calculator/pull/52
[#53]: https://github.com/paccloud/Fish_Cost_Calculator/pull/53
[#54]: https://github.com/paccloud/Fish_Cost_Calculator/pull/54
[#55]: https://github.com/paccloud/Fish_Cost_Calculator/pull/55
[#59]: https://github.com/paccloud/Fish_Cost_Calculator/pull/59
[#60]: https://github.com/paccloud/Fish_Cost_Calculator/pull/60
[#62]: https://github.com/paccloud/Fish_Cost_Calculator/pull/62
[#63]: https://github.com/paccloud/Fish_Cost_Calculator/pull/63
[#72]: https://github.com/paccloud/Fish_Cost_Calculator/pull/72
[#74]: https://github.com/paccloud/Fish_Cost_Calculator/pull/74
[#75]: https://github.com/paccloud/Fish_Cost_Calculator/pull/75
[#77]: https://github.com/paccloud/Fish_Cost_Calculator/pull/77
[#78]: https://github.com/paccloud/Fish_Cost_Calculator/pull/78
[#82]: https://github.com/paccloud/Fish_Cost_Calculator/pull/82
[#97]: https://github.com/paccloud/Fish_Cost_Calculator/pull/97
[#98]: https://github.com/paccloud/Fish_Cost_Calculator/pull/98
[#99]: https://github.com/paccloud/Fish_Cost_Calculator/pull/99
[#100]: https://github.com/paccloud/Fish_Cost_Calculator/pull/100
[#103]: https://github.com/paccloud/Fish_Cost_Calculator/pull/103
[#104]: https://github.com/paccloud/Fish_Cost_Calculator/pull/104
[#105]: https://github.com/paccloud/Fish_Cost_Calculator/pull/105
[#106]: https://github.com/paccloud/Fish_Cost_Calculator/pull/106
[#107]: https://github.com/paccloud/Fish_Cost_Calculator/pull/107
[#108]: https://github.com/paccloud/Fish_Cost_Calculator/pull/108
[#111]: https://github.com/paccloud/Fish_Cost_Calculator/pull/111
[#112]: https://github.com/paccloud/Fish_Cost_Calculator/pull/112
[#113]: https://github.com/paccloud/Fish_Cost_Calculator/pull/113
[#114]: https://github.com/paccloud/Fish_Cost_Calculator/pull/114
[#118]: https://github.com/paccloud/Fish_Cost_Calculator/pull/118
[#119]: https://github.com/paccloud/Fish_Cost_Calculator/pull/119
[#120]: https://github.com/paccloud/Fish_Cost_Calculator/pull/120
[#121]: https://github.com/paccloud/Fish_Cost_Calculator/pull/121
[#122]: https://github.com/paccloud/Fish_Cost_Calculator/pull/122
[#134]: https://github.com/paccloud/Fish_Cost_Calculator/pull/134
[#135]: https://github.com/paccloud/Fish_Cost_Calculator/pull/135
[#138]: https://github.com/paccloud/Fish_Cost_Calculator/pull/138
[#139]: https://github.com/paccloud/Fish_Cost_Calculator/pull/139
