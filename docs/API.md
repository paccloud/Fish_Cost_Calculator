# API Documentation

This document provides detailed API documentation with example requests and responses.

> **This API is being replaced.** [ADR 0001](adr/0001-firebase-auth-and-firestore.md) removes both backends (`api/` on Vercel and the local `server/`) in favour of Firebase Auth and Cloud Firestore reached directly from the browser (issues #123–#133). Until then this API gets fixes only. Do not build new clients against it.

## Base URL

```text
Development: http://localhost:3000   (server/server.js, Express + SQLite)
Production:  same origin as the app  (api/*.js, Vercel functions + Neon PostgreSQL)
```

Both backends run the same handlers from `shared/handlers/`, so responses match unless a section says otherwise. One difference applies everywhere: PostgreSQL returns `DECIMAL` columns as strings, so in production `cost`, `yield` and `result` arrive as `"8.50"`, `"46.00"` and `"18.48"`, while the local server returns numbers. The local server (SQLite) also returns booleans as `1` or `0` and timestamps as `2024-12-16 10:30:00` (UTC). The examples below show numbers, `true`/`false` and ISO timestamps.

## Authentication

Most protected endpoints require authentication. During the Firebase migration,
the API accepts either a Firebase Auth ID token or the legacy password-login JWT
in the Authorization header:

```http
Authorization: Bearer <firebase_id_token_or_legacy_jwt>
```

---

## Authentication Endpoints

### Register New User (Legacy Password Migration)

Create a legacy password user account. New browser clients should use Firebase
Auth and send Firebase ID tokens to protected endpoints; this endpoint remains
only for the temporary password-login compatibility path while `JWT_SECRET` is
enabled.

**Endpoint:** `POST /api/register`

**Request Body:**

```json
{
  "username": "fisherman_joe",
  "password": "securePassword123"
}
```

**Success Response (201):**

```json
{
  "id": 1,
  "username": "fisherman_joe"
}
```

**Error Response (409):**

```json
{
  "error": "Username already exists"
}
```

---

### Login (Legacy Password Migration)

Authenticate a legacy password user and receive a JWT token. New clients should
use Firebase Auth instead of integrating against this JWT flow.

**Endpoint:** `POST /api/login`

**Request Body:**

```json
{
  "username": "fisherman_joe",
  "password": "securePassword123"
}
```

**Success Response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "username": "fisherman_joe",
  "expiresIn": 86400
}
```

**Error Response (401):**

```json
{
  "error": "Invalid credentials"
}
```

---

## Calculations Endpoints

### Save Calculation

Save a yield/cost calculation to user history.

**Endpoint:** `POST /api/saved-calcs` (`POST /api/save-calc` is the old name for the same endpoint)

**Headers:**

```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "name": "Sockeye - Round to Fillet",
  "species": "Sockeye Salmon",
  "product": "Round → Skinless Fillet",
  "cost": 8.5,
  "yield": 46,
  "result": 18.48
}
```

The remote calculation history schema stores the calculation result, cost, product, and yield. Mode-specific client metadata such as input-weight mode and target output weight remains local-only unless a future schema migration adds remote columns for those fields.

Optional: send `"client_id"` (any stable string, such as a UUID) to make the request safe to retry. A second request with the same `client_id` returns the row that already exists and does not create another.

A calculation is private when saved. The date is set by the server.

**Success Response (200):**

```json
{
  "id": 1,
  "created_at": "2024-12-16T10:30:00.000Z",
  "updated_at": "2024-12-16T10:30:00.000Z",
  "message": "Calculation saved successfully"
}
```

---

### Get Saved Calculations

Retrieve all saved calculations for the authenticated user.

**Endpoint:** `GET /api/saved-calcs`

**Headers:**

```
Authorization: Bearer <token>
```

**Success Response (200):**

```json
[
  {
    "id": 1,
    "user_id": 7,
    "name": "Sockeye - Round to Fillet",
    "species": "Sockeye Salmon",
    "product": "Round → Skinless Fillet",
    "cost": 8.5,
    "yield": 46,
    "result": 18.48,
    "date": "2024-12-16T10:30:00.000Z",
    "client_id": "0b6a8f0e-2f1c-4c58-9d0a-6a4f6f5d2b11",
    "is_private": true,
    "created_at": "2024-12-16T10:30:00.000Z",
    "updated_at": "2024-12-16T10:30:00.000Z"
  },
  {
    "id": 2,
    "user_id": 7,
    "name": "Halibut Steaks",
    "species": "Pacific Halibut",
    "product": "Round → Steaks",
    "cost": 12.0,
    "yield": 62,
    "result": 19.35,
    "date": "2024-12-15T14:22:00.000Z",
    "client_id": null,
    "is_private": true,
    "created_at": "2024-12-15T14:22:00.000Z",
    "updated_at": "2024-12-15T14:22:00.000Z"
  }
]
```

Newest first.

---

### Delete Saved Calculation

Delete one of the authenticated user's calculations.

**Endpoint:** `DELETE /api/saved-calcs/:id`

**Success Response (200):**

```json
{
  "message": "Calculation deleted"
}
```

**Errors:** `400` (`Invalid calculation id`), `403` (`Forbidden`, the calculation belongs to someone else), `404` (`Calculation not found`).

---

### Publish or Unpublish a Calculation

Make one of the authenticated user's calculations appear in, or disappear from, `GET /api/public-calcs`.

**Endpoints:** `PATCH /api/saved-calcs/:id/publish` and `PATCH /api/saved-calcs/:id/unpublish`

**Production only.** The local Express server has no route for these and answers `404`.

**Success Response (200):** publish returns the calculation row with `"is_private": false`; unpublish returns `{"message": "Calculation unpublished"}`.

**Errors:** `400`, `403` and `404` as for delete.

---

## User Data Endpoints

### Get User's Custom Yield Data

Retrieve all custom yield entries for the authenticated user.

**Endpoint:** `GET /api/user-data`

**Headers:**

```
Authorization: Bearer <token>
```

**Success Response (200):**

```json
[
  {
    "id": 1,
    "species": "Atlantic Salmon",
    "product": "Skinless Fillet",
    "yield": 48.5,
    "source": "Personal processing data 2024",
    "is_shared": false,
    "client_id": null,
    "revision": 1,
    "created_at": "2024-12-16T10:30:00.000Z",
    "updated_at": "2024-12-16T10:30:00.000Z"
  },
  {
    "id": 2,
    "species": "Rainbow Trout",
    "product": "Smoked",
    "yield": 35,
    "source": "Smokehouse testing",
    "is_shared": true,
    "client_id": null,
    "revision": 3,
    "created_at": "2024-12-10T09:00:00.000Z",
    "updated_at": "2024-12-15T14:22:00.000Z"
  }
]
```

`revision` goes up by one on every successful update. Send it back as `expected_revision` when updating or deleting (below).

---

### Add Custom Yield Entry

Add a new custom yield entry.

**Endpoint:** `POST /api/user-data`

**Headers:**

```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "species": "Atlantic Salmon",
  "product": "Skinless Fillet",
  "yield": 48.5,
  "source": "Personal processing data 2024"
}
```

`source` is optional and defaults to `"User Input"`. An optional `"client_id"` makes the request safe to retry, as for saved calculations.

**Success Response (200):**

```json
{
  "id": 3,
  "revision": 1,
  "created_at": "2024-12-16T10:30:00.000Z",
  "updated_at": "2024-12-16T10:30:00.000Z",
  "message": "Data added successfully"
}
```

**Error Response (400):**

```json
{
  "error": "Species, product, and yield are required"
}
```

---

### Update Custom Yield Entry

Update an existing yield entry. Users can only update their own entries.

**Endpoint:** `PUT /api/user-data/:id`

**Headers:**

```
Authorization: Bearer <token>
Content-Type: application/json
```

**URL Parameters:**

- `id` - The ID of the entry to update

**Request Body:**

```json
{
  "species": "Atlantic Salmon",
  "product": "Skin-On Fillet",
  "yield": 52,
  "source": "Updated processing data"
}
```

Optional: add `"expected_revision"` (a positive integer, the `revision` you last read). If the entry has changed since, nothing is written and the answer is `409`.

**Success Response (200):**

```json
{
  "message": "Updated successfully",
  "id": 1,
  "revision": 2,
  "updated_at": "2024-12-16T11:00:00.000Z"
}
```

**Error Response (404):**

```json
{
  "error": "Entry not found or not owned by user"
}
```

**Error Response (409):**

```json
{
  "error": "Conflict: revision has changed since last read"
}
```

---

### Delete Custom Yield Entry

Delete a yield entry. Users can only delete their own entries.

**Endpoint:** `DELETE /api/user-data/:id`

**Headers:**

```
Authorization: Bearer <token>
```

**URL Parameters:**

- `id` - The ID of the entry to delete

**Query Parameters:**

- `expected_revision` - Optional. As for update: a stale value gets `409` and nothing is deleted.

**Success Response (200):**

```json
{
  "message": "Deleted successfully"
}
```

**Error Response (404):**

```json
{
  "error": "Entry not found or not owned by user"
}
```

---

### Share or Unshare a Custom Yield Entry

Add one of the authenticated user's entries to the public community feed (`GET /api/community-data`), or take it out.

**Endpoints:**

- `POST /api/user-data/:id/share`
- `POST /api/user-data/:id/unshare`
- `PATCH /api/user-data/:id` with body `{"is_shared": true}` or `{"is_shared": false}`

**Success Response (200):**

```json
{
  "message": "Shared with community"
}
```

or `"Removed from community"`.

**Errors:** `400` (`isShared (boolean) is required`, for the `PATCH` form), `404` (`Entry not found or not owned by user`).

---

### Upload Yield Data File

Upload an Excel (.xlsx) or CSV file with multiple yield entries. The file may be 4 MB at most. Old-format `.xls` files are refused.

**Endpoint:** `POST /api/upload-data`

**Headers:**

```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request Body:**

