# Environment Variables Configuration

This document explains how to properly configure environment variables for the Local Catch application.

## Important: No Quotes in .env Files

When setting environment variables in `.env` files, **do NOT use quotes** around the values unless the quotes are part of the actual value. Vite will include quotes as part of the value if you add them.

### ❌ Wrong (with quotes)
```bash
VITE_STACK_PROJECT_ID='a55799cf-aec1-4699-94ce-fb42094552d9'
VITE_STACK_PUBLISHABLE_CLIENT_KEY='pck_cn8y47v9g8029134473btakf840y8feyar4jnkmjq2268'
```

### ✅ Correct (without quotes)
```bash
VITE_STACK_PROJECT_ID=a55799cf-aec1-4699-94ce-fb42094552d9
VITE_STACK_PUBLISHABLE_CLIENT_KEY=pck_cn8y47v9g8029134473btakf840y8feyar4jnkmjq2268
```

## Vercel Environment Variables

When adding environment variables to Vercel (either via dashboard or CLI), ensure they are added without quotes:

```bash
# Using printf to avoid quotes
printf 'your-value-here' | vercel env add VARIABLE_NAME production
```

## Required Environment Variables

### Frontend (Vite) - Client-side
These are bundled into the client code and exposed to the browser:
- `VITE_STACK_PROJECT_ID` - Stack Auth project ID
- `VITE_STACK_PUBLISHABLE_CLIENT_KEY` - Stack Auth public key
- `VITE_API_URL` - API base URL (empty for production, http://localhost:3000 for dev)

### Backend (Vercel Functions) - Server-side only
These are only accessible on the server:
- `STACK_PROJECT_ID` - Stack Auth project ID (server-side)
- `STACK_SECRET_SERVER_KEY` - Stack Auth secret key (**NEVER expose to client**)
- `JWT_SECRET` - Secret for signing JWT tokens
- `DATABASE_URL` - PostgreSQL connection string
- All `POSTGRES_*` and `PG*` variables from Neon

## Common Issues

### "Invalid project ID" Error
If you see an error like "Invalid project ID: ... Project IDs must be UUIDs", this usually means:
1. The environment variable has quotes around it
2. The environment variable wasn't set correctly in Vercel
3. The build needs to be redeployed after fixing the variables

**Solution**: Remove quotes from all environment variables and redeploy.

### Authentication 401 Errors
If you get 401 Unauthorized errors when logged in with OAuth:
1. Check that `VITE_STACK_PROJECT_ID` and `VITE_STACK_PUBLISHABLE_CLIENT_KEY` are set in Vercel
2. Verify they don't have quotes around them
3. Redeploy the application

## Local Development Setup

1. Copy `.env.example` to `.env.development`:
   ```bash
   cp app/.env.example app/.env.development
   ```

2. Fill in your values **without quotes**:
   ```bash
   VITE_API_URL=http://localhost:3000
   VITE_STACK_PROJECT_ID=your-project-id-here
   VITE_STACK_PUBLISHABLE_CLIENT_KEY=your-key-here
   DATABASE_URL=your-connection-string-here
   ```

3. Never commit `.env`, `.env.development`, or `.env.production` files - they're gitignored for security.

## Production Deployment

Environment variables for production are managed in Vercel:
1. Go to Vercel dashboard → Project Settings → Environment Variables
2. Add variables without quotes
3. Select appropriate environments (Production, Preview, Development)
4. Redeploy to apply changes
