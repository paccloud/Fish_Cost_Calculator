# Product Requirements Document

## Value Add Cost Calculator

**Version:** 2.0  
**Last Updated:** January 17, 2026  
**Product Owner:** Ryan Horwath  
**Status:** In Active Development

---

## 1. Executive Summary

The **Value Add Cost Calculator** is a specialized web application designed for the sustainable seafood industry to calculate true costs of fish products accounting for processing yields, labor time, bulk pricing, and various operational fees. The tool democratizes pricing transparency for small-scale fishers, processors, and community-supported fishery (CSF) operations.

### Vision

Empower fishers and seafood processors with professional-grade cost calculation tools that were previously only available to large commercial operations.

### Mission

Provide free, open-source, community-driven tools that promote fair pricing, transparency, and sustainability in the seafood supply chain.

---

## 2. Product Overview

### 2.1 Target Users

- **Primary:** Small-scale commercial fishers selling direct-to-consumer
- **Secondary:** Seafood processors calculating multi-step processing costs
- **Tertiary:** CSF coordinators, seafood buyers, restaurant procurement managers

### 2.2 Core Value Propositions

1. **Accuracy:** Scientific yield data from trusted sources (NOAA, Alaska Sea Grant)
2. **Flexibility:** Support for custom species and processing methods
3. **Transparency:** Open-source, community-driven data validation
4. **Accessibility:** Free forever, no paywalls or feature limitations
5. **Time-Aware:** Calculate labor costs per processing step
6. **Scale-Aware:** Automatic bulk pricing discounts

---

## 3. Current Features (v2.0)

### 3.1 Core Calculator

**Status:** ✅ Implemented

#### Functionality

- **Dual Modes:**
  - Cost Mode: Calculate cost per pound of final product
  - Weight Mode: Calculate required input weight for target output
- **Species Database:**
  - 50+ pre-loaded fish species with scientific names
  - Multiple conversion paths (Round → H&G → Fillet, etc.)
  - Yield ranges with min/max/average values
  - Community-contributed custom species support

- **Cost Inputs:**
  - Base cost per pound (incoming weight)
  - Processing cost (applied to incoming or outgoing weight)
  - Cold storage cost per pound
  - Shipping cost per pound

#### User Experience

- Real-time calculation updates
- Visual yield range selectors (Min/Avg/Max)
- Species profiles with edible portions info
- Acronym tooltips (H&G, GG, PBO, etc.)
- Dark mode support

### 3.2 Time Tracking

**Status:** ✅ Implemented (Optional Feature)

#### Functionality

- Add multiple processing steps (e.g., "Filleting", "Skinning", "Portioning")
- Track time per step in minutes/pound
- Input labor cost per hour
- Automatic calculation of labor cost per pound
- Visual badge showing "Labor Costs Included" in results

#### Use Case

A fisher processes 100 lbs of salmon from round to fillet. They track:

- Heading & Gutting: 1.5 min/lb @ $25/hr
- Filleting: 3 min/lb @ $30/hr
- Skinning: 1 min/lb @ $25/hr
  → System calculates total labor cost per pound

### 3.3 Economy of Scale Pricing

**Status:** ✅ Implemented (Optional Feature)

#### Functionality

- Define quantity price breaks (e.g., 100+ lbs = 5% off)
- Visual tier cards showing active discount level
- Real-time discount application to final price
- Customizable tier thresholds and discount percentages
- Celebration banner when discount unlocked

#### Default Tiers

- 100+ lbs: 5% discount
- 500+ lbs: 10% discount
- 1,000+ lbs: 15% discount

#### Use Case

A restaurant buyer orders 600 lbs of halibut fillets. The system automatically applies a 10% bulk discount to the per-pound price.

### 3.4 User Authentication

**Status:** ✅ Implemented

#### Functionality

