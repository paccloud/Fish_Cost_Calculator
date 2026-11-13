# Design system notes

> **Direction:** [`STYLE_GUIDE.md`](STYLE_GUIDE.md) (November 2026) sets where the look, words and navigation are going. This file describes what is built: the tokens, the shared classes and components, the app shell and the calculator are on the style guide; the secondary screens are still being moved onto them.

Supersedes the navy/rust direction in `docs/archive/2026-03-27-branding-redesign-design.md`
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
  (`/about`). A guest sees one line: what they save stays on this phone until they sign in ("this device" on
  anything that is not a narrow touch screen; the word comes from `thisDevice` in `config/platform.js`).
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
- The calculator's ticket is the one user of `.ticket-dock` today (on a wrapper, so a notice can sit
  above the ticket inside the dock). It sets `scroll-padding-bottom` and its own bottom padding from
  the dock's `offsetHeight`; see "Calculator layout" below.
- The header adds `env(safe-area-inset-top)`, the header and `<main>` use the side insets when they are
  wider than the gutter, and a fixed strip of `surface` sits behind the status bar. These need
  `viewport-fit=cover` in `index.html`.

## Calculator layout ("Dockside")

Chosen from the three mock-ups in `docs/design-mockups/` (direction A) and rebuilt on the style
guide's components. `app/src/components/Calculator.jsx` holds the state and the page;
`app/src/components/calculator/` holds its parts.

| File | What it is |
|---|---|
| `ticketModel.js` | Pure: typed text and the chosen conversion in, everything the ticket says out (`buildTicketModel`), plus the field messages and `yieldSource` for the stamp. The screen does no arithmetic of its own |
| `priceActions.js` | `savedPriceRecord`, `savePrice` (through `useData().saveCalc`) and `priceCardFor` (through `buildPriceCard`) |
| `sharePrice.js`, `haptics.js` | The share sheet or the clipboard; a light haptic in the store app. The Capacitor plugins are imported only when used |
| `remembered.js` | The last margin and portion size (`localStorage`) and whether the ticket's details are open (`sessionStorage`) |
| `names.js` | Plain names for tiles and sentences; a person's own yields (`from: 'Custom'` in the merged data) are "Your yields" |
| `Ticket`, `ChoiceTile`, `Stepper`, `Segmented`, `ExtraCost`, `FieldError`, `HelpTip` | The parts, one per file |

- **One title** (`.type-title`, "What does it really cost?"), then the mode switch, then two numbered
  cards. Step numbers are outlined circles beside a `.type-heading`.
- **Segmented** ("Cost per lb" / "Pounds to buy"): 48px segments with 6px corners in a tray with 8px
  corners. The pressed segment and the selected tiles are the only teal fills on the screen. Smaller
  on/off choices (recent species, the Low / Average / High yields) show pressed with a doubled teal
  edge and no fill.
