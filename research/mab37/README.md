# MAB-37, re-read from the page images

The app's reference yields come from "Recoveries and Yields from Pacific Fish and Shellfish" (Alaska Sea Grant Marine Advisory Bulletin 37, revised 2004). The first extraction read the scan's text straight across both columns of each spread and guessed which species a row belonged to. This folder holds a second reading made from the page images, with every row kept under the heading and starting form it is printed under.

- `pages/page-NN-left.json`, `page-NN-right.json`: one file per printed page, as transcribed. These are the record; edit a value only after looking at the scan again.
- `build.mjs`: checks the page files and joins them into `mab37.json` and `mab37.csv`.
- `to-app.mjs`: writes the reference yields the app ships, `app/src/data/mab37_yields.js`, from `mab37.json`. Every conversion is a row of the bulletin with its average and range; where the bulletin prints only a range the yield is left empty. `--check` fails if the app's file is out of date, and so does a test in the app.
- `app-species.json`: which tables of the bulletin each species in the app uses, checked by hand.
- `cautions.json`: what the app says beside a value that looks wrong in the bulletin itself.
- `compare.mjs`: an independent check that the app's yields equal `mab37.json`; writes `comparison.md`. Before November 2026 the app's data was a hand-kept copy, and this is how its errors were found.
- `corrections-2026-11.md`: every yield that changed when the app's data was regenerated.
- `references.json`: the bulletin's own list of sources.

```bash
node research/mab37/build.mjs && node research/mab37/to-app.mjs && node research/mab37/compare.mjs
```

Alaska Sea Grant holds the copyright in the bulletin. Individual yields are facts, but the bulletin's text and layout are not ours to republish; see the product audit, section 2.6.
