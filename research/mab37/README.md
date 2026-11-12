# MAB-37, re-read from the page images

The app's reference yields come from "Recoveries and Yields from Pacific Fish and Shellfish" (Alaska Sea Grant Marine Advisory Bulletin 37, revised 2004). The first extraction read the scan's text straight across both columns of each spread and guessed which species a row belonged to. This folder holds a second reading made from the page images, with every row kept under the heading and starting form it is printed under.

- `pages/page-NN-left.json`, `page-NN-right.json`: one file per printed page, as transcribed. These are the record; edit a value only after looking at the scan again.
- `build.mjs`: checks the page files and joins them into `mab37.json` and `mab37.csv`.
- `compare.mjs`: compares `mab37.json` with `app/src/data/fish_data_v3.js` and writes `comparison.md`. It changes nothing in the app.
- `species-map.json`: which table in the bulletin each app species uses, checked by hand, for the cases names and scientific names do not settle.
- `references.json`: the bulletin's own list of sources.

```bash
node research/mab37/build.mjs && node research/mab37/compare.mjs
```

Alaska Sea Grant holds the copyright in the bulletin. Individual yields are facts, but the bulletin's text and layout are not ours to republish; see the product audit, section 2.6.