- **Species** stays a native select (there are 89), with up to five recent species above it as 44px
  buttons (`recentSpecies.js`; a species already in the row keeps its place). Under it the chosen
  species is set in `.type-species` with its scientific name in `.type-latin` and a `Stamp` for the
  source (`MAB-37`, or `Your yields` when every yield for it is the person's own).
- **Tap tiles, not dropdowns,** for "What you have" and "What you’re making": radio buttons drawn as
  56px tiles (`ChoiceTile`), left-aligned, two columns on a phone and three from 640px, each row as
  tall as its tallest tile. The plain name leads (`plainFormName`). A starting form has its trade
  code on the second line. A product has its yield on the second line and its code on a third when
  the code fits on one line of a phone tile (16 characters: "D/H-Off"); a longer code
  ("SIB Fillet (Pinboning)") would make a six-line tile, so it is in the radio's name for screen
  readers only. Long lists show 6 plus "Show all". The glossary of trade codes ("What do D/H-On, S/B
  and Round mean?") is a disclosure directly under the tiles.
- **Steppers** (a 56px minus and plus either side of a typed field) for price, pounds, yield, margin,
  portion size, processing and shipping. The field is as wide as its text, so the `$` or unit sits
  beside the number. In the store app a press gives a light haptic.
- **Every yield has a Stamp.** Beside the yield box: `MAB-37 · 41–49%` while the yield is one of the
  source's three figures (the average or either end of its range), `MAB-37` when no range is
  reported, and `Your yield` once the person types their own or uses a yield they recorded. With
  `Your yield`, the line under the box still gives the reference yield and range.
- **Processing and shipping** start folded behind one ghost button, "Add processing or shipping", and
  are open whenever either has a value. Open, the button hides them (when both are blank) or removes
  them (clears both). Each is charged per lb of **incoming** weight (the starting fish; divided by
  yield) or **outgoing** weight (the finished product; added as is), with a line spelling out what
  the charge comes to per finished lb.
- **What to charge** (cost mode only): "Your margin" (percent of the sell price, so it stops at 99)
  and "Portion size" (ounces). Both optional, blank the first time, and remembered on the device.
- **Number boxes read what people type** (`app/src/lib/numberInput.js`): "$4.50", "1,000", "42%" and
  "4,50" all work. Text that isn't a number marks that box as invalid and the ticket says to use
  numbers; it never counts as 0, because a wrong answer is worse than none. A message under a box
  (`FieldError`) has an icon and says what to type.
- **Works with no signal.** The calculator starts from the bundled reference yields
  (`FISH_DATA_V3`, given `from`/`to` by `app/src/lib/fishDataShape.js`) and the service worker serves
  the app, so it works on a boat with no connection. `/api/fish-data` replaces that data only when it
  sends usable yields, and what is already picked stays picked. A signed-in person's own yields come
  from the copy `DataContext` keeps on the device (merged by `app/src/lib/fishDataMerge.js`), which the
  sync refreshes when there is signal (and each time the calculator opens), so they work offline too.
  If a sync changes the yield you picked, the yield box follows it, unless you typed your own.

### The ticket

`Ticket.jsx` draws a `.ticket` inside a `.ticket-dock` wrapper from the ticket model.

- **With an answer:** "Your cost per lb of" and the product in the display face, the figure in brass
  with "/lb", Save and Share, then the line items under the dashed rule, in this order and each only
  when it has something true to say:
  1. the price across the conversion's typical yields, while the yield in use is inside that range;
  2. Fish, Processing and Shipping, once processing or shipping adds to the price;
  3. the sell price at the person's margin;
  4. what one portion costs.
- **Without one:** a single sentence saying what is missing ("Choose what you’re making.", "Type what
  you pay per lb of whole fish."), or what to fix. There is an answer only when it is a finite amount
  above zero that does not round away, so `$0.00`, `NaN` and `Infinity` cannot appear.
- **"Pounds to buy"** shows the weight to buy and one line for what it makes. Margin, portion,
  processing, shipping and Share do not apply and are not shown.
- **On a phone** the line items sit behind "Price details" (a button with `aria-expanded`, closed by
  default, remembered for the session) so the ticket is about 150px over the tab bar. **From 768px**
  they are always shown, beside the figure and its actions and not under them, so the ticket stays
  about 170px tall on a wide screen. The dock is as wide as the window; an inner wrapper keeps what it says to
  the content column.
- **The figure never wraps or clips.** Its type shrinks with the number of characters and the screen
  width (52px down to 28px); below that the actions wrap under it.
- **Save** stores the price through `useData().saveCalc`: on the device first, for a guest and for
  someone signed in alike, and the data layer then syncs a signed-in person's record. The button
  reads "Saved" until a number changes, so one price is not saved twice. It is disabled while the app
  is read-only.
- **Share** builds plain text with `buildPriceCard` and hands it to the native share sheet in the
  store app, to `navigator.share` on the web where it exists, and otherwise copies it. What was paid
  is left out unless "Include what I paid" is ticked. Closing the share sheet is not an error.
- **Notices** ("Saved.", "Copied.", and the two failures) appear just above the ticket, inside the
  dock. Successes go after 8 seconds; everything goes when a number changes.
- **Screen readers** get the answer once typing pauses, from a separate polite live region, not on
  every keystroke.
- **Nothing hides behind it.** The screen sets the page's `scroll-padding-bottom` and its own bottom
  padding from the dock's height (ticket, notice and tab bar), so whatever you Tab or arrow to
  scrolls into view above it (WCAG 2.4.11). If the ticket grows while a control has focus, the
  control is scrolled back above it.
- **A guest** sees one line under the cards: saved prices stay on this phone, and signing in keeps
  them across devices. When `backendEnabled` is false the screen mentions no accounts at all.

## Guardrails

- `app/src/lib/__tests__/designTokens.test.js` fails if a token pair drops below its contrast target.
  Change a color, run `npm test`. It also pins the style guide's values for the paper ground, the
  ticket tokens, the two corner radii and the font family names the bundled fonts are registered under.
- Keyboard focus uses one 3px outline (`:focus-visible`) in `focus`. Inside `.ticket`, and inside
  anything marked `.focus-on-dark` (a teal or other dark fill), it is `brand-yellow` in both themes.
  Tabs draw the ring inside themselves so the screen edge cannot clip it.
- `prefers-reduced-motion` is honored globally.

## Known follow-ups

- **The calculator only merges a signed-in person's own yields.** A guest's yields kept on the
  phone are not offered in the calculator yet (`myYields` in `Calculator.jsx`).
- **`ChoiceTile`, `Stepper` and `Segmented` live under `components/calculator/`.** Move them up a
  level when a second screen needs one.
- **The theme switch is light or dark.** `ThemeContext` follows the system setting until the person
  picks one, and has no way back to "follow the system".
- **Tabs do not keep their scroll position or typed values** when you switch between them, which the
  style guide asks for.