- **Dual Auth:** Username/password OR OAuth (Google/GitHub via Stack Auth)
- **Guest Access:** Full calculator functionality without login
- **Logged-In Benefits:**
  - Save calculations to history
  - Upload custom yield data
  - Export calculation history to CSV

### 3.5 Data Management

**Status:** ✅ Implemented

#### Functionality

- **Public Calculations:** View recent community calculations (anonymous)
- **Personal History:** Save and review your own calculations
- **Custom Data Upload:** Contribute species yield data (logged-in users only)
- **Data Transparency:** View all data sources and contributors

### 3.6 Features Roadmap Page

**Status:** ✅ Implemented

#### Functionality

- **Community Features:** Display upcoming features with vote counts
- **Voting System:** Users can vote once per feature (localStorage-based)
- **Feature Requests:** Submit new feature suggestions via form
- **Status Tracking:** Upcoming/In Progress/Completed badges
- **Categories:** Export, Business, Productivity, Pricing, Community Request

---

## 4. Roadmap Features (Planned)

### 4.1 Export to Email

**Priority:** High  
**Status:** Upcoming  
**Votes:** Community priority TBD

#### Requirements

- Send calculation results to user's email
- Share professional quotes with buyers via email
- Include PDF attachment with cost breakdown
- Email template with Value Add Cost Calculator branding

#### Technical Approach

- Backend: Node.js email service (Nodemailer or Resend)
- Frontend: Email input form with validation
- Generate PDF using jsPDF or Puppeteer
- Store sent emails in user history

#### Success Metrics

- 30% of logged-in users send at least one email per month
- 90%+ email delivery rate

### 4.2 Instant Quotes for Buyers

**Priority:** High  
**Status:** Upcoming  
**Votes:** Community priority TBD

#### Requirements

- Generate professional, branded quote PDFs
- Include:
  - Business logo/contact info
  - Line items with quantities and prices
  - Yield calculations and assumptions
  - Payment terms and delivery info
  - QR code linking to business website
- Save quote templates for reuse
- Track quote status (Sent/Viewed/Accepted/Declined)

#### Technical Approach

- Quote builder UI with drag-and-drop line items
- Template system (React component library)
- PDF generation with professional styling
- Optional: Quote tracking with unique URLs

#### Success Metrics

- 50% of users create at least one quote in first session
- Average quote contains 3-5 line items

### 4.3 Saved Frequently Used Products/Forms

**Priority:** Medium  
**Status:** Upcoming  
**Votes:** Community priority TBD

#### Requirements

- Save calculation configurations as templates
- Quick-load saved forms with one click
- Share templates with team members
- Pre-populate common products (e.g., "Summer Salmon Package")
- Tag templates by season, species, or customer type

#### Technical Approach

- Database: User templates table with JSON config
- UI: "Save as Template" button post-calculation
- Template library with search/filter
- Import/export templates as JSON

#### Success Metrics

- 40% of users save at least 3 templates
- 60% of calculations use saved templates (power users)

### 4.4 Economy of Scale Pricing (Enhanced)

**Priority:** Medium  
**Status:** ✅ Basic implementation complete, enhancements planned

#### Current Implementation

- Manual tier definition (3 default tiers)
- Linear discount percentages

#### Planned Enhancements

- **Dynamic Tiers:** Suggest optimal price breaks based on historical orders
- **Tiered Yield Adjustments:** Higher volumes may allow batch processing → higher yields
- **Cost Curve Visualization:** Graph showing cost per pound vs. quantity
- **Competitor Benchmarking:** Compare your pricing to market averages (opt-in)

#### Technical Approach

- Machine learning: Analyze historical data for optimal tiers
- Charting library: Recharts or Chart.js
- Market data API: Integrate with NOAA or SeafoodSource pricing feeds

#### Success Metrics

- 25% increase in average order size (lbs) for users who enable tiered pricing
- 15% of users customize tier thresholds

### 4.5 Multi-Currency Support

**Priority:** Low  
**Status:** Not Started

#### Requirements

