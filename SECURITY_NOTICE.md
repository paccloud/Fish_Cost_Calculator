# Security Notice: Environment Variable Cleanup

## Actions Taken

The following files have been secured by replacing real credentials with placeholder values:

### 1. `app/.env.development`
- **Status**: Tracked in git, now contains only placeholders
- **Local secrets moved to**: `app/.env.development.local` (gitignored)

### 2. `app/.env.production`
- **Status**: Tracked in git, now contains only placeholders
- **Local secrets moved to**: `app/.env.production.local` (gitignored)

### Already Secure Files
- `.env.local` - Already gitignored, contains Vercel-generated credentials
- `app/.env` - Already gitignored, contains real credentials
- `server/.env` - Already gitignored, contains configuration

## Exposed Credentials

The following credentials were previously committed to the repository and **MUST be rotated immediately**:

### Stack Auth (Neon Auth)
- **Project ID**: [REDACTED - rotate immediately]
- **Publishable Client Key**: [REDACTED - rotate immediately]
- **Secret Server Key**: [REDACTED - rotate immediately]
- **Action Required**: Regenerate keys in Stack Auth dashboard at https://app.stack-auth.com

### Neon Database
- **Database URL**: [REDACTED - reset password immediately]
- **Username**: [REDACTED - reset password immediately]
- **Password**: [REDACTED - reset password immediately]
- **Action Required**: Reset database password in Neon dashboard at https://console.neon.tech

## Immediate Action Items

1. **Rotate Stack Auth Credentials**
   - Go to Stack Auth dashboard
   - Generate new project keys
   - Update `app/.env.development.local` and `app/.env.production.local`
   - Update Vercel environment variables

2. **Rotate Neon Database Password**
   - Go to Neon console
   - Reset the database owner password
   - Update all `.env*.local` files with new connection string
   - Update Vercel environment variables
   - Update `.env.local` file

3. **Update Vercel Environment Variables**
   - Go to Vercel dashboard → Settings → Environment Variables
   - Update all rotated credentials
   - Redeploy the application

4. **Clean Git History (Optional but Recommended)**
   - Consider using tools like `git filter-branch` or `BFG Repo-Cleaner` to remove exposed secrets from git history
   - Note: This requires force-pushing and coordinating with all repository collaborators

## For New Developers

When setting up this project locally:

1. Copy template files to create local environment files:
   ```bash
   cp app/.env.development app/.env.development.local
   cp app/.env.production app/.env.production.local
   ```

2. Request the real credentials from a team lead and update the `.local` files

3. **Never commit `.env*.local` files** - they are gitignored for security

## Files Currently Gitignored

The following patterns are in `.gitignore` to protect credentials:
- `.env`
- `.env.local`
- `.env.development.local`
- `.env.test.local`
- `.env.production.local`
- `.env*.local` (catch-all)

## Production Deployment

For Vercel deployments, environment variables should be set in the Vercel dashboard, not in committed files. The `.env.production` file serves only as a template showing which variables are needed.
