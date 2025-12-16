# Architecture Overview

This document provides a technical overview of the Scale & Cost Fish Calculator architecture.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                React Frontend (Vite)                 │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │    │
│  │  │ Calculator  │ │ Data Mgmt   │ │ Auth Context │  │    │
│  │  └─────────────┘ └─────────────┘ └──────────────┘  │    │
│  │                        │                            │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │        fish_data_v3.js (60+ species)         │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  └─────────────────────────┬───────────────────────────┘    │
└────────────────────────────┼────────────────────────────────┘
                             │ HTTP/REST
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                        SERVER                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Express.js API (Port 3000)              │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────┐   │    │
│  │  │ Auth (JWT) │ │ User Data  │ │ Calculations   │   │    │
│  │  │ /register  │ │ CRUD       │ │ Save/Load      │   │    │
│  │  │ /login     │ │ /user-data │ │ /save-calc     │   │    │
│  │  └────────────┘ └────────────┘ └────────────────┘   │    │
│  └─────────────────────────┬───────────────────────────┘    │
│                            │                                 │
│  ┌─────────────────────────▼───────────────────────────┐    │
│  │              SQLite Database (fish_app.db)           │    │
│  │  ┌────────┐  ┌──────────────┐  ┌───────────────┐    │    │
│  │  │ users  │  │ calculations │  │  user_data    │    │    │
│  │  └────────┘  └──────────────┘  └───────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Static Fish Data

```
fish_data_v3.js → Calculator.jsx
                   └── Species dropdown
                   └── From/To conversions
                   └── Yield percentages
```

### 2. User Authentication

```
Login Form → /api/login → JWT Token → localStorage
                                      ↓
                               AuthContext
                                      ↓
                          Protected Routes/Features
```

### 3. Custom User Data

```
User Input → DataManagement.jsx → /api/user-data → SQLite
     ↓                                    ↓
Calculator.jsx ← Merged with fish_data_v3.js
```

## Key Components

### Frontend Components

| Component              | Purpose                    | Key Dependencies           |
| ---------------------- | -------------------------- | -------------------------- |
| `Calculator.jsx`       | Main calculation interface | fish_data_v3, AuthContext  |
| `DataManagement.jsx`   | CRUD for user yield data   | AuthContext, fetch API     |
| `DataTransparency.jsx` | Display data sources       | fish_data_v3 (DATA_SOURCE) |
| `Login.jsx`            | Authentication UI          | AuthContext                |
| `UploadData.jsx`       | Excel/CSV import           | AuthContext, FormData      |
| `About.jsx`            | Project info, support      | -                          |

### Data Structures

#### fish_data_v3.js

```javascript
// Species entry structure
{
  "Species Name": {
    scientific_name: "Latin name",
    category: "Category",
    conversions: {
      "From State → To State": {
        yield: 45,        // Average yield %
        range: [40, 50]   // Min/Max range
      }
    }
  }
}

// Legacy format (auto-generated for backward compatibility)
FISH_DATA[species][product] = {
  yield: "45",
  range: "40-50",
  from: "Round",
  to: "Fillets",
  scientificName: "Latin name"
}
```

### API Authentication

All protected endpoints require:

```
Authorization: Bearer <jwt_token>
```

JWT payload contains:

```javascript
{ id: userId, username: "user" }
```

## Security Considerations

1. **Password Hashing** - bcrypt with salt rounds
2. **JWT Tokens** - Should use environment variable for secret in production
3. **CORS** - Currently open; restrict in production
4. **Input Validation** - Basic validation; add sanitization for production

## Future Improvements

- [ ] TypeScript migration
- [ ] PostgreSQL for production
- [ ] Unit/integration tests
- [ ] Docker containerization
- [ ] CI/CD pipeline
- [ ] Rate limiting
- [ ] Input sanitization