- Support USD, CAD, EUR, GBP, AUD
- Real-time exchange rates (daily update)
- User preference for default currency
- Display calculations in multiple currencies simultaneously

#### Technical Approach

- Currency API: ExchangeRate-API or Open Exchange Rates
- Frontend: Currency selector dropdown
- Display: Primary currency + secondary in parentheses

### 4.6 Mobile App (PWA)

**Priority:** Medium  
**Status:** Not Started

#### Requirements

- Installable Progressive Web App
- Offline calculation mode (cached species data)
- Photo capture for fish measurement → auto-fill weight
- GPS tagging for catch location (optional)

#### Technical Approach

- Service Worker for offline caching
- Web Share API for quick sharing
- Camera API for photo capture
- IndexedDB for offline storage

---

## 5. Technical Architecture

### 5.1 Technology Stack

#### Frontend

- **Framework:** React 18 (Vite build system)
- **Routing:** React Router v6
- **Styling:** Tailwind CSS (utility-first)
- **Icons:** Lucide React
- **State Management:** React Context API + useState/useEffect
- **Storage:** LocalStorage (templates, votes), API calls for user data

#### Backend

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** PostgreSQL 14+ (Neon serverless)
- **Auth:** Stack Auth (OAuth) + JWT (password)
- **API:** RESTful JSON endpoints

#### Infrastructure

- **Hosting:** Vercel (frontend + serverless functions)
- **Database:** Neon (serverless Postgres)
- **CDN:** Vercel Edge Network
- **Analytics:** Vercel Analytics

#### Third-Party Services

- **Auth:** Stack Auth (Google/GitHub OAuth)
- **Email:** TBD (Resend or SendGrid)
- **File Storage:** TBD (S3 or Vercel Blob)

### 5.2 Data Models

#### Species

```json
{
  "name": "Pacific Halibut",
  "scientific_name": "Hippoglossus stenolepis",
  "conversions": {
    "Round to H&G": {
      "yield": 75,
      "range": [70, 80],
      "from": "Round",
      "to": "H&G"
    },
    "H&G to Fillet": {
      "yield": 55,
      "range": [50, 60],
      "from": "H&G",
      "to": "Fillet"
    }
  }
}
```

