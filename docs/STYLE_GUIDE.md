# Style guide

The look, the words and the components for Local Catch on the web and in the store apps. Written 2026-11-10 with the [November product audit](reviews/2026-11-product-audit.md).

- **Status: proposed.** The colour tokens are the ones already in `app/src/index.css`. The display typeface, the ticket, the stamps and the tab bar are new and not in the app yet; "Applying it" at the end lists the changes.
- `docs/DESIGN_SYSTEM.md` still describes how the calculator is built today. Where the two disagree, this guide is the direction.
- The reference brands named for this work (Sitka Seafood Market, Wild Alaskan Company, Outerseas) could not be opened while it was written, so no colour or typeface here is copied from them. See the audit, sections 5 and 9.

Local Catch turns what a fish costs whole into what each finished product really costs. It is used on a dock in glare, in a cold room, and at the pass mid-service, usually on a phone, often with wet or gloved hands, by people who know fish better than they know software.

Build it like a good knife: plain, sharp, made for one job, and worth owning. **Function decides every argument.** Style is what is left when nothing on the screen is in the way.

## Five rules

1. **The answer is always on screen.** The price lives on the Ticket, pinned to the bottom, and updates as the person types. There is no Calculate button and no results page.
2. **The fish is the biggest word.** Species and product names are set in the display face (`species`, `title`). Everything else is the sans.
3. **Every number says where it came from.** A yield carries a Stamp: `MAB-37 · 41–49%`, `Your yield`, `Community · 12 cuts`. Trust is the product.
4. **Thumb-sized, glare-proof.** Controls are `control-height` (48px) or `tile-height` (56px); nothing tappable is under `target-min` (44px). Text is 4.5:1 or better, control edges 3:1 or better, in both themes. Borders do the work; shadows wash out in sunlight.
5. **One loud thing.** A screen gets one `primary` button, one `bar` block (the Ticket) and one `brand-yellow` figure. If two things shout, the price loses.

## Voice

Write the way a good fishmonger talks to a chef: short, exact, no sales pitch.

- **Plain words first, trade codes second.** "Whole fish", then "Round". "Gutted, head on", then "D/H-On". Never make someone decode an acronym to use the app; never drop the code either, because buyers quote it.
- **Second person, present tense.** "What you have." "What you’re making." "What you pay per lb." Labels are things a person would say, not field names.
- **Say the number, then the reason.** "Typical 41–49%. It changes with fish size and cutting skill."
- **Sentence case everywhere**, including buttons and titles. Uppercase is for Stamps only.
- **Verbs on buttons:** "Save this price", "Add a yield", "Share". Never "Submit" or "OK".
- **Errors say what is wrong and what to type:** "Yield is a percentage from 1 to 100. Did you mean 42?" No "Oops", no apology, no exclamation marks, no emoji.
- **Units are always written:** `$9.78/lb`, `46% yield`, `6 oz portion`. Money has two decimals. Yields are whole numbers unless the person typed a decimal. Ranges use an en dash: `41–49%`.
- **One name per thing.** Use these and no others:

| Say | Not |
|---|---|
| yield | recovery rate, 0.42 |
| reference yield | default, static data |
| your yield, My yields | custom yield (in UI), user data, my data |
| saved price | calc, saved calc |
| community yields | community data pool, public data |
| account, sign in, sign out | profile, log in, login, logout |
| guest: "saved on this phone" | anonymous user, "login required" |

## Colour

The palette is deep-sea teal, warm paper, brass and sockeye red. It is used sparingly: most of a screen is `surface`, `surface-raised` and `text-primary`.

- **Ground:** `surface` for the page, `surface-raised` for cards, tiles and the tab bar. Never put a card on a card.
- **Text:** `text-primary` for anything a person reads or types; `text-secondary` for units and supporting lines; `text-muted` for help under a field and nothing more important than that.
- **Teal means chosen or go.** `primary` fills the selected tile, the pressed segment and the one primary button. `accent` is teal as text: the current tab, ghost buttons. Do not use teal fills for headers, banners or decoration; the old teal top bar is retired.
- **Brass is the answer.** `brand-yellow` is the price figure on `bar` and the 4px rule on top of the Ticket. It is never text on paper (it fails contrast there) and never a button.
- **Ink is the Ticket.** `bar` is darker than teal and appears once per screen.
- **Sockeye is rare.** `link` for inline links and the "Your yield" stamp; `brand-cta` for at most one conversion button per screen. `brand-terracotta` is for illustration only.
- **Status is never colour alone.** `success` and `danger` always come with an icon and a word.
- **Edges:** `border-strong` on every control. `border` and `border-subtle` are decoration and may not be the only thing separating a control from its ground.
- **Focus:** a solid 3px ring in `focus`, 2px off the element; on `bar` and teal fills it is `brand-yellow`.
- **Themes:** Daylight (light) is the default outdoors. Galley (dark) follows the system setting and is tuned for a dim kitchen or wheelhouse; it is a first-class theme, not an inversion. Never hard-code a hex in a component; if a token is missing, add the token.

