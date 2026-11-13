# EU presentation codes and conversion factors

Extracted from Commission Implementing Regulation (EU) 2025/2196 of 17 October 2025, which replaced Regulation (EU) No 404/2011 on 10 January 2026.

- `presentation-codes.json`: the 32 product presentation codes (Annex I, Table 1), such as `WHL` whole, `GUT` gutted, `GUH` gutted and headed, `FIL` filleted, `FIS` filleted and skinned.
- `state-codes.json`: the 6 state-of-processing codes (`FRE` fresh, `FRO` frozen, `SAL` salted and so on).
- `conversion-factors.json`: 250 factors for 63 species. Annex XII (fresh) has 122, Annex XIII (fresh salted) 1, Annex XIV (frozen) 127.

A factor is live weight divided by product weight. `yield_pct` is 100 divided by the factor, rounded to one decimal place. These are control standards set by regulation, not measurements, and they carry no range. They only describe whole fish to a product; a yield between two processed forms has to be derived from two factors and labelled as derived.

## Rebuilding

```bash
curl -LO https://raw.githubusercontent.com/legalize-dev/legalize-eu/main/eu/b8/32025R2196.md
node research/sources/eu-2025-2196/extract.mjs 32025R2196.md
```

Each output file records the SHA-256 of the input it was built from.

## Source and licence

The official text is at <http://data.europa.eu/eli/reg_impl/2025/2196/oj>. The extraction's input was a Markdown copy of the EUR-Lex text from a third-party GitHub mirror, read on 2026-11-12. On 2026-11-13 the output was checked against the official HTML on EUR-Lex (`https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202502196`): all 250 factors and all 32 presentation codes match, with nothing missing and nothing extra. EU legal texts may be reused with attribution under Commission Decision 2011/833/EU.
