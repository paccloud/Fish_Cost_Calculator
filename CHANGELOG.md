# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Vercel Web Analytics integration for tracking application usage
- Comprehensive fish data validation testing suite
- Data validation module for ensuring fish data integrity

### Fixed
- Contributor profile OAuth authentication flow
- Mobile menu navigation issues
- Yield range return format (now returns array instead of string)
- Neon database fish data import including tuna and PDF species

### Data
- Imported Tuna and Albacore profiles to fish_data_v3
- Updated Pacific Halibut conversion yields
- Normalized Walleye Pollock roe yield to integer values
- Completed comprehensive fish yield data from MAB-37 PDF research publication

## [1.0.0] - 2025-12-16

### Added
- React 19 + Vite 7 frontend with modern build tooling
- Tailwind CSS styling with responsive design
- User authentication system with JWT and bcrypt password hashing
- Save and export fish yield calculations
- Custom user yield data management with Excel/CSV upload support
- Contributor profile system for data transparency
- User data management interface with full CRUD operations
- About page with project mission and Local Catch Network information
- Data sources transparency page documenting MAB-37 research
- Comprehensive REST API with 15 endpoints
  - Authentication: `/api/register`, `/api/login`
  - Calculations: `/api/saved-calcs`, `/api/save-calc`, `/api/export-calcs`
  - User Data: `/api/user-data` (GET/POST/PUT/DELETE), `/api/upload-data`, `/api/export-user-data`
  - Contributors: `/api/contributors`, `/api/contributor`, `/api/contributor/me`
- Vercel serverless deployment support
- Neon PostgreSQL database integration
- SQLite to PostgreSQL migration scripts
- Comprehensive documentation:
  - API documentation (`docs/API.md`)
  - Architecture documentation (`docs/ARCHITECTURE.md`)
  - Deployment guide (`DEPLOYMENT.md`)
  - Contributing guidelines (`CONTRIBUTING.md`)
  - Implementation summary (`IMPLEMENTATION_SUMMARY.md`)

### Data
Based on Marine Advisory Bulletin No. 37 (MAB-37) research publication "Recoveries and Yields from Pacific Fish and Shellfish" by Chuck Crapo, Brian Paust, and Jerry Babbitt (Alaska Sea Grant, 2004):

**Salmon Species (5)**
- Pink Salmon
- Chum Salmon
- Coho Salmon
- Sockeye Salmon
- Chinook Salmon

**Rockfish Species (17)**
- Black Rockfish
- Blue Rockfish
- Yelloweye Rockfish
- Canary Rockfish
- Copper Rockfish
- Quillback Rockfish
- Widow Rockfish
- Yellowtail Rockfish
- Bocaccio
- Chilipepper
- Shortbelly Rockfish
- Silvergray Rockfish
- Splitnose Rockfish
- Stripetail Rockfish
- Greenstriped Rockfish
- Rosethorn Rockfish
- Sharpchin Rockfish

**Flatfish Species (13)**
- Pacific Halibut
- Arrowtooth Flounder
- Petrale Sole
- Dover Sole
- English Sole
- Rock Sole
- Flathead Sole
- Starry Flounder
- Greenland Turbot
- Alaska Plaice
- Yellowfin Sole
- Rex Sole
- Butter Sole

**Shark Species (7)**
- Spiny Dogfish
- Blue Shark
- Shortfin Mako
- Thresher Shark
- Common Thresher
- Bigeye Thresher
- Leopard Shark

**Crab Species (4)**
- Dungeness Crab
- Red King Crab
- Blue King Crab
- Golden King Crab

**Shellfish Species (12+)**
- Pacific Geoduck
- Manila Clam
- Pacific Oyster
- Weathervane Scallop
- Pink Shrimp
- Spot Prawn
- Sidestripe Shrimp
- Coonstripe Shrimp
- Pacific Razor Clam
- Littleneck Clam
- Butter Clam
- Horse Clam

**Other Species (15+)**
- Walleye Pollock
- Pacific Cod
- Lingcod
- Sablefish
- Pacific Whiting
- Albacore Tuna
- Yellowfin Tuna
- Bigeye Tuna
- Pacific Herring
- Pacific Sardine
- Northern Anchovy
- Pacific Mackerel
- Jack Mackerel
- Striped Bass
- California Sheephead

### Technical Stack
- **Frontend**: React 19.0.0, Vite 7.2.4, Tailwind CSS 4.x
- **Backend**: Vercel Serverless Functions, Express 5.2.1
- **Database**: Neon PostgreSQL (@neondatabase/serverless)
- **Authentication**: jsonwebtoken 9.x, bcrypt 5.x
- **File Processing**: formidable, xlsx
- **Deployment**: Vercel with edge runtime support

## [0.1.0] - 2023-08-16

### Added
- Initial project setup
- Basic repository structure
- Project scaffolding

[Unreleased]: https://github.com/paccloud/Fish_Cost_Calculator/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/paccloud/Fish_Cost_Calculator/releases/tag/v1.0.0
[0.1.0]: https://github.com/paccloud/Fish_Cost_Calculator/releases/tag/v0.1.0