## Type

Two families, both bundled with the app so it works with no signal.

- **Fraunces** (`display`, `title`, `species`, `heading`) for the names of things: species, products, screens, sections. Weight 600–650, lining figures, never italic, never below 20px, never in a button, label, tile or table. Keep `SOFT` and `WONK` at 0: the sturdy cut, not the wobbly one.
- **Inter** (`control`, `body`, `label`, `helper`, `eyebrow`, and all `figure-*`) for everything a person operates and every number. Numbers always use `font-variant-numeric: tabular-nums lining-nums` so digits do not jump while typing and columns line up.
- Scientific names are sans italic at `helper` size under the species: *Oncorhynchus nerka*.
- `body` (16px) is the smallest text in a form; `helper` (14px) is the smallest text anyone must read; `eyebrow` (12px) is for Stamps and tab labels only.
- One `title` per screen. Headings do not skip levels and are never centred; the app reads from the left edge down.
- Running copy stops at `measure` (65 characters).

## Shape, space and depth

- Corners: `radius-md` (8px) for buttons and inputs, `radius-lg` (12px) for cards, tiles and stepper buttons, `radius-sm` (4px) for Stamps. `radius-pill` is for step numbers only.
- Spacing comes from the 4px scale: `space-4` side gutters on a phone, `space-5` inside cards, `space-4` between cards, `space-8` under a screen title.
- Depth: cards are flat with a `border` edge and `shadow-card`. Only the Ticket (`shadow-ticket`) and dialogs sit above the page.
- No gradients, no glass, no blur, no icon-in-a-coloured-square page headers, no decorative dividers.

## Layout and navigation

- A phone is the first and main layout: one column, thumb reach, the Ticket and TabBar on the bottom edge.
- Four destinations: **Calculate · My yields · Community · Account** (see TabBar). No hamburger menu, no top navigation bar on a phone.
- From 768px the column stops at `content-width` (672px) and the tabs move to a text row at the top on `surface`.
- Reading pages (Community, About inside Account) use the same column and left edge as the calculator. Nothing is centred except numbers inside steppers.
- Empty states say what will appear and how to add the first one, with one button. A guest is never shown a wall that says to sign in: they see what is saved on this phone.

## Icons and imagery

- Icons are **Lucide** (`lucide-react`, the set the app already ships), 2px stroke, 20px in buttons and 24px in the tab bar, always in the text colour beside them. An icon never stands alone without an accessible name, and tab icons always have their label.
- **There is no logo yet.** Set the name "Local Catch" in Fraunces 650 beside a `radius-sm` `brand-teal` tile holding the Lucide `fish` icon. Do not draw a mark, and do not use the Local Catch Network's logo without their say-so.
- The app icon and store art use `brand-teal`, `brand-yellow` and `surface` only.
- No stock photography and no decorative fish clip-art in the app. Photography belongs on the store listing and About: real boats, real cutting tables, real hands, natural light. Species illustrations, if commissioned, are single-colour line drawings in `text-primary`, used as small wayfinding marks beside species names.

## Motion and feedback

- Colour and border changes take 150ms. Nothing slides, bounces or fades in on load.
- The price changes in place, instantly. Do not count up to it.
- `prefers-reduced-motion` turns every transition off.
- In the store app a light haptic tap confirms a stepper press and a successful save.

## In the App Store build

- Respect the safe areas: the Ticket and TabBar add the bottom inset to their own padding; the first row clears the status bar.
- Fonts, icons and every reference yield are in the bundle. Nothing on the Calculate tab needs the network.
- No browser furniture: no "open in browser" links, no pinch-zoom, no text selection on controls, no web-style underlined navigation.
- Share uses the system share sheet. Sign-in is a sheet over the screen the person was on, never a page that loses their numbers.
- Text respects the system text-size setting up to 130%; layouts wrap, they do not clip.

## Tokens

Light is the Daylight theme, dark is Galley. "New" tokens are not in `app/src/index.css` yet.

### Colour

