# Design system notes

Supersedes the navy/rust direction in `docs/superpowers/specs/2026-03-27-branding-redesign-design.md`
(replaced by the teal/terracotta/yellow brand in July 2026).

## Who this is for

Fishers, chefs and fishmongers who use apps every day but are busy: on a dock in glare, in a
cold-room, in a kitchen mid-service, often on a phone, often with wet or gloved hands. So:

- **Few steps, plain words.** Two numbered steps ("Your fish", "Your numbers"), no Calculate button
  (the answer is always on screen), no jargon in labels (help text explains the industry terms instead).
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

## Calculator layout ("Dockside")

Chosen from the three mock-ups in `docs/design-mockups/` (direction A).

- **Tap tiles, not dropdowns,** for "What you have" and "What you're making" (radio buttons styled as
  tiles, so arrow keys and screen readers work as for any radio group). Species stays a native select:
  there are 89 of them. Products show their yield on the tile; long lists show 6 plus "Show all".
- **Steppers** (big − / + either side of a typed field) for price, pounds, yield, processing and shipping.
- **Live result bar** pinned to the bottom (`bg-brand-teal`, number in `brand-yellow`, 6.7:1). It is worked
  out from what is on screen via `app/src/lib/calcEngine.js`, so a saved result always matches its inputs.
  When processing or shipping is set it also shows the parts (Fish + Processing + Shipping). Screen readers
  get the answer once typing pauses, from a separate live region, not on every keystroke.
- **Processing and shipping** are each charged per lb of **incoming** weight (the starting fish; spread over
  fewer finished pounds, so divided by yield) or **outgoing** weight (the finished product; added as is).
  Both choices are always visible, with a line spelling out what the charge comes to per finished lb.
- **Number boxes read what people type** (`app/src/lib/numberInput.js`): "$4.50", "1,000", "42%" and "4,50"
  all work. Text that isn't a number marks that box as invalid and the bar says to use numbers; it never
  counts as 0, because a wrong answer is worse than none.
- **Works with no signal.** The calculator starts from the bundled reference yields
  (`FISH_DATA_V3`, given `from`/`to` by `app/src/lib/fishDataShape.js`) and the service worker serves
  the app, so it works on a boat with no connection. `/api/fish-data` replaces that data only when it
  sends usable yields, and what is already picked stays picked. A signed-in person's custom yields come
  from the copy `DataContext` keeps on the device (merged by `app/src/lib/fishDataMerge.js`), which the
  sync refreshes when there is signal (and each time the calculator opens), so they work offline too.
  If a sync changes the yield you picked, the yield box follows it, unless you typed your own.
- **Nothing hides behind the bar.** The calculator sets the page's `scroll-padding-bottom` to the bar's
  height, so whatever you Tab to scrolls into view above it (WCAG 2.4.11).

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
- **Unused components** `Footer.jsx` and `InstallPrompt.jsx` are not rendered anywhere and use tokens
  that no longer exist (`bg-navy`, `text-teal`, `bg-rust`). Restyle before wiring them in, or delete.
