# Design system notes

> **Direction:** [`STYLE_GUIDE.md`](STYLE_GUIDE.md) (November 2026) sets where the look, words and navigation are going. This file describes what is built: the tokens, the shared classes and components, and the app shell are on the style guide; the calculator and the secondary screens are still being moved onto them.

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

Values live in `app/src/index.css` (`:root` = light, "Daylight"; `.dark` = dark, "Galley") and are exposed
as Tailwind colors in `app/tailwind.config.js`. The full table, with what each is for, is in the style guide.

| Use this | For | Not this |
|---|---|---|
| `bg-surface` / `bg-surface-raised` | The page ground (bone paper, `#f4f2ec` in daylight) / cards, tiles and the tab bar | a card on a card |
| `text-text-primary` / `-secondary` / `-muted` | Body and helper text | `text-gray-*` |
| `text-accent` | Teal used as text or icons (the current tab, ghost buttons) | `text-brand-teal` (about 2:1 in dark mode) |
| `text-link` | Terracotta used as text (links, the "your yield" stamp) | `text-brand-terracotta` (under 4.5:1 on light) |
| `bg-primary` / `hover:bg-primary-hover` + `text-on-primary` | The one primary button, the selected tile, the pressed segment | `bg-brand-teal` in dark mode; teal bars, headers or banners |
| `bg-bar` + `text-on-bar` / `text-on-bar-muted` | The ticket: the one darkest block on a screen | `bg-brand-teal` for the result |
| `text-brand-yellow` on `bg-bar` | The price figure, and the 4px rule on top of the ticket | yellow text on paper, yellow buttons |
| `border-line-strong` | Edges of inputs, selects, tiles, steppers | `border-line` (1.5:1, decoration only) |
| `text-success` / `text-danger` | Status text, always with an icon and a word | `text-red-400`, `text-green-300` (fail on light) |
| `bg-brand-cta` + `text-on-primary` | The one conversion button a screen may have | `bg-brand-terracotta` + white text (4.0:1) |
| `bg-brand-teal` | The wordmark tile, the app icon, store art | UI fills (use `primary`, which follows the theme) |

Never hard-code a hex in a component. If a token is missing, add it to `index.css`, the Tailwind config
and `designTokens.test.js`.

## Type

Two families, both bundled with the app under the CSS names `'Inter Variable'` and `'Fraunces Variable'`.

- `font-sans` (Inter) is the default: everything a person operates and every number.
- `font-display` (Fraunces) is for the names of things: species, products, screens, sections. Never in a
  button, label, tile or table, and never below 20px. The class also switches Fraunces to lining figures
  with `SOFT` and `WONK` at 0, so use the class rather than setting `font-family` by hand.

| Class | Size / line, weight | Use |
|---|---|---|
| `.type-display` | 40 / 44, 500 | Store listing, About and sign-in headline. Never inside the calculator |
| `.type-title` | 30 / 34, 550 | The screen title. One per screen, on the `<h1>` |
| `.type-species` | 24 / 28, 550 | The chosen species, and species names in lists |
| `.type-heading` | 20 / 26, 600 | A section heading inside a screen |
| `.type-latin` | 14 / 20, italic sans | The scientific name under a species |

Each sets the family, size, weight and `text-text-primary`; a utility on the same element overrides any of it.

## Shape and size

- **Corners are tight.** `rounded` is 4px (stamps, the wordmark tile). `rounded-lg` is **6px** (buttons,
  inputs) and `rounded-xl` is **8px** (cards, tiles, stepper buttons): the Tailwind defaults of 8px and
  12px are overridden in the config. Nothing is rounder than that except `rounded-full` step numbers.
- **Sizes:** `min-h-target` / `min-w-target` (44px, the smallest tappable thing), `min-h-control` (48px:
  buttons, inputs, selects), `min-h-tile` (56px: tiles, stepper buttons, tabs, list rows),
  `max-w-content` (672px, the main column) and `max-w-measure` (65ch, running copy).
- **Depth:** `shadow-card` on cards (barely there; the border does the work) and `shadow-ticket` on the
  ticket. Nothing else is raised except dialogs.

## Shared classes

All in `@layer components` in `app/src/index.css`.