| Token | Daylight | Galley | Use |
|---|---|---|---|
| `surface` | `#f5f0eb` | `#0d1f26` | Page ground. Warm paper in daylight, cold-water ink in the galley theme. |
| `surface-raised` | `#ffffff` | `#132830` | Cards, tiles, input rows and the tab bar, on surface. |
| `text-primary` | `#1a2e35` | `#e8ddd4` | Body copy, labels, titles and typed numbers on surface and surface-raised (13:1 or better in both themes). |
| `text-secondary` | `#4a6572` | `#8fa8b2` | Supporting copy and unit suffixes on surface and surface-raised (5.9:1 or better). |
| `text-muted` | `#557080` | `#7f9aa6` | Helper lines and placeholders on surface and surface-raised (4.6:1 on surface in daylight, the tightest pair in the system; never go lighter). |
| `border` | `#d6ccc4` | `rgba(255, 255, 255, 0.12)` | Card edges and dividers. Decoration only (1.5:1); never the only edge of a control. |
| `border-subtle` | `#ede7e0` | `rgba(255, 255, 255, 0.06)` | Rules between rows inside a card. Decoration only. |
| `border-strong` | `#857a70` | `#6f8b96` | Edges of inputs, selects, tiles and steppers on surface and surface-raised (3.7:1 or better). |
| `primary` | `#014457` | `#0b7a99` | Fill of the one primary action on a screen and of the selected tile, with on-primary text (10.7:1 daylight, 4.9:1 galley). |
| `primary-hover` | `#025a72` | `#096a86` | Hover and pressed state of primary fills. |
| `on-primary` | `#ffffff` | `#ffffff` | Text and icons on primary, primary-hover and brand-cta fills. **New.** |
| `accent` | `#014457` | `#7fd0e3` | Teal used as text or icon on surface and surface-raised: the active tab, ghost buttons, key links in running UI (9.4:1 daylight, 8.9:1 galley). |
| `link` | `#a34329` | `#ec8f72` | Sockeye red used as text on surface and surface-raised: inline links, 'Show all 14 products', the 'your yield' stamp (5.5:1 or better). |
| `focus` | `#014457` | `#f7c648` | The 3px focus ring on surface and surface-raised. On bar, brand-teal and primary fills the ring is brand-yellow in both themes. |
| `success` | `#166534` | `#4ade80` | Status text on surface and surface-raised: saved, synced. Always with an icon and a word; success and danger are close in lightness, so hue alone must never carry the meaning. |
| `danger` | `#b42318` | `#fca5a5` | Error text and the edge of an invalid field on surface and surface-raised. Always with an icon and a word. |
| `bar` | `#0b2a33` | `#06141a` | Ground of the price ticket, the one darkest block on a screen. **New.** |
| `on-bar` | `#f5f0eb` | `#f5f0eb` | Labels and line items on bar (13:1 or better). **New.** |
| `on-bar-muted` | `#a9c0c7` | `#a9c0c7` | Secondary lines and dashed rules on bar (7.9:1 or better). **New.** |
| `brand-yellow` | `#f7c648` | `#f7c648` | Brass. The answer: the price figure on bar (9.4:1) and the 4px rule on top of the ticket. Never body text on paper, never a button fill. |
| `brand-teal` | `#014457` | `#014457` | Fixed deep-sea teal for the app icon, the wordmark tile and store art. In UI use primary or accent, which follow the theme. |
| `brand-teal-light` | `#025a72` | `#025a72` | Fixed lighter teal for illustration and store art only. |
| `brand-terracotta` | `#ca5f40` | `#ca5f40` | Sockeye. Fixed fill for illustration and decoration. Too light for white text (4.0:1) or for text on paper: use brand-cta for fills and link for text. |
| `brand-terracotta-light` | `#d97356` | `#d97356` | Illustration tint only. |
| `brand-cta` | `#b04a2e` | `#b04a2e` | Sockeye fill that holds on-primary text (5.4:1). Reserved for the one conversion moment a screen may have: 'Create account', 'Share price card'. |
| `brand-cta-hover` | `#963d24` | `#963d24` | Hover and pressed state of brand-cta. |

### Type

| Style | Family | Size / line | Weight | Use |
|---|---|---|---|---|
| `display` | Fraunces | 40px / 44px | 650 | Store listing, About and sign-in headline. One per screen, never inside the calculator. |
| `title` | Fraunces | 30px / 34px | 650 | Screen title. |
| `species` | Fraunces | 24px / 28px | 600 | The chosen species, and species names in lists. The fish is always the largest word in its card. |
| `heading` | Fraunces | 20px / 26px | 600 | Section heading inside a screen. |
| `control` | Inter | 18px / 24px | 700 | Tile and segmented-control labels. |
| `body` | Inter | 16px / 24px | 400 | Running copy and input text. Never smaller in a form: 16px stops iOS zooming on focus. |
| `body-strong` | Inter | 16px / 24px | 600 | Buttons and emphasised body copy. |
| `label` | Inter | 14px / 20px | 600 | Field labels and tab labels. |
| `helper` | Inter | 14px / 20px | 400 | Help under a field. The floor for reading text; nothing a person must read is smaller. |
| `eyebrow` | Inter | 12px / 16px | 700 | Uppercase stamps and source labels only. Never a sentence. |
| `figure-hero` | Inter | 52px / 52px | 800 | The answer on the ticket, in brand-yellow on bar. One per screen. Tabular lining numerals. |
| `figure` | Inter | 24px / 32px | 800 | Numbers typed into a stepper. Tabular lining numerals. |
| `figure-sm` | Inter | 16px / 24px | 600 | Line items on the ticket and numbers in tables. Tabular lining numerals, right-aligned in columns. |

