# Design system notes

Supersedes the navy/rust direction in `docs/superpowers/specs/2026-03-27-branding-redesign-design.md`
(replaced by the teal/terracotta/yellow brand in July 2026).

## Who this is for

Fishers, chefs and fishmongers who use apps every day but are busy: on a dock in glare, in a
cold-room, in a kitchen mid-service, often on a phone, often with wet or gloved hands. So:

- **Few steps, plain words.** Two numbered steps ("Your fish", "Your numbers"), one primary action,
  no jargon in labels (help text explains the industry terms instead).
- **Big targets.** Buttons and form controls are at least 48px tall; other tappable things at least 44px.
- **Readable in any light.** Text is at least 4.5:1 and form-control edges at least 3:1, in both themes.
- **Nothing hover-only.** Help works on tap, keyboard focus and hover.

## Color tokens

Values live in `app/src/index.css` (`:root` = light, `.dark` = dark) and are exposed as Tailwind
colors in `app/tailwind.config.js`.

| Use this | For | Not this |
|---|---|---|
| `text-text-primary` / `-secondary` / `-muted` | Body and helper text | `text-gray-*` |
| `text-accent` | Teal used as text or icons (headings, key numbers) | `text-brand-teal` (about 2:1 in dark mode) |
| `text-link` | Terracotta used as text (links, small accents) | `text-brand-terracotta` (under 4.5:1 on light) |
| `bg-primary` / `hover:bg-primary-hover` | Primary buttons (`.btn-primary`) | `bg-brand-teal` in dark mode |
| `border-line-strong` | Edges of inputs, selects, toggles | `border-line` (1.5:1, decoration only) |
| `text-success` / `text-danger` | Status text | `text-red-400`, `text-green-300` (fail on light) |
| `bg-brand-cta` | Terracotta fill with white text | `bg-brand-terracotta` + white text (4.0:1) |
| `bg-brand-*` (teal, yellow, terracotta) | Fixed brand fills and decoration | body-size text |

Shared classes: `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.card`, `.form-label`,
`.form-input`, `.form-select`, `.section-divider`. Inputs are 16px text so iOS does not zoom on focus.

## Guardrails

- `app/src/lib/__tests__/designTokens.test.js` fails if a token pair drops below its contrast target.
  Change a color, run `npm test`.
- Keyboard focus uses one 3px outline (`:focus-visible`), yellow on dark surfaces and in the navbar.
- `prefers-reduced-motion` is honored globally.

## Known follow-ups

- **Reference sites not analyzed.** The redesign request named Grace Communications, namanet.org,
  the National Family Farm Coalition and localcatch.org, but this environment's network policy blocked
  them, so nothing here is derived from those sites. Palette and typeface are unchanged from July 2026.
  Tokens are centralized, so a palette or font pass is a change to `index.css`, `tailwind.config.js`
  and the font link in `index.html`.
- **Dark-only status styling** (pale `text-red-300` / `text-green-300` on translucent dark boxes, or
  `text-amber-*`) is unreadable in light mode. Move these to `text-danger` / `text-success` and
  theme-aware backgrounds: `UploadData`, `SubmitRequest`, `ConflictResolutionModal`, `RecoveryModal`,
  `DataManagement`, `ContributorProfile`, `CommunityData`, `FeaturesRoadmap`.
- **Unused components** `Footer.jsx` and `InstallPrompt.jsx` are not rendered anywhere and use tokens
  that no longer exist (`bg-navy`, `text-teal`, `bg-rust`). Restyle before wiring them in, or delete.
- **Offline behavior.** `Calculator` seeds its data from `FISH_DATA_V3`, whose conversions have no
  `from`/`to` fields (they are derived server-side by `/api/fish-data`). If that request fails, the
  "What you have" list is empty and the calculator cannot be used, which matters on a boat with poor signal.