- `file` - The Excel/CSV file to upload

**Expected File Format:**

The first row holds the column names. They are matched exactly, capitals included:

| Species         | Product         | Yield (%) | Source           |
| --------------- | --------------- | --------- | ---------------- |
| Atlantic Salmon | Skinless Fillet | 48.5      | Plant records    |
| Rainbow Trout   | Smoked          | 35        |                  |

- Species column: `Species`, `Common name`, `Common Name` or `Name`. Required.
- Yield column: `Yield (%)`, `% Yield` or `Yield`. Required.
- `Product` is optional and defaults to `General`. `Source` is optional and defaults to `Uploaded File`.

This is the layout of the CSV from `GET /api/export?type=data`, so that export can be uploaded again.

Yield values are interpreted as percentage numbers (e.g. `6.5` for 6.5%). Decimal fractions like `0.065` are not auto-converted. The one exception is an `.xlsx` cell formatted as a percentage: a cell showing `42%` is read as 42. A row with no species, no yield, or a yield outside 0 to 100 is skipped.

A row whose species and product match an entry the user already has (ignoring case) updates that entry. Other rows are added.

**Success Response (200):**

```json
{
  "message": "12 added, 2 updated, 1 skipped",
  "inserted": 12,
  "updated": 2,
  "skipped": 1,
  "skippedRows": [9]
}
```