| Class | What it is |
|---|---|
| `.btn-primary`, `.btn-secondary`, `.btn-ghost` | 48px actions (ghost is 44px). One primary per screen |
| `.card` | `surface-raised`, `border-line`, 8px corners, `shadow-card`. Add your own padding (`p-5 sm:p-6`) |
| `.form-label`, `.form-input`, `.form-select` | A labelled control at 16px, so iOS does not zoom on focus |
| `.section-divider` | A rule between rows inside a card |
| `.stamp`, `.stamp-yours`, `.stamp-community` | Where a number came from. See `Stamp` below |
| `.notice`, `.notice-success`, `.notice-error` | What just happened. See `Notice` below |
| `.ticket` | The answer: `bar` ground, `on-bar` text, 4px `brand-yellow` rule on top, `shadow-ticket`. Focus rings inside it are brass |
| `.ticket-dock` | Pins a ticket to the bottom edge and keeps it clear of the tab bar. On the `.ticket` itself or a wrapper |
| `.ticket-label` | First line: "Your cost per lb of **Skinless fillet**". A `<b>` inside is set in the display face |
| `.ticket-row` | The figure on the left, `.ticket-actions` on the right |
| `.ticket-figure` | The price: 52 / 52, weight 800, `brand-yellow`, tabular. A `<small>` inside is the unit ("/lb") |
| `.ticket-actions`, `.ticket-action` | Save and Share: 44px outlined buttons on `bar` |
| `.ticket-lines` | A `<ul>` of line items under a dashed rule. Each `<li>` is label then number; the last child is right-aligned and tabular |
| `.tabbar`, `.tab` | The navigation. Use the `TabBar` component, not the classes |

Tailwind only ships a class that some file in `app/src` uses, so a class in this table that nothing uses
yet is not in the built stylesheet until something does.

The ticket, as markup:

```html
<section class="ticket ticket-dock" aria-label="Your result">
  <p class="ticket-label">Your cost per lb of <b>Skinless fillet</b></p>
  <div class="ticket-row">
    <p class="ticket-figure">$9.78<small>/lb</small></p>
    <div class="ticket-actions">
      <button type="button" class="ticket-action">Save</button>
    </div>
  </div>
  <ul class="ticket-lines">
    <li><span>Across typical yields, 41–49%</span><span>$9.18–$10.98</span></li>
  </ul>
</section>
```

## Components

| Component | Props | Notes |
|---|---|---|
| `Stamp` (`components/Stamp.jsx`) | `tone`: `'reference'` (default), `'yours'`, `'community'`; `children` | A printed label, not a button. Three or four words: `MAB-37 · 41–49%`, `Your yield · 44%`, `Community · 12 cuts`, `Saved on this phone`. The words must say what the colour says |
| `Notice` (`components/Notice.jsx`) | `tone`: `'success'` (default), `'error'`; `title`; `children` | Icon, `title` as a bold first sentence, then the reason and the next step. Success is `role="status"`, error is `role="alert"`. Never beside an empty state for the same thing |
| `TabBar` (`components/TabBar.jsx`) | none | The whole navigation. Rendered once, by the header in `App.jsx` |
| `Account` (`components/Account.jsx`) | none | The `/account` screen. Also exports `AppSettings({ aboutLink })`: the theme switch and the links to screens with no tab |

## App shell and navigation

`app/src/App.jsx` draws the shell: skip link, header, `MoveNotice`, then `<main id="main">`.

- **Four destinations:** Calculate (`/`), My yields (`/manage-data`), Community (`/community-data`),
  Account (`/account`). There is no hamburger menu and no teal top bar.
- **On a phone** the header is the wordmark only ("Local Catch" in the display face beside a
  `brand-teal` tile with the Lucide `fish` icon) and the tabs are a bar fixed to the bottom edge:
  `surface-raised`, 56px tabs, a 24px icon over a label that is always shown.
- **From 768px** the same `<nav>` is a row of text labels in the header, which is paper (`surface`)
  with a `border-line` bottom edge and sticks to the top.
- **The current tab** is `accent` with a 3px rule (top edge on a phone, bottom edge on a desktop) and
  `aria-current="page"`. On a screen reached from a tab (Sign in, Import yields, Where the reference
  yields come from, About and the contributor profile, all under Account) the tab stays lit with
  `aria-current="true"`. Tapping the tab you are on scrolls it to the top.
- **Account** holds what the old top bar did: sign in and out, the theme switch, sync status, and links
  to Import yields (`/upload`), Where the reference yields come from (`/data-sources`) and About
  (`/about`). A guest sees one line: what they save stays on this phone until they sign in.
- **A new screen starts at its top;** going back keeps the place the browser remembers.

### Builds with no backend

`app/src/config/platform.js` exports two flags:

