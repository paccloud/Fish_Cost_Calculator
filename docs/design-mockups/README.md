# Calculator design mock-ups

Three candidate directions for the calculator screen, plus a visual board that shows them side by side. Each file is self-contained (data, styles and images are inlined), so it opens straight from disk in a browser with no build step or network.

| File | What it is |
|---|---|
| `visual-board.html` | Overview: phone and desktop views of A, B and C in light and dark mode, plus before/after captures of the accessibility pass merged in #118. Start here. |
| `mockup-a-dockside.html` | **A · Dockside**: big tap tiles, +/− steppers, a live result bar pinned to the bottom, no Calculate button. |
| `mockup-b-market-board.html` | **B · Market Board**: a prep-ticket form and a price tag that shows the math and dims when inputs change, with an explicit "Price it" button. |
| `mockup-c-clear-water.html` | **C · Clear Water**: a fill-in-the-blank sentence with a live, written-out answer. |

## Status

- **Direction A (Dockside) was chosen** and is built into the app (`app/src/components/Calculator.jsx`),
  with shipping added, and processing and shipping each charged on incoming or outgoing weight (the
  mock-up hid the processing choice in a collapsed section; the app shows both up front). See
  "Calculator layout" in `docs/DESIGN_SYSTEM.md`. These files stay as the record of the options; the app
  does not use them.
- The directions are original and are **not** derived from the reference sites named in the redesign request (Grace Communications, NAMA, NFFC, Local Catch Network). Those sites could not be reached when the mock-ups were made.
- Yields are real values from `app/src/data/fish_data_v3.js` for five species (Pink Salmon, Sockeye Salmon, Pacific Halibut, Pacific Cod, Lingcod), copied in at build time. They will not follow later changes to that file.
- Colors and type follow the current brand tokens in `docs/DESIGN_SYSTEM.md`. Screenshots on the board were taken with a fallback font, so real devices using Inter will look slightly narrower.