`skippedRows` holds spreadsheet row numbers (the header is row 1).

**Error Response (400):**

```json
{
  "error": "Unsupported file type. Please upload a .csv or .xlsx file."
}
```

The local server words the same refusal as `Invalid file type. Only .xlsx or .csv files are allowed.`, and answers `File too large. Max 4MB.` for a file over the limit.

---

## Export Endpoints

### Export Data as CSV

Export the authenticated user's calculations or custom yield data as a CSV file.

**Endpoint:** `GET /api/export`

**Headers:**

```
Authorization: Bearer <token>
```

**Query Parameters:**

- `type` - `calcs` (default) or `data`
- `format` - `csv` (default) or `xlsx`

**`type=calcs` Response:** file with columns `Date,Species,Conversion,Cost,Yield (%),Result`

**`type=data` Response:** file with columns `Species,Product,Yield (%),Source`

The local server's `.xlsx` files head three columns differently: `Product / Conversion`, `Cost ($/lb)` and `Result ($/lb)`.

**Success Response (200):** `text/csv` or `.xlsx` file download. In CSV, a cell that starts with `=`, `+`, `-` or `@` is prefixed with `'` so a spreadsheet does not run it as a formula.

**Error Response (401):**

```json
{
  "error": "Unauthorized"
}
```

---

## Public Endpoints

### Get Public Calculations

Retrieve the 100 most recent calculations that their owners have published (see Publish or Unpublish a Calculation). Saved calculations are private by default and do not appear here. No authentication required.

**Endpoint:** `GET /api/public-calcs`

**Success Response (200):**

```json
[
  {
    "id": 1,
    "species": "Sockeye Salmon",
    "product": "Round → Skinless Fillet",
    "cost": 8.5,
    "yield": 46,
    "result": 18.48,
    "date": "2024-12-16T10:30:00.000Z"
  }
]
```

---

### Get Contributors

Retrieve opt-in contributor profiles. No authentication required.

**Endpoint:** `GET /api/contributors`

**Success Response (200):**

```json
[
  {
    "id": 1,
    "display_name": "Joe Fisher",
    "organization": "Pacific Catch Co.",
    "bio": "20 years of commercial fishing.",
    "contribution_count": 15
  }
]
```

Only profiles that have turned on "Show on contributors page" and have a display name are listed. The response is an allowlist: it never includes `user_id`, `username`, `email` or `show_on_page`. `id` is the contributor profile's id, not a user id.

---

### Get Community Yield Data

Retrieve every custom yield entry its owner has shared. No authentication required.

**Endpoint:** `GET /api/community-data`

**Query Parameters:**

- `format` - `csv` for a file download (`community-yield-data.csv`); anything else returns JSON

**Success Response (200):**