- `isNativeApp`: true inside the Capacitor shell on a device. `@vercel/analytics` is not rendered there.
- `backendEnabled`: false in the native app (it has no API yet) and in a web build made with
  `VITE_BACKEND=off`.

When `backendEnabled` is false there are three tabs (Calculate, My yields, About), nothing offers
sign-in, and `/login`, `/profile` and `/community-data` go to the calculator. About is the last tab, so
the shell puts `AppSettings` (the theme switch and the links to Import yields and the reference yields)
under it. `/account` still works and shows the same without sign-in.

### The bottom edge: tab bar, ticket and safe areas

- `--tabbar-height` (on `:root`) is everything the phone tab bar takes off the bottom of the screen:
  one row of tabs, its top edge and the device's bottom inset. It is `0px` from 768px.
- `<main>` pads its bottom by `--tabbar-height`, so no screen needs its own allowance for the tab bar.
- **Anything else pinned to the bottom edge must clear the tab bar.** Use `.ticket-dock`: it stays at
  `bottom: 0` with `z-index: 30` (the tab bar is 40) and pads itself by `--tabbar-height`, or by
  `env(safe-area-inset-bottom)` where there is no tab bar. Its `offsetHeight` is then everything it
  covers, so `scroll-padding-bottom` can be set from that one number and a field you tab to lands above
  both bars (WCAG 2.4.11).
- **Stopgap:** `Calculator.jsx` still pins its own result bar with utility classes. The last rule in
  `index.css` (`main [role="region"][aria-label="Your result"]`) gives that bar the same padding. Delete
  the rule when the calculator's result becomes a `.ticket.ticket-dock`.
- The header adds `env(safe-area-inset-top)`, the header and `<main>` use the side insets when they are
  wider than the gutter, and a fixed strip of `surface` sits behind the status bar. These need
  `viewport-fit=cover` in `index.html`.

## Calculator layout ("Dockside")

Chosen from the three mock-ups in `docs/design-mockups/` (direction A).

- **Tap tiles, not dropdowns,** for "What you have" and "What you're making" (radio buttons styled as
  tiles, so arrow keys and screen readers work as for any radio group). Species stays a native select:
  there are 89 of them. Products show their yield on the tile; long lists show 6 plus "Show all".
- **Steppers** (big − / + either side of a typed field) for price, pounds, yield, processing and shipping.
- **Live result bar** pinned to the bottom (today `bg-brand-teal`, number in `brand-yellow`, 6.7:1; it
  becomes the `.ticket` on `bar` when the calculator is rebuilt). It is worked out from what is on screen
  via `app/src/lib/calcEngine.js`, so a saved result always matches its inputs.
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
  height, so whatever you Tab to scrolls into view above it (WCAG 2.4.11). On a phone the bar's height
  includes the tab bar under it (see "The bottom edge" above).

## Guardrails

- `app/src/lib/__tests__/designTokens.test.js` fails if a token pair drops below its contrast target.
  Change a color, run `npm test`. It also pins the style guide's values for the paper ground, the
  ticket tokens, the two corner radii and the font family names the bundled fonts are registered under.
- Keyboard focus uses one 3px outline (`:focus-visible`) in `focus`. Inside `.ticket`, and inside
  anything marked `.focus-on-dark` (a teal or other dark fill), it is `brand-yellow` in both themes.
  Tabs draw the ring inside themselves so the screen edge cannot clip it.
- `prefers-reduced-motion` is honored globally.

## Known follow-ups

- **The calculator is not on the new components yet.** Its result bar is still teal rather than a
  `.ticket`, its mode switch is `rounded-2xl` (16px, rounder than anything in the style guide), its
  title is not in the display face, and its tiles lead with the trade code. See "Applying it" in the
  style guide, steps 3 to 5.
- **`SyncStatusBadge` is still coloured for the retired teal top bar** (light text, label hidden on
  phones). `Account.jsx` sets it on a teal chip and forces the label on. Restyle the badge with the
  sync work, then drop the chip.
- **The theme switch is light or dark.** `ThemeContext` follows the system setting until the person
  picks one, and has no way back to "follow the system".
- **Tabs do not keep their scroll position or typed values** when you switch between them, which the
  style guide asks for.
- **Unused components** `Footer.jsx` and `InstallPrompt.jsx` are not rendered anywhere and use tokens
  that no longer exist (`bg-navy`, `text-teal`, `bg-rust`). Restyle before wiring them in, or delete.
