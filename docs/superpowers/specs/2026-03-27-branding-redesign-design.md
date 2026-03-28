# Fish Cost Calculator — Branding Redesign Spec

## Goal
Align Fish Cost Calculator's visual identity with the maritime/seafood industry ecosystem (localcatch.org, namanet.org, dontcageouroceans.org) while maintaining its own distinct identity as a professional industry tool.

## Decisions
- Fish Cost Calculator is an **independent tool** serving the same community — aligned but distinct
- **Both light and dark mode** retained, redesigned with the maritime palette
- **Warm rust/orange accent** for maximum community cohesion
- **Outfit + Open Sans** typography with JetBrains Mono for data
- **No gradients** — solid colors only, clean and professional

---

## 1. Color System

### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--navy` | `#0A2540` | Navbar bg, headings, footer |
| `--teal` | `#0E7C6B` | Links, active states, secondary buttons |
| `--rust` | `#D4622B` | Primary CTAs, important badges, hover accents |
| `--surface` | `#F8F9FA` | Page background |
| `--surface-elevated` | `#FFFFFF` | Cards, panels |
| `--text-primary` | `#1A2B3D` | Body text |
| `--text-secondary` | `#5A6B7D` | Muted text, captions |
| `--border` | `#D8DEE4` | Card borders, dividers |

### Dark Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--navy` | `#0F1A2E` | Page background |
| `--teal` | `#12A08C` | Links, active states (brighter for contrast) |
| `--rust` | `#E8713E` | CTAs (slightly brighter for dark bg) |
| `--surface` | `#0F1A2E` | Page background |
| `--surface-elevated` | `#162033` | Cards, panels |
| `--text-primary` | `#E8ECF1` | Body text |
| `--text-secondary` | `#8A9BB0` | Muted text |
| `--border` | `#253349` | Card borders, dividers |

### Semantic Colors

| Token | Light | Dark |
|-------|-------|------|
| `--success` | `#16A34A` | `#22C55E` |
| `--warning` | `--rust` | `--rust` |
| `--error` | `#DC2626` | `#EF4444` |

**Principle:** One accent color (rust) for all primary actions. Teal for navigation/links. Navy as the structural anchor. No gradients.

---

## 2. Typography

### Font Stack
- **Headings:** Outfit (600, 700) via Google Fonts
- **Body:** Open Sans (400, 500, 600) via Google Fonts
- **Monospace:** JetBrains Mono for calculator numbers, costs, yields

### Scale

| Element | Size | Weight | Tracking | Font |
|---------|------|--------|----------|------|
| Page title (H1) | `text-3xl md:text-4xl` | 700 | `tracking-tight` | Outfit |
| Section heading (H2) | `text-2xl md:text-3xl` | 600 | `tracking-tight` | Outfit |
| Card heading (H3) | `text-lg md:text-xl` | 600 | normal | Outfit |
| Body | `text-base` | 400 | normal | Open Sans |
| Caption/helper | `text-sm` | 400 | normal | Open Sans |
| Data values | `text-base`/`text-lg` | 500 | `tracking-tight` | JetBrains Mono |
| Navbar links | `text-sm` | 500 | `tracking-wide` uppercase | Open Sans |

- Body text capped at `max-w-[65ch]` for readability
- No oversized H1s — hierarchy through weight and color, not scale

---

## 3. Component Patterns

### Navbar
- Light: Navy `#0A2540` background, white text, rust accent on active link
- Dark: `#0F1A2E` background with `border-b` in `--border`
- Fish icon: teal fill, no gradient badge
- Links: uppercase, `text-sm tracking-wide`, underline-on-hover with teal
- Solid background, no glassmorphism/blur

### Buttons
- **Primary:** Rust fill, white text, `rounded-lg`, `active:scale-[0.98]`
- **Secondary:** Transparent with teal border, teal text, `rounded-lg`
- **Ghost:** No border, teal text, subtle bg on hover
- No gradient fills, no glows, no shadows

### Cards
- Light: White bg, 1px `--border`, `rounded-xl`, no shadow (or `shadow-sm` only for hierarchy)
- Dark: `--surface-elevated` bg, 1px `--border`, same radius
- No glassmorphism, no backdrop-blur, no gradient overlays
- Use `divide-y` or `border-t` within cards for data grouping

### Form Inputs
- Label above input, `text-sm font-medium` in `--text-secondary`
- Input: `rounded-lg`, 1px border, `--surface-elevated` bg
- Focus: teal border ring (`ring-2 ring-teal`)
- Monospace font for numeric inputs

### Feature Sections (Home/About)
- 2-column asymmetric grid (`grid-cols-1 md:grid-cols-[2fr_1fr]` alternating) replacing 3-equal-cards
- Icon in teal, heading in navy, description in `--text-secondary`
- Separated by `border-t` dividers, not boxed in cards

### Footer
- Navy background (matches navbar), teal links, rust CTAs
- Clean `divide-y` sections

---

## 4. Dark Mode Strategy

- Not an inversion — navy palette naturally extends to dark mode
- Light mode: navy for navbar/footer/headings against light surfaces
- Dark mode: navy becomes the surface, brighter teal/rust for contrast
- All combos meet WCAG AA (4.5:1 body, 3:1 large text)
- Navbar is always dark navy — nearly identical in both modes
- Dark remains the default, localStorage toggle persists

---

## 5. Files to Modify

### Core Style Files
- `app/src/index.css` — Replace CSS custom properties with new palette, add font imports
- `app/tailwind.config.js` — Update custom color tokens, add font family extensions

### Components (all in `app/src/components/` or `app/src/`)
- `App.jsx` — Navbar restyling (navy bg, new link colors, fish icon)
- `Home.jsx` — Hero section, feature grid (remove gradients, new layout)
- `Footer.jsx` — Navy bg, teal links
- `Calculator.jsx` — Form inputs, data display (monospace numbers)
- `About.jsx` — Section styling, feature callouts
- `FeaturesRoadmap.jsx` — Feature cards (remove gradient cards)
- `Login.jsx` — Form styling
- `UploadData.jsx` — Form styling
- `DataManagement.jsx` — Data table/list styling
- `ContributorProfile.jsx` — Profile card styling
- `SubmitRequest.jsx` — Form styling

### Context
- `app/src/context/ThemeContext.jsx` — No logic changes needed, just CSS variable values change

---

## 6. What We Are NOT Changing
- App functionality, routing, or data flow
- Component structure or React architecture
- Auth system or API layer
- Dark/light mode toggle mechanism
- Icon library (Lucide React stays)
