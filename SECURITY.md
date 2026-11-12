# Security Policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue, pull request or discussion for them.

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Fill in the form and submit it.

The direct link is <https://github.com/paccloud/Fish_Cost_Calculator/security/advisories/new>. Only the maintainers can read a report made this way.

If the **Report a vulnerability** button is not shown, private reporting is turned off. In that case open a public issue that says only "I would like to report a security problem privately" and gives no details, and a maintainer will open a private channel with you.

## What to include

- What the problem is and what someone could do with it.
- Where it is: the page, the API endpoint or the file and line.
- Steps to reproduce it, or a proof of concept.
- The commit or the date you tested.

Never paste a real credential, token or other person's data into a report. Say where it is (file, line and commit) and what kind of value it is. That is enough for us to find it.

## What is in scope

- The app in `app/`.
- The API in `api/`, `server/` and `shared/`.
- The scripts and workflows in `scripts/` and `.github/`.
- Secrets or personal data found in this repository or its git history.

Reports about third-party services the app uses (Firebase, Vercel, Neon, GitHub) belong with those services, unless the problem is in how this project uses them.

## What to expect

- A first reply within about a week. This is a small project, so it can take longer at busy times.
- We will tell you whether we can reproduce the problem and what we plan to do, and keep you informed until it is closed.
- When a fix is released we publish a security advisory. We credit the reporter if they want to be named.
- There is no bug bounty.

Please give us a reasonable time to fix the problem before making it public.

## Supported versions

Only the current `main` branch, which is what is deployed, receives security fixes.

## Known incident

Credentials were committed to this repository in December 2025 and remain in its git history. [`SECURITY_NOTICE.md`](SECURITY_NOTICE.md) records what leaked and the rotation checklist. You do not need to report that leak again. A credential that the notice does not list is worth a report.