```json
[
  {
    "id": 2,
    "species": "Rainbow Trout",
    "product": "Smoked",
    "yield": 35,
    "source": "Smokehouse testing",
    "contributor": "Pacific Catch Co. crew",
    "organization": "Pacific Catch Co."
  }
]
```

`contributor` and `organization` are `null` unless the owner has a contributor profile with "Show on contributors page" turned on. No account identifier is ever included. `yield` is a number on both backends.

---

### Get Fish Data

Retrieve the reference yields. No authentication required. The app carries its own copy of this data and works without this endpoint.

**Endpoint:** `GET /api/fish-data`

**Success Response (200):**

```json
{
  "fishData": {
    "Pink Salmon": {
      "scientific_name": "Oncorhynchus gorbuscha",
      "category": "Salmon",
      "conversions": {
        "Round → D/H-On": { "yield": 91, "range": [84, 94] }
      }
    }
  },
  "profiles": {},
  "source": { "title": "Recoveries and Yields from Pacific Fish and Shellfish" }
}
```

`profiles` and `source` are cut short here. The local server returns the contents of `app/src/data/fish_data_v3.js`, as above. Production builds the answer from the `species`, `fish_yields` and `species_profiles` tables in Neon: conversion keys there are the finished product alone (or `From <state>: <product>` when the starting form is not a whole fish), and each conversion also carries `from` and `to`. No script in this repository creates `species_profiles` (`scripts/import-fish-data-to-neon.js` creates a table named `profiles`), so a database built only from those scripts answers `500` here and the app falls back to its own copy.

---

## Contributor Profile Endpoints

### Get or Save the Signed-in User's Contributor Profile

**Endpoints:** `GET /api/contributor` and `POST /api/contributor`. Both need the `Authorization` header.

**POST Request Body:**

```json
{
  "display_name": "Pacific Catch Co. crew",
  "organization": "Pacific Catch Co.",
  "bio": "20 years of commercial fishing.",
  "show_on_page": true
}
```

**Responses:** `GET` returns the profile row, or `404` (`Profile not found`) if there is none. `POST` returns `201` with `{"id": 1, "message": "Profile created successfully"}` the first time and `200` with `{"message": "Profile updated successfully"}` after that.

---

## Read-only Mode

With `API_READ_ONLY=true` set on the server, every request that is not a `GET`, `HEAD` or `OPTIONS` is answered with `503` and the body below. `POST /api/login` stays open. This is for the move to Firebase; see [`move-runbook.md`](move-runbook.md).

```json
{
  "error": "read_only",
  "message": "Local Catch is moving to a new address and no longer accepts changes here. Your data is safe."
}
```

---

## Error Codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 200  | Success                              |
| 201  | Created                              |
| 400  | Bad Request - Invalid input          |
| 401  | Unauthorized - Invalid/missing token |
| 403  | Forbidden - Not yours, or the request's origin is not allowed (CORS) |
| 404  | Not Found - Resource doesn't exist   |
| 405  | Method Not Allowed                   |
| 409  | Conflict - Username taken, or `expected_revision` is stale |
| 429  | Too Many Requests (local server only) |
| 500  | Server Error - Something went wrong  |
| 503  | Read-only mode (see above)           |

---

## Rate Limiting

The local Express server allows 300 requests per minute per IP address across all of `/api` and answers `429` with `{"error": "Too many requests. Please try again later."}` beyond that.

The production Vercel functions have no rate limiting of their own.

---

## Code Examples

### JavaScript (fetch)

```javascript
// Login
const login = async (username, password) => {
  const res = await fetch("http://localhost:3000/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
};

// Get user data with auth
const getUserData = async (token) => {
  const res = await fetch("http://localhost:3000/api/user-data", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

// Add new yield entry
const addYieldEntry = async (token, data) => {
  const res = await fetch("http://localhost:3000/api/user-data", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  return res.json();
};
```

### cURL

```bash
# Login
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"fisherman_joe","password":"securePassword123"}'

# Get user data
curl http://localhost:3000/api/user-data \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Add yield entry
curl -X POST http://localhost:3000/api/user-data \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"species":"Atlantic Salmon","product":"Fillet","yield":48.5}'

# Delete entry
curl -X DELETE http://localhost:3000/api/user-data/1 \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Python (requests)

```python
import requests

BASE_URL = "http://localhost:3000"

# Login
def login(username, password):
    response = requests.post(f"{BASE_URL}/api/login", json={
        "username": username,
        "password": password
    })
    return response.json()

# Get user data
def get_user_data(token):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}/api/user-data", headers=headers)
    return response.json()

# Add yield entry
def add_yield_entry(token, species, product, yield_val, source=""):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    data = {
        "species": species,
        "product": product,
        "yield": yield_val,
        "source": source
    }
    response = requests.post(f"{BASE_URL}/api/user-data",
                            headers=headers, json=data)
    return response.json()
```
