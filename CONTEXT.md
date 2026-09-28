# Local Catch — domain glossary

Terms as this project uses them. Use these words in code, issues and docs.

## Yields and costs

- **Conversion** — going from one state of a fish to another, written
  `From → To` (e.g. `Round → Skinless Fillet`).
- **Yield** — the percentage of weight kept by a conversion, 0 < yield ≤ 100.
  Always a percent in the UI and API, never a fraction.
- **Reference yields** — the bundled yields from the MAB-37 publication
  (`app/src/data/fish_data_v3.js`). Read-only, ship with the app, work offline.
- **Custom yield** — a yield a person records from their own processing.
  Private to them unless shared.
- **Saved calculation** — a cost calculation a person chose to keep.

## People and sharing

- **Account** — optional. It exists for two reasons only:
  1. keeping a person's custom yields and saved calculations across devices;
  2. sharing custom yields to the community dataset.
  The calculator never requires an account.
- **Guest** — someone using the app without signing in. The first time a guest
  saves something, they get an anonymous Firebase account; signing in later
  keeps the same data. Clearing browser data loses a guest's data.
- **Shared yield** — a custom yield its owner has chosen to make public.
- **Community dataset** — all shared yields, readable by anyone, attributed by
  display name or "Anonymous". Never attributed by email.
- **Display name** — the only public identity. Set by the person; optional.

_Avoid:_ "contributor profile" (dropped — no bio/organization pages),
"username" for anything public.