### Spacing

| Token | Value | Use |
|---|---|---|
| `space-1` | `4px` | Icon to label. |
| `space-2` | `8px` | Between tiles in a grid; between a stepper's buttons and its field. |
| `space-3` | `12px` | Label to control; inside tiles. |
| `space-4` | `16px` | Screen side gutter on a phone; between fields. |
| `space-5` | `20px` | Card padding on a phone. |
| `space-6` | `24px` | Between cards; card padding from 640px up. |
| `space-8` | `32px` | Between a screen title and its first card. |
| `space-12` | `48px` | Between sections on reading pages (About, Community). |

### Radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | `4px` | Stamps and the wordmark tile. Small and square reads as a printed label. |
| `radius-md` | `8px` | Buttons and text inputs (Tailwind rounded-lg in the app). |
| `radius-lg` | `12px` | Cards, tiles and stepper buttons (Tailwind rounded-xl in the app). |
| `radius-pill` | `999px` | Step numbers and count badges only. Buttons are never pills. |

### Shadow

| Token | Value | Use |
|---|---|---|
| `shadow-card` | `0 1px 2px 0 rgba(0, 0, 0, 0.05)` | Cards. The border does the work; this is barely there on purpose, because shadows wash out in glare. |
| `shadow-ticket` | `0 -4px 16px rgba(0, 0, 0, 0.18)` | The ticket pinned over scrolling content. The only raised layer in the app besides dialogs. |

### Size

| Token | Value | Use |
|---|---|---|
| `control-height` | `48px` | Minimum height of buttons, inputs and selects: wet or gloved hands. |
| `tile-height` | `56px` | Minimum height of choice tiles, stepper buttons and tab-bar items. |
| `target-min` | `44px` | Smallest tappable thing anywhere, including text links in a row of their own. |
| `measure` | `65ch` | Widest line of running copy. |
| `content-width` | `672px` | Widest the calculator column grows on a desktop (Tailwind max-w-2xl in the app). |

## Components

| Component | What it is | Where it is today |
|---|---|---|
| Button | 48 px action, one primary per screen | `.btn-primary`, `.btn-secondary`, `.btn-ghost` in `index.css` |
| Field | Labelled input or select at 16 px | `.form-label`, `.form-input`, `.form-select` |
| ChoiceTile | A radio drawn as a 56 px tile, plain name first, trade code or yield second | In `Calculator.jsx`; today the code leads |
| Stepper | A typed number with big minus and plus | In `Calculator.jsx` |
| Segmented | Two or three modes of one screen | The "Cost per pound / Pounds to buy" switch |
| Ticket | The answer, pinned to the bottom, with its line items, Save and Share | The result bar in `Calculator.jsx`; no line items, Save or Share yet |
| TabBar | Calculate · My yields · Community · Account | **New.** Replaces the top nav and hamburger |
| Stamp | Where a number came from | **New** |
| Notice | What just happened, with an icon and a word | Ad-hoc `bg-red-50` boxes today |

## Applying it

In this order, so each step is small and shippable:

1. **Tokens.** Add `--color-bar`, `--color-on-bar`, `--color-on-bar-muted` and `--color-on-primary` to `app/src/index.css` and `tailwind.config.js`, and add their pairs to `designTokens.test.js`.
2. **Fonts.** Bundle Inter and Fraunces as `woff2` files in the app (for example `@fontsource-variable/inter` and `@fontsource-variable/fraunces`), add a `font-display` family to the Tailwind config, and remove the Google Fonts links from `index.html` and the font caching rules from `vite.config.js`.
3. **Ticket.** Move the result bar to `bar`, add the dashed line items (price across the yield range first), then Save and Share.
4. **Tiles and stamps.** Plain-language names with the code on the second line; a stamp on every yield.
5. **Titles.** Screen titles, section headings and the species name in the display face.
6. **Navigation.** The four-tab bar on phones, a text row from 768 px, a paper top bar. Delete the hamburger menu.
7. **Secondary screens.** Rebuild Sign in, My yields, Community and Account from these components as the Firebase issues (#123–#129) touch them. Do not restyle screens that ADR 0003 removes.
8. **Words.** Apply the naming table across the app in one pass.

Type sizes for Fraunces were chosen by rendering the candidates with the app's own copy. Every text and edge pair in the token table was checked against WCAG 2 contrast (4.5:1 for text, 3:1 for control edges) in both themes.
