# API Documentation

This document provides detailed API documentation with example requests and responses.

## Base URL

```
Development: http://localhost:3000
```

## Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

---

## Authentication Endpoints

### Register New User

Create a new user account.

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
  "message": "User created successfully"
}
```

**Error Response (400):**

```json
{
  "error": "Username already exists"
}
```

---

### Login

Authenticate and receive a JWT token.

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
  "user": {
    "id": 1,
    "username": "fisherman_joe"
  }
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

**Endpoint:** `POST /api/save-calc`

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
  "mode": "cost",
  "cost": 8.5,
  "target_weight": 0,
  "yield": 46,
  "result": 18.48
}
```

**Success Response (200):**

```json
{
  "message": "Calculation saved"
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
    "name": "Sockeye - Round to Fillet",
    "species": "Sockeye Salmon",
    "product": "Round → Skinless Fillet",
    "mode": "cost",
    "cost": 8.5,
    "yield": 46,
    "result": 18.48,
    "date": "2024-12-16T10:30:00.000Z"
  },
  {
    "id": 2,
    "name": "Halibut Steaks",
    "species": "Pacific Halibut",
    "product": "Round → Steaks",
    "mode": "cost",
    "cost": 12.0,
    "yield": 62,
    "result": 19.35,
    "date": "2024-12-15T14:22:00.000Z"
  }
]
```

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
    "source": "Personal processing data 2024"
  },
  {
    "id": 2,
    "species": "Rainbow Trout",
    "product": "Smoked",
    "yield": 35,
    "source": "Smokehouse testing"
  }
]
```

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

**Success Response (200):**

```json
{
  "id": 3,
  "message": "Added successfully"
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

**Success Response (200):**

```json
{
  "message": "Updated successfully"
}
```

**Error Response (404):**

```json
{
  "error": "Entry not found or not owned by user"
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

### Upload Yield Data File

Upload an Excel (.xlsx, .xls) or CSV file with multiple yield entries.

**Endpoint:** `POST /api/upload-data`

**Headers:**

```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request Body:**

- `file` - The Excel/CSV file to upload

**Expected File Format:**

| species         | product         | yield |
| --------------- | --------------- | ----- |
| Atlantic Salmon | Skinless Fillet | 48.5  |
| Rainbow Trout   | Smoked          | 35    |

**Success Response (200):**

```json
{
  "message": "Successfully uploaded 15 records"
}
```

**Error Response (400):**

```json
{
  "error": "Invalid file format. Please upload .xlsx, .xls, or .csv"
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
| 404  | Not Found - Resource doesn't exist   |
| 500  | Server Error - Something went wrong  |

---

## Rate Limiting

Currently no rate limiting is implemented. For production deployment, consider adding:

- 100 requests per minute per IP for unauthenticated endpoints
- 300 requests per minute per user for authenticated endpoints

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
