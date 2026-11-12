# Contributing to Local Catch

Thank you for your interest in contributing! This document provides guidelines for contributing to the Fish Cost Calculator project.

## Where the Project Is Going

Read [`CONTEXT.md`](CONTEXT.md) for the project's vocabulary and [`docs/adr/`](docs/adr/) for the decisions already made. The two backends (`server/` and `api/`) are being replaced by Firebase ([ADR 0001](docs/adr/0001-firebase-auth-and-firestore.md), issues #123–#133), so they take fixes only. New work goes into the calculator in `app/`. Documents in `docs/archive/` are out of date on purpose.

## Ways to Contribute

### 1. Report Bugs

- Open a GitHub issue with the `bug` label
- Include steps to reproduce, expected behavior, and actual behavior
- Include browser/OS information if relevant

### 2. Suggest Features

- Open a GitHub issue with the `enhancement` label
- Describe the use case and how it would benefit users

### 3. Add Yield Data

We're always looking to expand our species database. To contribute yield data:

1. **Source your data** - It must come from a reputable source (scientific studies, NOAA, state fisheries agencies)
2. **Format your data** - Follow the structure in `app/src/data/fish_data_v3.js`:
   ```javascript
   "Species Name": {
     scientific_name: "Genus species",
     category: "Category",
     conversions: {
       "Round → D/H-On": { yield: 88, range: [82, 94] },
       // ... more conversions
     }
   }
   ```
3. **Cite your source** - All data must include attribution
4. **Submit a PR** - Include the source in your PR description

### 4. Improve Documentation

- Fix typos, improve clarity, add examples
- Translate documentation to other languages

### 5. Code Contributions

#### Getting Started

Use Node 22.

```bash
# Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/Fish_Cost_Calculator.git
cd Fish_Cost_Calculator

# Create a branch: feature/..., fix/..., refactor/... or docs/...
git checkout -b feature/your-feature-name

# Install the four packages. The tests and the local API import from api/ and shared/,
# so all four are needed.
npm install
(cd app && npm install)
(cd shared && npm install)
(cd server && npm install)

# Local settings (untracked). Never put a real value in a tracked .env file.
[ -e app/.env.development.local ] || cp app/.env.example app/.env.development.local
[ -e server/.env ] || cp server/.env.example server/.env
```

Then run the two halves in separate terminals:

```bash
cd server && node server.js   # API on http://localhost:3000
cd app && npm run dev         # app on http://localhost:5173
```

The calculator works without the API. You need the API, and a Firebase project of your own in the two env files, only to sign in, save to an account or upload.

#### Code Standards

- Use consistent indentation (2 spaces)
- Use the terms in `CONTEXT.md` for domain concepts
- Commit messages use a conventional prefix (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`), present tense, under 70 characters
- Add comments for complex logic
- Test your changes before submitting

#### Pull Request Process

1. Update documentation if needed
2. Run what CI runs, and make sure each passes:
   ```bash
   cd app && npm run lint && npm test && npm run build
   cd .. && node scripts/check-secrets.mjs
   ```
   `npm test` takes about two minutes.
3. **Update the CHANGELOG.md** (see below)
4. Create a PR against `main` with a clear description of changes. Nothing is committed to `main` directly.
5. Wait for review

#### Maintaining the Changelog

We follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. For every PR with user-facing changes:

1. **Add entries under `[Unreleased]`** in `CHANGELOG.md`
2. **Use the appropriate category**:
   - `Added` - New features
   - `Changed` - Changes to existing functionality
   - `Fixed` - Bug fixes
   - `Removed` - Removed features
   - `Security` - Security fixes
   - `Data` - Fish species/yield data updates
3. **Say what changed for the person using or maintaining the app**, one line per change, not the commit subject
4. **Give the pull request number**: `- Fixed login bug ([#123])`, and add `[#123]: https://github.com/paccloud/Fish_Cost_Calculator/pull/123` to the list at the bottom of the file
5. **Be descriptive but concise**: Help users understand what changed and why it matters

Example:
```markdown
## [Unreleased]

### Added
- Export calculations to CSV format

### Fixed
- Calculator rounding errors for small yields
```

When we create a new release, maintainers will move entries from `[Unreleased]` to a new version section.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Remember we're all here to support the fishing community

The full text is in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Security

Do not open a public issue for a vulnerability or a leaked credential. Report it privately as described in [`SECURITY.md`](SECURITY.md).

## Questions?

Open an issue with the `question` label or reach out to the maintainers.
