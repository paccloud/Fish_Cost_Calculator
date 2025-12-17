# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local Catch is a fish yield calculator for the seafood industry. It calculates the true cost of fish products after accounting for processing yields, helping fishers and processors determine prices for finished products.

## Commands

### Development
```bash
# Frontend (Vite + React) - runs on http://localhost:5173
cd app && npm run dev

# Backend (Express + SQLite) - runs on http://localhost:3000
cd server && node server.js

# Lint frontend
cd app && npm run lint

# Build frontend for production
cd app && npm run build
```

### First-time Setup
```bash
cd app && npm install
cd ../server && npm install
```

## Architecture

### Frontend (`app/`)
- **React 19 + Vite 7** with Tailwind CSS
- Entry: `src/main.jsx` → `src/App.jsx`
- Routes defined in `App.jsx`: `/` (Calculator), `/login`, `/upload`, `/about`, `/data-sources`, `/manage-data`
- Main calculator logic in `src/components/Calculator.jsx`
- Fish yield data in `src/data/fish_data_v3.js` - contains 60+ species with conversion yields from MAB-37 research publication
- Auth state managed via React Context in `src/context/AuthContext.jsx`

### Backend (`server/`)
- **Express 5** server with SQLite database (`fish_app.db`)
- Single file: `server.js` handles all API routes
- JWT authentication with bcrypt password hashing
- File uploads via multer for Excel/CSV import

### Data Flow
1. Fish yield data is static in `fish_data_v3.js` (from MAB-37 PDF research document)
2. Users can add custom yield data stored in SQLite `user_data` table
3. Calculator merges static + user data, performs yield/cost calculations client-side
4. Saved calculations stored in SQLite `calculations` table

### Key Data Structures
Fish conversions use "From State → To Product" pattern with yield percentages:
```javascript
"Pink Salmon": {
  conversions: {
    "Round → D/H-On": { yield: 91, range: [84, 94] },
    "Round → Skinless Fillet": { yield: 42, range: [41, 46] }
  }
}
```
Common acronyms: Round (whole fish), D/H-On (dressed/head-on), D/H-Off (dressed/head-off), S/B or SIB (skinless/boneless)

## API Endpoints

Auth: `POST /api/register`, `POST /api/login`
Calculations: `GET/POST /api/saved-calcs`, `POST /api/save-calc`
User Data: `GET/POST/PUT/DELETE /api/user-data`, `POST /api/upload-data` (Excel/CSV)

All endpoints except register/login require JWT Bearer token.

## Git Workflow

**IMPORTANT: Always use feature branches for ALL work, including bug fixes.**

### Branch Naming Convention
- Features: `feature/<short-description>`
- Bug fixes: `fix/<short-description>`
- Refactors: `refactor/<short-description>`
- Docs: `docs/<short-description>`

### Required Workflow
1. **Create a new branch** before starting any work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes** and commit frequently with clear messages

3. **Push the branch** to remote:
   ```bash
   git push -u origin feature/your-feature-name
   ```

4. **Create a Pull Request** using GitHub CLI:
   ```bash
   gh pr create --title "Your PR title" --body "Description of changes"
   ```

5. **Never commit directly to main** - all changes must go through PRs

### Commit Message Format
- Use present tense ("Add feature" not "Added feature")
- Keep first line under 70 characters
- Reference issue numbers when applicable