#### Calculation (Saved)

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "Summer Halibut - Restaurant Order",
  "species": "Pacific Halibut",
  "from_state": "Round",
  "to_state": "Fillet",
  "mode": "cost",
  "cost_per_lb": 8.5,
  "yield_percent": 41.25,
  "processing_cost": 2.0,
  "cold_storage": 0.5,
  "shipping": 1.0,
  "time_steps": [
    { "name": "H&G", "minutes": 1.5, "labor_rate": 25 },
    { "name": "Fillet", "minutes": 3, "labor_rate": 30 }
  ],
  "quantity": 600,
  "discount_applied": 10,
  "result": 22.75,
  "created_at": "2026-01-17T18:00:00Z"
}
```

### 5.3 API Endpoints

#### Public (No Auth)

- `GET /api/fish-data` - List all species and conversions
- `GET /api/public-calcs` - Recent community calculations (anonymous)

#### Authenticated

- `POST /api/login` - Username/password login → JWT
- `POST /api/register` - Create account
- `GET /api/user-data` - User's custom species data
- `POST /api/save-calc` - Save calculation to history
- `GET /api/saved-calcs` - User's calculation history
- `GET /api/export?type=calcs` - Export history as CSV
- `POST /api/upload-data` - Contribute custom yield data

---

## 6. Implementation Plan (Executable Chunks)

### Phase 1: Post-Launch Stabilization (Week 1-2)

**Goal:** Fix bugs, improve UX, gather feedback

#### Chunk 1.1: User Testing Session

- [ ] Recruit 5 beta testers (fishers, processors, CSF coordinators)
- [ ] Conduct 30-min usability sessions
- [ ] Document bugs and UX friction points
- [ ] **Deliverable:** User feedback report

#### Chunk 1.2: Bug Fixes & Polish

- [ ] Fix any calculation accuracy issues
- [ ] Improve mobile responsiveness (Time Tracking section)
- [ ] Add loading states for async operations
- [ ] Improve error messages
- [ ] **Deliverable:** Bug fix release v2.0.1

#### Chunk 1.3: Analytics Setup

- [ ] Set up event tracking (Vercel Analytics or PostHog)
- [ ] Track: Calculator usage, feature adoption (Time/Scale), template saves
- [ ] Set up weekly metrics email
- [ ] **Deliverable:** Analytics dashboard

### Phase 2: Export to Email (Week 3-5)

**Goal:** Implement #1 roadmap feature

#### Chunk 2.1: Email Service Setup

- [ ] Choose provider (Resend vs SendGrid)
- [ ] Set up API credentials
- [ ] Create email templates (HTML + plain text)
- [ ] Test deliverability
- [ ] **Deliverable:** Working email service

#### Chunk 2.2: PDF Generation

- [ ] Choose library (jsPDF vs react-pdf)
- [ ] Design PDF template (branding, layout)
- [ ] Implement calculation → PDF conversion
- [ ] Add logo and contact info fields
- [ ] **Deliverable:** PDF export functionality

#### Chunk 2.3: Frontend Integration

- [ ] Add "Email Results" button to calculator
- [ ] Create email modal (recipient, message, PDF preview)
- [ ] Integrate with backend API
- [ ] Add success/error notifications
- [ ] **Deliverable:** End-to-end email flow

#### Chunk 2.4: Buyer Sharing

- [ ] Add "Share with Buyer" flow (optional custom message)
- [ ] Track sent emails in user history
- [ ] Add email preview before send
- [ ] **Deliverable:** Buyer sharing feature

### Phase 3: Instant Quotes for Buyers (Week 6-9)

**Goal:** Professional quote generation

#### Chunk 3.1: Quote Data Model

- [ ] Design database schema (quotes table)
- [ ] Create API endpoints (CRUD for quotes)
- [ ] Implement quote versioning
- [ ] **Deliverable:** Backend quote system

#### Chunk 3.2: Quote Builder UI

- [ ] Create quote editor page
- [ ] Implement line item management (add/remove/reorder)
- [ ] Add business info fields (logo, address, terms)
- [ ] Auto-populate from saved calculations
- [ ] **Deliverable:** Quote builder prototype

#### Chunk 3.3: Quote Templates

- [ ] Design template system architecture
- [ ] Create 3 default templates (Simple, Detailed, Professional)
- [ ] Allow custom template creation
- [ ] **Deliverable:** Template library

#### Chunk 3.4: Quote PDF Export

- [ ] Design professional PDF layout
- [ ] Add QR code generation (link to business site)
- [ ] Implement branding customization
- [ ] Test print quality
- [ ] **Deliverable:** Quote PDF export

#### Chunk 3.5: Quote Tracking (Optional)

- [ ] Generate unique quote URLs
- [ ] Track view status (opened/not opened)
- [ ] Add quote expiration dates
- [ ] Send reminders for pending quotes
- [ ] **Deliverable:** Quote tracking dashboard

### Phase 4: Saved Products/Forms (Week 10-12)

**Goal:** Template system for frequent calculations

#### Chunk 4.1: Template Backend

- [ ] Create templates database table
- [ ] Implement CRUD API endpoints
- [ ] Add tagging system
- [ ] **Deliverable:** Template API

#### Chunk 4.2: Save Template UI

- [ ] Add "Save as Template" button
- [ ] Create template naming modal
- [ ] Add tag selection UI
- [ ] **Deliverable:** Save functionality

#### Chunk 4.3: Template Library

- [ ] Design template browser page
- [ ] Implement search and filtering
- [ ] Add "Quick Load" from calculator
- [ ] Show usage statistics per template
- [ ] **Deliverable:** Template library page

#### Chunk 4.4: Template Sharing (Optional)

- [ ] Add "Share with Team" feature
- [ ] Implement template import/export (JSON)
- [ ] Create community template marketplace
- [ ] **Deliverable:** Template sharing

### Phase 5: Economy of Scale Enhancements (Week 13-15)

**Goal:** Advanced bulk pricing features

#### Chunk 5.1: Dynamic Tier Suggestions

- [ ] Analyze historical calculation data
- [ ] Implement tier recommendation algorithm
- [ ] Add "Suggested Tiers" button
- [ ] **Deliverable:** Smart tier suggestions

#### Chunk 5.2: Cost Curve Visualization

- [ ] Integrate charting library (Recharts)
- [ ] Plot cost per pound vs. quantity
- [ ] Add break-even point markers
- [ ] Highlight optimal order quantities
- [ ] **Deliverable:** Interactive cost curve

#### Chunk 5.3: Market Benchmarking (Optional)

- [ ] Research market data APIs (NOAA, SeafoodSource)
- [ ] Implement price comparison feature
- [ ] Add opt-in anonymous data sharing
- [ ] Display "Your pricing vs. Market average"
- [ ] **Deliverable:** Market insights

### Phase 6: PWA & Mobile Optimization (Week 16-18)

**Goal:** Mobile-first experience

#### Chunk 6.1: PWA Setup

- [ ] Configure service worker (Vite PWA plugin)
- [ ] Create manifest.json with icons
- [ ] Test install on iOS and Android
- [ ] **Deliverable:** Installable PWA

#### Chunk 6.2: Offline Mode

- [ ] Cache species data in IndexedDB
- [ ] Implement offline calculation mode
- [ ] Add sync queue for saving when back online
- [ ] **Deliverable:** Offline functionality

#### Chunk 6.3: Mobile UX Improvements

- [ ] Redesign Time Tracking for mobile (vertical layout)
- [ ] Add bottom sheet for Economy of Scale
- [ ] Implement swipe gestures for navigation
- [ ] **Deliverable:** Mobile-optimized UI

#### Chunk 6.4: Camera Integration (Optional)

- [ ] Add photo capture for fish measurement
- [ ] Implement weight estimation from photos (ML model)
- [ ] Add GPS tagging for catch location
- [ ] **Deliverable:** Camera features

### Phase 7: Performance & Scalability (Week 19-20)

**Goal:** Optimize for 10,000+ users

#### Chunk 7.1: Backend Optimization

- [ ] Add Redis caching for fish data
- [ ] Implement database connection pooling
- [ ] Optimize slow queries
- [ ] **Deliverable:** 2x faster API responses

#### Chunk 7.2: Frontend Optimization

- [ ] Code splitting by route
- [ ] Lazy load heavy components
- [ ] Optimize bundle size (tree-shaking)
- [ ] Implement virtual scrolling for long lists
- [ ] **Deliverable:** 40%+ smaller bundle

#### Chunk 7.3: Monitoring & Alerting

- [ ] Set up error tracking (Sentry)
- [ ] Add performance monitoring
- [ ] Configure uptime alerts
- [ ] **Deliverable:** Production monitoring

---

## 7. Success Metrics

### 7.1 User Acquisition

- **Target:** 1,000 active users by Month 6
- **Metric:** Weekly active users (WAU)
- **Tracking:** Vercel Analytics

### 7.2 Feature Adoption

- **Time Tracking:** 30% of calculations use time tracking
- **Economy of Scale:** 25% of calculations use bulk pricing
- **Templates:** 40% of users save at least one template
- **Exports:** 20% of users export results (email/PDF/CSV)

### 7.3 Data Quality

- **Custom Species:** 50+ community-contributed species by Month 6
- **Data Accuracy:** <5% error rate on yield calculations
- **Coverage:** 90% of North American commercial species

### 7.4 Engagement

- **Return Rate:** 50% of users return within 7 days
- **Calculations per User:** Average 5 calculations per session
- **Quote Generation:** 30% of users create at least one quote

### 7.5 Community

- **Roadmap Votes:** 500+ total votes across all features
- **Feature Requests:** 50+ community suggestions submitted
- **Contributors:** 20+ users upload custom yield data

---

## 8. Risk Assessment

### 8.1 Data Accuracy Risks

**Risk:** Incorrect yield data leads to pricing errors  
**Mitigation:**

- Cite sources for all data (NOAA, Alaska Sea Grant, FishBase)
- Community validation (upvote/downvote system)
- Mark custom data with "Community Contributed" badge
- Add disclaimer: "Estimates only, verify with your own data"

### 8.2 User Adoption Risks

**Risk:** Target users may not be tech-savvy  
**Mitigation:**

- Minimal UI, clear labels, helpful tooltips
- Video tutorials (YouTube channel)
- In-app onboarding tour (first-time users)
- Phone support for early adopters

### 8.3 Competitive Risks

**Risk:** Larger companies may copy features  
**Mitigation:**

- Open-source advantage (community trust)
- Niche focus (sustainable seafood, not generic food)
- Network effects (community data, templates)
- Brand loyalty (fishers helping fishers)

### 8.4 Technical Risks

**Risk:** Database costs scale faster than revenue  
**Mitigation:**

- Use serverless Postgres (Neon) with free tier
- Implement aggressive caching
- Limit file storage sizes
- Consider sponsorship/grants (Sea Grant, NOAA)

---

## 9. Go-to-Market Strategy

### 9.1 Launch Partners

- **Alaska Sea Grant:** Feature in newsletter, link from publications
- **Local Catch Network:** Present at annual conference
- **CSF networks:** Fishadelphia, Cape Ann Fresh Catch, Port Clyde

### 9.2 Content Marketing

- **Blog Posts:**
  - "The True Cost of Processing Fish: A Guide for Small-Scale Fishers"
  - "How to Price Your CSF Shares Using Yield Calculations"
  - "Bulk Pricing Strategies for Direct-to-Consumer Seafood Sales"
- **Video Tutorials:**
  - "Calculator Basics: 5-Minute Walkthrough"
  - "Advanced Features: Time Tracking and Bulk Discounts"
  - "Contributing Your Own Yield Data"

### 9.3 Community Building

- **Discord Server:** Real-time support, feature discussions
- **Monthly AMAs:** Q&A with sustainable seafood experts
- **User Spotlights:** Showcase fishers using the tool

### 9.4 Partnerships

- **SeafoodSource:** Guest article on pricing transparency
- **NOAA Fisheries:** Cross-promotion with FishWatch
- **University Extension Programs:** Integration into curriculum

---

## 10. Appendix

### 10.1 Glossary

- **CSF:** Community Supported Fishery
- **H&G:** Headed and Gutted
- **GG:** Gilled and Gutted
- **PBO:** Pin Bones Out
- **Round:** Whole fish, as caught
- **Yield:** Percentage of usable product after processing
- **Economy of Scale:** Cost reduction achieved by increased production volume

### 10.2 References

- Alaska Sea Grant. (2003). _Recoveries and Yields from Pacific Fish and Shellfish_. MAB-37.
- NOAA Fisheries. (2025). _FishWatch: U.S. Seafood Facts_.
- Local Catch Network. (2024). _Community Food Security and CSF Operations_.

### 10.3 Change Log

- **v2.0 (Jan 2026):** Rebrand to "Value Add Cost Calculator", add Time Tracking, Economy of Scale, Features Roadmap
- **v1.5 (Dec 2025):** Custom species, OAuth integration, dark mode
- **v1.0 (Oct 2025):** Initial release with basic calculator

---

**Document Owner:** Ryan Horwath (ryan@pacificcloudseafoods.com)  
**Next Review:** February 2026
