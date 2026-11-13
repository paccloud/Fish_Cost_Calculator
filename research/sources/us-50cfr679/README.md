# US federal recovery rates for Alaska groundfish

From 50 CFR Part 679 (Fisheries of the Exclusive Economic Zone off Alaska), a work of the US Government and in the public domain.

- `table3-as-printed.json`: Table 3, Product Recovery Rates for Groundfish Species and Conversion Rates for Pacific Halibut, as printed [80 FR 11910, Mar. 5, 2015]. 23 species lines, 30 product columns. This is the record; edit a value only after looking at the printed table again.
- `recovery-rates.json`: the same as one row per rate, with the yield as a percentage.
- `product-codes.json`: Table 1a, the 38 delivery condition and product codes with their definitions. This is the only published list that defines the Western cut (07, head removed in front of the collar bone) and the Eastern cut (08, behind it).
- `species-codes.json`: Table 2a, the 65 groundfish species codes.
- `comparison-with-mab37.md`: the federal rates beside the bulletin's averages and ranges, 126 pairs.

A recovery rate is product weight divided by round weight. These are standards set for catch accounting, one per species group, with no range. They are not measurements of any one plant or boat.

## How it was read

Table 3 is published only as three page images, in the eCFR and in the printed edition alike. It was read by eye on 2026-11-13 from the 10-1-24 printed edition (govinfo.gov, `CFR-2024-title50-vol13-part679.pdf`, PDF pages 447 to 449), rotated upright at 300 dpi. **It has been read once.** The bulletin was read twice, by image and by text layer; this table has no text layer, so a second reading by someone else is still owed before the numbers are relied on.

Two cells are odd as printed and are transcribed as printed, each with a note:

- Giant grenadiers, fillets with skin and no ribs: `24.3`. A rate cannot be above 1; it is probably 0.243.
- Pacific cod, mince: `0.5`, with one decimal where every other rate has two.

Tables 1a and 2a are text in the eCFR and were extracted by script.

## Rebuilding

```bash
curl --compressed -G -o table-1a.xml "https://www.ecfr.gov/api/versioner/v1/full/2026-11-10/title-50.xml" --data-urlencode "part=679" --data-urlencode "appendix=Table 1a to Part 679"
curl --compressed -G -o table-2a.xml "https://www.ecfr.gov/api/versioner/v1/full/2026-11-10/title-50.xml" --data-urlencode "part=679" --data-urlencode "appendix=Table 2a to Part 679"
node research/sources/us-50cfr679/build.mjs table-1a.xml table-2a.xml
```

Without the two files the script rebuilds only `recovery-rates.json` and the comparison.

## What the comparison shows

- Where the bulletin prints a range, the federal rate is inside it for 81 of 115 pairs. On average the federal rate is 1.3 points below the bulletin's average.
- The bulletin's unqualified `D/H-Off` sits close to the federal **Western cut** for cod (63 against 57), sablefish (68 against 68) and Atka mackerel (68 against 64), and well above the Eastern cut. So the bulletin's plain `D/H-Off` is best read as a Western cut.
- The bulletin's fillet yields are higher than the federal skinless, boneless rate almost everywhere (pollock 34 against 21, soles 23 to 33 against 22). The federal definition removes skin and ribs; the bulletin's "skinless fillet" probably keeps the ribs for most species.
- Pollock mince is 50 in the bulletin and 22 in the federal table, and skate wings 23 against 32. Neither is close; both need a third source.
