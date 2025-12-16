# 🐟 Scale & Cost - Fish Yield Calculator

A community-driven fish cost calculator for sustainable seafood. Calculate the true cost of fish products after accounting for processing yields, fees, and other factors.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## 🌊 Overview

Scale & Cost helps fishers, processors, and seafood businesses accurately calculate the cost per pound of finished fish products. Whether you're a small-scale fisher selling direct to consumers or a processor managing multiple species, this tool provides the yield data and calculations you need.

### Key Features

- **60+ Species Database** - Comprehensive yield data from salmon to sharks, rockfish to shellfish
- **From → To Conversions** - Calculate yields between any processing states (Round, D/H-On, Fillets, etc.)
- **Cost Calculator** - Factor in processing costs, cold storage, and shipping
- **Weight Calculator** - Determine how much input weight you need for a target output
- **User Accounts** - Save calculations and add your own custom yield data
- **Data Transparency** - Full source attribution and methodology documentation

## 📸 Screenshots

| Calculator                                           | Data Sources                      |
| ---------------------------------------------------- | --------------------------------- |
| Select species, conversion type, and calculate costs | View data sources and methodology |

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/paccloud/Fish_Cost_Calculator.git
cd Fish_Cost_Calculator

# Install frontend dependencies
cd app
npm install

# Install backend dependencies
cd ../server
npm install
```

### Running Locally

**Terminal 1 - Backend Server:**

```bash
cd server
node server.js
# Server runs on http://localhost:3000
```

**Terminal 2 - Frontend:**

```bash
cd app
npm run dev
# App runs on http://localhost:5173
```

## 🏗️ Project Structure

```
Fish_Cost_Calculator/
├── app/                          # React frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Calculator.jsx    # Main yield/cost calculator
│   │   │   ├── Login.jsx         # User authentication
│   │   │   ├── UploadData.jsx    # Excel/CSV data import
│   │   │   ├── DataManagement.jsx # CRUD for user data
│   │   │   ├── DataTransparency.jsx # Data sources page
│   │   │   └── About.jsx         # About page
│   │   ├── context/
│   │   │   └── AuthContext.jsx   # Authentication state
│   │   ├── data/
│   │   │   └── fish_data_v3.js   # 60+ species yield database
│   │   ├── App.jsx               # Main app with routing
│   │   └── main.jsx              # Entry point
│   └── package.json
│
├── server/                       # Express backend
│   ├── server.js                 # API endpoints
│   ├── fish_app.db              # SQLite database
│   └── package.json
│
├── data/                         # Legacy data files
├── datasets/                     # Additional datasets
└── MAB-37PDF-*.pdf              # Source PDF document
```

## 🔧 Technology Stack

### Frontend

| Technology     | Purpose                 |
| -------------- | ----------------------- |
| React 19       | UI framework            |
| Vite 7         | Build tool & dev server |
| React Router 7 | Client-side routing     |
| Tailwind CSS 3 | Styling                 |
| Lucide React   | Icons                   |

### Backend

| Technology | Purpose          |
| ---------- | ---------------- |
| Express 5  | API server       |
| SQLite 3   | Database         |
| JWT        | Authentication   |
| bcrypt     | Password hashing |
| Multer     | File uploads     |
| xlsx       | Excel parsing    |

## 📊 Database Schema

### SQLite Tables

```sql
-- User accounts
users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,          -- bcrypt hashed
    role TEXT DEFAULT 'user'
)

-- Saved calculations
calculations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    name TEXT,
    species TEXT,
    product TEXT,
    cost REAL,
    yield REAL,
    result REAL,
    date TEXT
)

-- User-submitted yield data
user_data (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    species TEXT,
    product TEXT,
    yield REAL,
    source TEXT
)
```

## 🌐 API Endpoints

### Authentication

| Method | Endpoint        | Description        |
| ------ | --------------- | ------------------ |
| POST   | `/api/register` | Create new account |
| POST   | `/api/login`    | Login, returns JWT |

### Calculations (Auth Required)

| Method | Endpoint           | Description                   |
| ------ | ------------------ | ----------------------------- |
| POST   | `/api/save-calc`   | Save a calculation            |
| GET    | `/api/saved-calcs` | Get user's saved calculations |

### User Data (Auth Required)

| Method | Endpoint             | Description                  |
| ------ | -------------------- | ---------------------------- |
| GET    | `/api/user-data`     | Get user's custom yield data |
| POST   | `/api/user-data`     | Add new yield entry          |
| PUT    | `/api/user-data/:id` | Update yield entry           |
| DELETE | `/api/user-data/:id` | Delete yield entry           |
| POST   | `/api/upload-data`   | Upload Excel/CSV file        |

## 📖 Data Sources

The primary yield data comes from:

> **"Recoveries and Yields from Pacific Fish and Shellfish"**  
> Marine Advisory Bulletin No. 37  
> Authors: Chuck Crapo, Brian Paust, Jerry Babbitt  
> Publisher: Alaska Sea Grant College Program, 2004  
> ISBN: 1-56612-012-8

### Species Coverage

| Category  | Species Count | Examples                            |
| --------- | ------------- | ----------------------------------- |
| Salmon    | 5             | Pink, Chum, Sockeye, Coho, Chinook  |
| Rockfish  | 17            | Black, Canary, Yelloweye, Quillback |
| Flatfish  | 13            | Halibut, Dover, Petrale, Rex Sole   |
| Sharks    | 7             | Salmon, Blue, Thresher, Dogfish     |
| Crab      | 4             | Dungeness, King, Tanner             |
| Shellfish | 12+           | Clams, Oysters, Scallops, Mussels   |
| Other     | 15+           | Sablefish, Lingcod, Tuna, Squid     |

### Acronyms

| Acronym | Meaning                                 |
| ------- | --------------------------------------- |
| D/H-On  | Dressed/Head-On (gutted, head attached) |
| D/H-Off | Dressed/Head-Off (gutted, head removed) |
| S/B     | Skinless/Boneless                       |
| Round   | Whole fish as caught                    |
| Fletch  | Large fillet from halibut/flatfish      |

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Report bugs** - Open an issue describing the problem
2. **Suggest features** - Open an issue with your idea
3. **Add yield data** - Contribute verified yield data for species not yet covered
4. **Improve documentation** - Help make the docs clearer

### Development Workflow

```bash
# Fork the repo
# Create a feature branch
git checkout -b feature/my-feature

# Make your changes
# Test locally

# Commit with descriptive message
git commit -m "Add: [description of change]"

# Push and create PR
git push origin feature/my-feature
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Local Catch Network** - For reinvigorating this project through community discussions
- **Alaska Sea Grant College Program** - For the comprehensive yield data in MAB-37
- The fishing community members who have contributed feedback and data

## ☕ Support

If you find this tool useful, consider supporting continued development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-orange)](https://buymeacoffee.com/pcswny)

---

_Built with ❤️ for the fishing community_
