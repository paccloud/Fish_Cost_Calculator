# Security Notice: Credential Exposure and Rotation

> **Status: OPEN. Rotation is NOT recorded as done.**
>
> Real credentials were committed to this public repository in December 2025 and are still readable in its git history. This notice stays open until the repository owner completes the checklist below, fills in every "done on" date and records the decision on git history (step 5.1). Nothing in this file says a credential has been rotated, revoked or confirmed dead. Until it does, treat the Neon database password and the Stack Auth secret server key as compromised.
>
> Tracking issue: #22. Only the owner can do the rotation (it needs the Neon, Stack Auth and Vercel dashboards). An agent or CI job cannot, and must never be given the old or new values.

## What leaked

Found by scanning every commit on every ref of the public repository (356 commits, 49 branches, 73 pull request refs, 1 tag). Values are deliberately not reproduced anywhere in this file.

| Service | What | Secret? | Files | Introduced / removed from `main` | Action |
|---|---|---|---|---|---|
| Neon Postgres | Connection string containing the owner-role password | **Yes** | `app/.env.development`, `app/.env.production` | `1eef6e2` (2025-12-16) / `0d36e57` (2026-03-28) | Rotate: step 1 |
| Stack Auth (retired) | Secret server key | **Yes** | same two files | same commits | Revoke: step 2 |
| Stack Auth (retired) | Project ID and publishable client key | No, shipped to browsers by design | same two files, plus `docs/ENVIRONMENT_VARIABLES.md` | `1eef6e2` / files `0d36e57`, docs `32f7f12` (2026-08-06) | None; moot once the Stack project is revoked |
| Legacy JWT login | Weak hardcoded fallback for `JWT_SECRET` in `server/server.js` (a guessable dev default, not a random production secret). The tag `v1.0.0` points at the introducing commit `9156730`, so it carries the fallback at its tip | Weak | `server/server.js` | `9156730` (2025-12-16) / `0d36e57` | Check the real value: step 3 |
| Firebase | Web config. Only a project ID was ever committed | No, public by design | `docs/ENVIRONMENT_VARIABLES.md` | n/a | None |

Also found and harmless: test constants and a synthetic test token in the test files, a dummy bcrypt hash in `shared/handlers/login.js`, and a truncated JWT header sample in `docs/API.md`. No AWS, GitHub, Slack, Stripe, Google or Gemini API key, private key, service-account file or full JWT was ever committed.

**How exposed.** The repository is public. On `main` the values were present from 2025-12-16 to 2026-03-28 (about 3.4 months). When scanned they were still retrievable: every branch contained the introducing commit, the values were at the tip of 8 branches (`docs/add-changelog`, `feature/custom-dropdown-options`, `feature/import-validation-ux`, `feature/pcs-maritime-ui-overhaul`, `fix/docs-env-vars`, `fix/neon-tuna-pdf-import`, `fix/oauth-authentication-config`, `vercel/set-up-vercel-web-analytics-in-qwrrs8`) and they appeared in 12 pull request refs (PRs 1 to 10, 12 and 73). Assume they were copied. The weak JWT fallback is also at the tip of the tag `v1.0.0` (the env files are not in that tag).

**Current tree is clean.** At the current branch tip no tracked file contains a real credential; the four tracked env files hold placeholders only. Earlier notes (for example `AUDIT_REPORT.md` and the comments on #22) may name a different first commit, such as the oldest commit visible in a shallow clone. A shallow clone only holds the newest commits, so `git log` there will not show `1eef6e2`.

## Rotation checklist

Do these in order (step 1 is staged: new credential live before the old one is revoked). Record the date you finish each one. Do not paste old or new values into issues, PRs, chat, tickets or an AI assistant.

### 1. Neon database (first, it is the most serious)

Do this as a **staged rotation**: bring the app up on a new credential first, and only then kill the compromised one. That keeps production up throughout.

The faster alternative is to reset the existing role's password in place (Neon console, the role's "Reset password"). It is simpler but accepts an outage: the moment the password changes, every new database connection from the deployed site fails with a password authentication error (API routes return 500 and sign-in that needs the database, saved calculations and data pages break) until steps 1.2 and 1.3 finish. Connections already open may keep working for a while, which can hide the problem. If you take that route, do 1.2 to 1.4 immediately after the reset, then continue with 1.6 onward.

