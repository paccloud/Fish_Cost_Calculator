# Species codes for the bulletin's tables

`species.json` gives each table in `research/mab37/mab37.json` its FAO ASFIS 3-alpha code and WoRMS AphiaID, so a yield can be joined to FAO, EU and NOAA data.

- 80 tables, 92 scientific names: 69 found as printed, 12 after a correction, 11 not found. 11 tables print no scientific name.
- `corrections.json` holds the 12 corrections: names that changed after 2004 (walleye pollock is now *Gadus chalcogrammus*) or that the bulletin misprints (thornyhead under *Sebastes*). Each was checked against the FAO list by hand.
- The 11 not found are genus-level entries such as "*Acipenser* sp." where FAO has no code for the genus. They are left unmatched on purpose; picking one species would invent precision.

## Rebuilding

The FAO list is not kept in this repository. Download the two files and pass their paths:

```bash
curl -LO https://raw.githubusercontent.com/fdiwg/fdi-codelists/main/global/cwp/cl_asfis_species.csv
curl -LO https://raw.githubusercontent.com/fdiwg/fdi-codelists/main/global/cwp/cl_asfis_species_enriched_with_worms.csv
node research/vocab/build-species.mjs cl_asfis_species.csv cl_asfis_species_enriched_with_worms.csv
```

## Source and licence

The ASFIS List of Species for Fishery Statistics Purposes is FAO's. The copy used is the one the FAO/FIRMS fisheries data working group publishes on GitHub (`fdiwg/fdi-codelists`), read on 2026-11-12. That repository has no licence file, so cite FAO as the source and check FAO's terms before redistributing the whole list. The codes themselves are identifiers and are used here as such.

FishBase is deliberately not used: its data licence is non-commercial.