- [ ] 1.1 In the [Neon console](https://console.neon.tech), create a **new** role (new name, new password) that can do what the API needs, and copy its connection string into your password manager. If the old role owns the database or its tables, you will move ownership in 1.5. Do not touch the compromised role yet. done on: ____
- [ ] 1.2 Set the new connection string as `DATABASE_URL` in Vercel for **Production, Preview and Development**. The Neon/Vercel integration may also have added variables holding the old password (`POSTGRES_*`, `PG*`, `DATABASE_URL_UNPOOLED`, `NEON_*`). Nothing in this repository reads them, so update or delete them. Remove stale duplicate Neon integrations (see `DEPLOYMENT.md` section 5.3). done on: ____
- [ ] 1.3 Redeploy Production (and any Preview you still use). A variable change only reaches new deployments. Older deployments keep the old value and will lose database access once the old role is revoked, so delete the ones you no longer need. done on: ____
- [ ] 1.4 Smoke test the deployed site on the new role: sign in with Firebase email/password, sign in with Google, sign in with a legacy username, and open a page that reads or saves data (for example Saved calculations). Check the Vercel function logs for database authentication errors. Do not continue until this passes. done on: ____
- [ ] 1.5 Revoke the compromised role. First move what it owns to the new role (for example `REASSIGN OWNED BY <old role> TO <new role>;` run as an owner, and change the database owner if it was the old role), then delete the old role, or at minimum reset its password to a fresh random value that you discard. If you took the reset-in-place shortcut, this step is already done by the reset. done on: ____
- [ ] 1.6 Check every Neon branch of the project, especially any created before 1.5. A branch forked from production may still carry the old role and password. Reset or delete the role there too, or delete the branch. done on: ____
- [ ] 1.7 **Confirm the old credential is dead, yourself.** From your own machine, try to connect with the old connection string (for example `psql` with the old string) and confirm authentication is refused. The old string is in your own records or in commit `1eef6e2`; read it only in your own terminal. Do not give it to a script, a CI job or an agent, and clear it from your shell history afterwards. done on: ____
- [ ] 1.8 Review Neon's connection and query history for unexpected clients or queries between 2025-12-16 and the date you completed 1.5. What is available depends on your Neon plan. Note what you found: ____ done on: ____
- [ ] 1.9 Replace local copies: re-run `vercel env pull` to refresh any root `.env.local`, and clean any shell profile or password manager entry that still holds the old string. done on: ____

Optional hardening: run the API as a role with only the table access it needs, and keep the owner credential for the schema and import scripts in `scripts/`. Today the API and the scripts use the same owner-level string.

### 2. Stack Auth (retired provider)

Nothing in `api/`, `app/src`, `server/`, `shared/` or `scripts/` reads a `STACK_*` variable any more. Auth moved to Firebase in PR #63 (`32f7f12`, 2026-08-06), so revoking the key has no effect on production as long as production runs that commit or a later one.

- [ ] 2.1 In the Stack Auth dashboard, revoke the secret server key, or delete the retired project. If the project was created through the Neon Auth integration, look in the Neon console's Auth section instead. done on: ____
- [ ] 2.2 Remove every `STACK_*`, `NEXT_PUBLIC_STACK_*` and `VITE_STACK_*` variable from Vercel (all environments). `DEPLOYMENT.md` section 5.3 covers removing the integration but does not say to revoke the key at the provider, so 2.1 is still needed. done on: ____

The project ID and publishable client key need no separate action.

### 3. `JWT_SECRET` (legacy `/api/login`)

No real `JWT_SECRET` value was ever committed. The only exposure is the weak fallback that existed in an old `server/server.js`, and it matters only if a deployment ran that server without `JWT_SECRET` set.

- [ ] 3.1 Check that `JWT_SECRET` in Vercel (Production, and Preview if legacy login is used there) is a long random value and not that old fallback. If you are not sure, set a new one and redeploy. Generate it with the command in `server/.env.example`: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`. done on: ____

Effect of changing it: every legacy token (issued by `/api/login` and kept in the browser's `localStorage` under `token`) stops working, and those users must sign in again. Firebase sessions are not affected. Do not delete the variable: with it unset, `/api/login` returns 500 and legacy bearer tokens are rejected, which locks out legacy username/password users.

### 4. Anything else

- [ ] 4.1 `VITE_GEMINI_API_KEY`, `GEMINI_API_KEY` and `VITE_OCR_ENDPOINT` are documented in `docs/ENVIRONMENT_VARIABLES.md` and `app/.env.example`, but no code reads them, and no Google API key appears in history. If you ever created such keys, check Vercel and your machines, revoke them in the Google Cloud console and delete the variables. Anything prefixed `VITE_` is bundled into the browser. done on: ____
- [ ] 4.2 Optional: restrict the Firebase web API key by HTTP referrer and API in the Google Cloud console, and consider Firebase App Check. The key is public by design, so this is hardening and not rotation. done on: ____

### 5. Close out

- [ ] 5.1 Decide what to do about git history (see "Git history" below) and record it here: accepted the risk after rotation, or scrubbed it. Which, and why: ____ done on: ____
- [ ] 5.2 Change the status block at the top of this file to say what was rotated and when, using the dates above, and to state the history decision from 5.1. done on: ____
- [ ] 5.3 Optional, after rotation: trim the parts of `AUDIT_REPORT.md` that spell out how to pull the values out of history (the `git log -p` command and commit range). Not needed if you scrubbed history. done on: ____
- [ ] 5.4 Close issue #22 with the dates from steps 1.7 and 2.1 and the history decision from 5.1. done on: ____

## Git history

Rotating makes the leaked values worthless. The old commits stay readable either way, so you must choose what to do about them. This is your decision; nothing here does it automatically.

- **Accept the risk once rotated (default).** After steps 1 and 2 the exposed Neon password and Stack key are dead, so history holds no working credential. No force-push, no coordination. Recommended unless you have a reason to scrub.
- **Scrub history.** Use `git filter-repo` (or BFG Repo-Cleaner; the Git project itself discourages `git filter-branch`), rewrite every branch and tag, and force-push all of them. Every collaborator must re-clone, and open pull requests will break. Even then, GitHub keeps `refs/pull/*` (read-only) and can serve commits by SHA, so you would also have to ask GitHub Support to remove cached views and unreachable commits, and removal is not guaranteed. Scrubbing without rotating first protects nothing.

Whichever you choose, write it down in step 5.1 ("accepted the risk" or "scrubbed", with the date). Issue #22 asks for that decision to be on record.

To see exactly which commits carry which rule hits, run this on a **full** copy (a shallow clone is partial; the tool warns when it detects one):

```bash
git clone --mirror https://github.com/paccloud/Fish_Cost_Calculator.git fish-mirror.git
cd fish-mirror.git
node /path/to/your/checkout/scripts/check-secrets.mjs --history
```

It prints commit, file path, rule and a count, never the value. Hits are expected until history is scrubbed, which is why CI does not run this mode. It reads every line each commit added on every ref, including UTF-16 files and lines a merge conflict resolution introduced, together with two lines of unchanged context so that a value added under an unchanged `name:` line is still recognised. Only matches that touch an added line are reported, so a later commit is not blamed for an old value that merely sits next to its change. If `git log` itself fails it exits 2 and prints git's first error line; treat that as "not scanned", never as "clean".

## Prevention

- **CI secret scan.** The `Secret scan` job in `.github/workflows/ci.yml` runs `node scripts/check-secrets.mjs` (Node 20, no dependencies, 5-minute timeout) on every pull request targeting `main` and every push to `main`. It scans every git-tracked file and fails the build on a hit. Run the same command locally before you push.
  - What it scans: file contents decide, not names. The only deliberate exclusions are exact lockfile names (`package-lock.json`, `yarn.lock`, ...), submodule pointers (no content in this repo) and verified-binary files (see below); `.claude/skills/`, other `*.lock` files and text files with an image-like extension are scanned. UTF-16 and UTF-32 files (BOM or not) are decoded, and a tracked symlink is scanned as its target text. File names are read as raw bytes, so a name that is not valid UTF-8 is still opened and scanned. The summary line says how many files were skipped and why. It fails closed: a tracked text file over 5 MB, or a tracked file that exists but cannot be read (permissions, a directory in its place, an I/O error), fails the build with a message naming the count and the paths. A tracked file that is missing from the working tree (deleted before commit, or sparse checkout) is scanned from the git index instead, and the summary says so; a CI checkout has none.
  - Rules: URLs with an embedded real password (any scheme, plus `curl -u user:password`), PEM private keys, AWS access key IDs, Google API keys, GitHub tokens, Slack tokens, Stripe live keys, Neon API keys and role passwords (`napi_`, `npg_` prefixes), Stack Auth secret keys (`ssk_`), JWT-shaped tokens, SQL statements that set a role password to a literal, `jwt.sign`/`jwt.verify` called with a random-looking string literal, secret-like names assigned a literal (a quoted value counts as a whole even when it contains spaces, and an unquoted YAML, ini or dotenv value runs to the end of the line, but a sentence such as "Passwords do not match" is treated as a message and not a passphrase; YAML block scalars are read; also `name:`/`value:` pairs split over two lines; in env, shell and Compose files the literal default or alternate of a `${NAME:-literal}` expansion is checked, as is literal text next to a reference such as `${NAME}suffix`, while a pure `${NAME}`, `$NAME` or `${NAME:?message}` is not; the same expansion check applies to a password inside a URL or after `curl -u`, so a URL password of the form `${DB_PASSWORD:-<a real default>}` is a finding while `user:${DB_PASSWORD}@host` is not; a name written as a quoted property, `config['JWT_SECRET'] = '...'` (single, double or backtick quotes, `obj?.[...]`, nested chains, `{ ['NAME']: '...' }`), is judged like `config.JWT_SECRET`; Makefile `?=`/`+=` and Dockerfile `ENV NAME value` are recognised), and `process.env.<SECRET-like name> || "literal"` fallbacks (dot or bracket access, destructuring defaults, wrapped lines, Python `os.getenv`). A name may be written in any assignment shape, including inside another object literal or a minified one-line JSON (`x=1;NAME='v'`, `{"a":{"NAME":"v"}}`): a non-secret assignment never hides the one after it.
  - How strict: a secret-like name is one that ends in `secret`, `password`/`pass`/`pwd`, `token` or a qualified `key` (`api_key`, `private_key`, `signing_key`, `encryption_key`, ...). In env, config and Markdown files such a name with any real-looking value of 8 or more characters is a finding, with no entropy test. In source code (JS, TS, Python, SQL, HTML, ...) only a quoted, random-looking literal counts, so ordinary identifiers and test fixtures do not trip it.
  - Placeholders pass: `your_...`, `change-me`, `user:password@host`, `example`, `xxxx`, `<...>`, `REDACTED`, empty values, `process.env` / `import.meta.env` references, encrypted (`ENC[...]`) and hashed values, and a value cut off with a trailing `...`. A marker inside a longer value (`...`, `***`, `<x>`) only counts when it stands for most of the value. Hosts `example.com`/`.org`/`.net`, `*.example`, `*.test`, `*.invalid` and loopback may sit next to a password; a host that merely contains the word "example" may not. One documentation sample is allowed in `docs/API.md` only, and only when it is the whole assigned value (the sample with anything added before or after it is still a finding).
  - The report prints file, line and rule name only, never the matched text.
  - A false positive: use an obvious placeholder, or put `check-secrets:allow` in a comment on that line (for a match that spans lines, any of its lines). A real hit: remove the value **and rotate the credential**; deleting the line does not un-leak it.
  - It is a heuristic over the checked-out files. It does not find a secret stored under a name that does not mention one (for example `DB_LOGIN=`), values built up in code, secrets inside binary or compressed files, or a raw `/` in a URL password. It scans the working tree, so content that is staged but no longer in the working tree is only seen through `--history`. A file counts as binary only with a NUL byte in its first 8 KB AND a known binary signature (PNG, JPEG, ZIP, PDF, ELF, gzip, ...); any other content, including a text file with a stray NUL byte, is decoded (NULs removed) and scanned. Text in an encoding other than UTF-8, UTF-16 or UTF-32 is read as UTF-8, which is enough for an ASCII secret. Limits that are bounds, not exclusions: an identifier longer than 1 KB is not treated as an assignment name, a quoted value longer than 4 KB and a YAML block scalar longer than 60 lines are only judged in part, and a URL password written as a command substitution with spaces (`$(echo ...)`) is not judged. It does not read history unless you pass `--history`, and it does not replace GitHub's own scanning.
  - `--history` (owner-run) exits 1 on a hit and 2 when the audit is incomplete: a file version too large to scan, a shallow clone, or a git failure. In those cases it says how many versions were NOT scanned and never prints "no hits". Only commits reachable from a ref are read (not dangling objects or the reflog).
  - Tests: `app/src/lib/__tests__/checkSecrets.test.js` (run by `cd app && npm test`). They include detection rates over generated secrets and scan-time limits on hostile input.
- [ ] **Owner: enable GitHub secret scanning and push protection** in the repository's Settings, under Code security. Only the owner can. Push protection blocks a push that contains a recognised provider token before it lands. done on: ____
- **Tracked env files are a footgun.** `app/.env.development` and `app/.env.production` are tracked, so a real value pasted into them gets committed. Keep them placeholder-only (CI checks). `app/.env.example`, `docs/ENVIRONMENT_VARIABLES.md` and `CLAUDE.md` now tell developers to work in the untracked `app/.env.development.local`. Untracking the two files in favour of `app/.env.example` is worth considering, but it is your call: `scripts/` reads `app/.env.development`, and Vite loads `app/.env.production` during `vite build`.

## For new developers

Real values go only in untracked files. Never commit them, and never ask for credentials in chat, issues or PRs.

1. Frontend (Vite): `cp app/.env.example app/.env.development.local`. Vite loads that file after `app/.env.development` and it overrides that file; it is gitignored. The `VITE_FIREBASE_*` values come from Firebase Console, Project settings, your web app. They are public identifiers, not secrets. Never copy the template over the tracked `app/.env.development` or `app/.env.production`.
2. Local Express server: create `server/.env` (see `server/.env.example`). It needs `FIREBASE_PROJECT_ID` (the same Firebase project as the frontend), `ALLOWED_ORIGINS`, and `JWT_SECRET` for legacy login.
3. Vercel-based local testing (`vercel dev`): use a root `.env.local` created by `vercel env pull`.
4. Database credentials come from the Neon console or from `vercel env pull`, not from a team lead's message. The scripts in `scripts/` (`import-fish-data-to-neon.js`, `migrate-sqlite-to-neon.js`) load only the tracked `app/.env.development`, and `dotenv` does not override variables already set in your shell. So `export DATABASE_URL=...` in your shell for that session instead of writing a real string into the tracked file.
5. Auth is Firebase (email/password and Google). Do not configure Stack Auth; it is retired.

### Gitignored files

`.gitignore` covers `.env`, `.env.local`, `.env.development.local`, `.env.test.local`, `.env.production.local` and the catch-all `.env*.local`, plus `*.db`, `*.sqlite`, `uploads/` and `.vercel`.

Tracked, placeholders only: `app/.env.development`, `app/.env.production`, `app/.env.example`, `server/.env.example`.

## Production deployment

Set environment variables in the Vercel dashboard (Production, Preview and Development), not in committed files. The secret-bearing ones are `DATABASE_URL` and `JWT_SECRET`; `FIREBASE_PROJECT_ID` and `ALLOWED_ORIGINS` are public configuration. Changes only reach new deployments, so redeploy. `app/.env.production` is a template, but Vite loads it during the build: a `VITE_*` variable missing from Vercel silently falls back to its placeholder and breaks auth without an error. Consider pointing Preview deployments at a separate Neon branch instead of the production data.
