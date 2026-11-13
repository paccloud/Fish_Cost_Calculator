# Reference data, standards and the road to shipping (November 2026)

Written 2026-11-12, after the [product audit](2026-11-product-audit.md). It answers four questions the owner asked:

1. Is the reference data right, and can the bulletin be re-extracted properly?
2. What other yield datasets exist?
3. Is there an existing ontology or industry schema to adopt, and should we implement GS1?
4. How could the app grow into helping a direct marketer ship a catch and find a buyer?

Evidence is labelled throughout. **Checked** means read from the source or measured here. **Search only** means it came from search-result text because the site was blocked from this environment; treat it as a lead, not a fact. Section 7 lists what to verify.

## Summary

| Question | Answer |
|---|---|
| Is the app's data right? | Mostly. 623 of its 655 conversions match the bulletin. **23 have wrong numbers, 9 are under the wrong starting form or the wrong species, and 56 printed rows are missing.** Every one is listed in [`research/mab37/comparison.md`](../../research/mab37/comparison.md). Nothing in the app has been changed yet. |
| Other datasets? | Yes, and two are now in the repository. The **US federal recovery rates for Alaska groundfish** (public domain, same species): 162 rates, set beside the bulletin in 126 places. The **EU's official conversion factors**: 250 factors for 63 species, checked against EUR-Lex. USDA tables cover meat, poultry and produce. |
| An existing ontology? | No single one covers product forms. The workable set is **FAO species codes + WoRMS IDs** for species (done for 82 of the bulletin's 92 names), **EU presentation codes cross-referenced to Alaska's product codes** for forms, and a few facets of our own for what neither has. |
| Implement GS1? | **Be compatible with it; do not issue it.** Build the data in the shape of the seafood traceability standard (GDST, which is built on GS1's event standard), with optional fields for a fisherman's own GS1 numbers. That costs nothing and needs no membership. See [ADR 0005](../adr/0005-standards-aligned-data-model.md) (proposed). |
| Shipping and finding a buyer? | There is a real gap. Start with an **offline, by-port "ship it" resource**, then a **shareable catch notice**, and only later a network. Two rules shape it: most air cargo out of Alaska needs Known Shipper status set up a week ahead, and in Alaska only a direct marketer licence allows shipping out of state. |

## 1. The bulletin, re-read

### What was done

The PDF is a scan of two-page spreads with a hidden text layer. The first extraction read each line straight across both pages and guessed which species a row belonged to. It was re-read here from the page images, one printed page at a time, keeping every row under the heading and starting form it is printed under. Each row was then compared with the scan's own text layer.

- 24 printed pages, **581 rows in 80 tables**, plus the bulletin's 99 references. The data is in `research/mab37/` (`pages/` as transcribed, `mab37.json` and `mab37.csv` joined).
- **Every number agrees between the image reading and the text layer.** The text layer's errors are all in letters, not digits: `SIB` for `S/B`, `O/H` for `D/H`.
- 17 rows are flagged. None is a reading doubt. They are places where the bulletin itself looks wrong or needed interpreting (below).

### What is wrong in the app

Against the 655 conversions in `app/src/data/fish_data_v3.js`:

| | Rows |
|---|---:|
| Same starting form, product and numbers | 564 |
| Same, but spelled `SIB` where the bulletin prints `S/B` | 40 |
| Same, worded slightly differently | 19 |
| **Numbers differ** | 23 |
| **Right product and numbers, wrong starting form** | 7 |
| **In the app but not in that species' table** | 2 |
| **Printed in the bulletin, missing from the app** | 56 |

The ones that change a price:

- **Rougheye and Shortraker rockfish use the wrong table.** The bulletin prints two rockfish tables. These two species belong to the second, whose fillet yields are 4 to 8 points lower (round to skin-on fillet is 28%, not 32%). The app understates their cost.
- **Eight "salted" and "smoked" rows are under the wrong starting form.** The bulletin prints `Round → Smoked D/H-Off 57` for smelt; the app has `D/H-Off → Smoked 57`. So the app applies a whole-fish yield to a fish that has already been headed and gutted. The same slip affects Atka mackerel, sturgeon, trout and eels (seven rows), and Pacific cod has the smoked row twice, once correctly and once under `D/H-Off`.
- **Pacific hake has four wrong fillet yields** (54, 40, 34 and 74, where the bulletin prints 51, 38, 32 and 75), sablefish two (59 and 52 for 64 and 56), pollock two, trout one.
- **Six averages were invented.** For hake roe, sturgeon roe, shad roe, oysters and both sea urchins the bulletin prints only a range. The app shows a number in the middle as if it were measured.
- **Capelin has a row that belongs to Pacific cod** (belly flaps, 10%), carried across from the facing page.
- **56 printed rows are missing**, mostly `Round → D/H-Off (Eastern)` and `Skin-On Fillet → Skinless Fillet` for the rockfish, the crab "during molt" ranges, salmon trim grades and cooked salmon steaks.

A reviewer of this work compared three rows with a web copy of the *Pacific Seafood Recoveries and Yields* booklet and found different numbers (the head-off ranges for rex, rock and yellowfin sole, and trout round to skinless fillet at 65 where the bulletin has 55). The scan was checked again: the transcription matches the 2004 bulletin in all three places. So that booklet is not an exact reprint, and a difference between the two is a lead on a correction or an edition change, not a reading error here.

One earlier worry is settled: the 16 rockfish with identical tables are **faithful to the source**. The bulletin prints one table for three species and one for fourteen.

### Where the bulletin itself looks wrong

These are printed clearly and transcribed as printed. They need a second source before anyone relies on them:

- Sablefish, head-off to skinless fillet: **28%**. Its other rows imply about 51%.
- Pink shrimp, raw headless to cooked peeled: **69%**. The neighbouring rows imply about 47%; it is probably the raw-peeled figure.
- Chum salmon, head-off to "Salted D/H-Off" 47% and smoked sides 55%: every other salmon table has "Mild Cure Sides" in that position, and smoked sides equal to it.
- Pacific cod, head-off to skinless fillets: range **31–81**, above the skin-on range.
- Dogfish, round to viscera **51%**, beside a dressed yield of 75%.
- "Kurimi" at 48% for arrowtooth and yellowfin sole, probably *kirimi* (a headed, gutted, tail-off cut).

### What to do

Regenerate `fish_data_v3.js` from `mab37.json` with a script, so the app's reference yields are the bulletin's, row for row, with `S/B` spelled correctly, the missing rows added, no invented averages, and the flagged rows carrying a caution. That changes the price people see for 32 conversions (23 numbers, 9 moved to the right starting form or species), so it waits for the owner's go-ahead.

The bulletin is Alaska Sea Grant's copyright. Individual yields are facts, but the PDF and its text are still in `research/` without permission (audit, section 2.6). That is more pressing now that the transcription is cleaner than the original extraction.

## 2. Other datasets

### Already here

**EU conversion factors** (checked against the official EUR-Lex text, all 250; extracted to `research/sources/eu-2025-2196/`). Commission Implementing Regulation (EU) 2025/2196 replaced Regulation 404/2011 on 10 January 2026. Its Annexes XII to XIV give official live-weight factors by FAO species code and presentation code: **250 factors for 63 North-East Atlantic species**, 123 of them for a processed form. Yield is 100 divided by the factor. They are point values with no range.

Where the EU table and the bulletin cover the same species, they agree closely:

| Species | Form | EU | Bulletin |
|---|---|---:|---:|
| Albacore | gutted | 90.1% | 90% |
| Spiny dogfish | gutted | 74.1% | 75% |
| Greenland halibut | gutted | 92.6% | 90% |
| Greenland halibut | gutted and headed | 71.9% | 74% |

Only four species overlap, so the EU table extends the data to the Atlantic more than it corroborates the Pacific.

**US federal recovery rates** (checked; in `research/sources/us-50cfr679/`). 50 CFR Part 679, Table 3 gives a standard recovery rate for each Alaska groundfish group and product code: **162 rates for 23 species lines**, public domain. Table 1a defines the 39 product codes and Table 2a the 65 species codes. Table 3 is published only as page images, so it was read by eye, once; a second reading is still owed. Set beside the bulletin (`comparison-with-mab37.md`, 126 pairs):

- Where the bulletin prints a range, the federal rate falls inside it in 81 of 115 pairs. The two sources broadly agree on head-on and head-off yields.
- **The bulletin's plain `D/H-Off` matches the federal Western cut**, not the Eastern (cod 63 against 57 and 47; sablefish 68 against 68 and 63). That settles what an unqualified "head-off" means in the app.
- **The bulletin's fillet yields are consistently higher than the federal skinless, boneless rate** (pollock 34 against 21; soles 23 to 33 against 22). The federal product has skin and ribs removed. A chef pricing a fully trimmed fillet from the bulletin's "skinless fillet" number may be underestimating cost.
- Pollock mince (50 against 22) and skate wings (23 against 32) disagree badly and need a third source.
- The federal table has its own misprint: giant grenadier fillets at "24.3".

### Shortlist to bring in next (search only unless marked)

| # | Source | What it is | Licence | Fit |
|---|---|---|---|---|
| 1 | **Low et al. 1989 and Berger & Hare 1988** (NOAA technical memoranda) | A review of recovery rates for 70 species groups and 28 product forms, with observer-measured data. Both are in the bulletin's own reference list (checked), so they are probably part of its lineage. | NOAA authors; repository marks them public domain | Direct, but scanned PDFs that need the same careful transcription. |
| 2 | **Norway, "Norske omregningsfaktorer"** | Official factors, measured for the main species, with a public data feed. | Not confirmed | Good for North Atlantic species. |
| 3 | **New Zealand conversion factors notice** | Observer-based factors by species and landed state, with fine fillet detail. | Not confirmed | South Pacific species. |
| 4 | **USDA: SR Legacy refuse %, Table of Cooking Yields for Meat and Poultry, Food Buying Guide, Handbook 102** | Edible-portion and cooking yields for meat, poultry and produce. Handbook 102 is also in the bulletin's reference list (checked). | Public domain / CC0 | The path to chefs and to foods beyond fish. A second table shape: edible portion and cooking loss, not form to form. |
| 5 | **FAO Circular 847 and Technical Paper 309; DFO Atlantic factors** | Wide but old (1989–2000). | Pre-2024 FAO terms; Crown copyright | Cross-check and cite. Do not bulk-import. |

Ruled out: the Seafood Handbook, Book of Yields, Seafish, ASMI and AHDB guides (copyrighted or no yield tables found); FishBase (non-commercial licence); a "Pacific Seafood Recoveries and Yields" booklet that reprints the bulletin with some numbers changed (see section 1).

### What a multi-source dataset needs

Keep one row per source value and never overwrite one source with another. Each row carries its source, edition, licence, geography and method (regulatory standard, measured, or compiled from literature). Two cautions:

- **Regulatory factors are control standards, not measurements.** They are often conservative and have no range. Label them as such.
- **They only give round to product.** A yield from one processed form to another is a ratio of two standards and must be marked as derived.

## 3. Vocabulary: species and product forms

No existing ontology covers this app's product forms. The recommendation is to adopt the standard identifiers where they exist and keep our own small set of facets for the rest.

### Species (done)

Each table in the bulletin now has its **FAO ASFIS 3-alpha code** (the code the EU, NAFO and the seafood traceability standard use) and its **WoRMS AphiaID** (the taxonomic anchor), in `research/vocab/species.json`.

- 92 scientific names in 80 tables: **69 matched as printed, 13 after a correction, 10 not matched.**
- The 13 corrections are names that have changed since 2004 or that the bulletin misprints or misspells, each checked against the FAO list (12 in `research/vocab/corrections.json`, and one spelling fixed in the transcription). For example walleye pollock is now *Gadus chalcogrammus*, Dungeness crab *Metacarcinus magister*, and the bulletin puts thornyhead in the wrong genus.
- The 10 unmatched are genus-level entries ("*Acipenser* sp.") where FAO has no genus code. Picking one species would invent precision, so they stay unmatched.
- FishBase is **not** used: its data licence is non-commercial (search only), which conflicts with a tool for commercial fishers.

### Product forms (recommended; partly extracted)

| Layer | Use | State |
|---|---|---|
| **EU presentation and state codes** (`WHL` whole, `GUT` gutted, `GUH` gutted and headed, `FIL` fillet, `FIS` skinned fillet, `ROE`, `SUR`; states `FRE`, `FRO`, `SAL`…) | The international spine. The same list is used by NAFO, NEAFC and, in practice, the traceability standard. | Checked and extracted: 32 presentations, 6 states. |
| **Alaska product codes** (50 CFR 679 Table 1a; ADF&G fish tickets use the same numbers) | The closest match to the bulletin's words. It is the only list with Eastern and Western cut. | Checked and extracted: 39 codes with definitions. |
| **FoodOn** (open food ontology, CC BY 4.0) | Cross-reference layer for parts, states and processes, and the bridge to other foods later. | Checked; use a small extract, not the 40 MB file. |
| **Our own facets** | Part, head, viscera, skin, bones, cut style, method, preservation, heat. | Proposed in ADR 0005. |

Terms with no home in any standard, which is why facets are needed: Eastern and Western cut (Alaska only), pin-bone-out, V-cut and J-cut, hand versus machine, thawed as a starting state, trim grades, smoked sides, canned, shucked meats and crab sections.

One correction to common belief: `SKI` means "skinned", not a fillet. A skinned fillet is `FIS`.

## 4. An industry-standard schema, and GS1

### What "implementing GS1" would mean

| Level | What it is | Cost | Verdict |
|---|---|---|---|
| A. Compatible data model | Records shaped like the seafood traceability standard's events, using its terms. Our own identifiers. | Nothing. No membership. | **Do this.** |
| B. Accept a user's own identifiers | Optional GTIN, GLN and SSCC fields, checked for validity. A GS1 barcode string only when a GTIN is present. | Nothing for the app. For the fisherman, a single GTIN is reported as $30 one-time from GS1 US (search only). | Do when first asked. |
| C. Issue GS1 identifiers | The app hands out GS1 numbers. | Only GS1 member organisations can. | **Don't.** |

Why level A is right:

- **GS1's fishery data fields all hang off a GTIN** (checked against GS1's own syntax dictionary). Catch area, harvest date, species and gear are application identifiers 7005 to 7010, and each requires a product number. A one-boat business without a GTIN cannot produce a valid GS1 string at all.
- **The seafood traceability standard (GDST) expects this.** It defines its own identifier format for first-mile actors, noting that a GS1 company prefix is rare at that stage (checked in GDST's documentation).
- **The pieces are openly licensed** (checked): GS1's web vocabulary and syntax tools are Apache-2.0; GDST's documentation and schema are MIT.
- **A processing step in that standard is a yield record.** It is a transformation event with an input quantity and an output quantity. Yield is output divided by input. So what the calculator already models is the standard's own shape.

Two honest limits:

- **A small boat may not be fully valid against GDST's schema** (search only; version 1.2 was the one read about). Its fishing event has fields for an IMO vessel number and satellite-tracking details. GDST's guidance is reported to make these conditional: an IMO number only if the vessel has one, and a data element only when the information exists. Read the conditional rules in the published version before deciding what to export. Until then aim for "GDST-shaped", not "GDST-valid", and do not claim "GDST-capable", which requires passing its test.
- **Do not use the GS1 name or logo in branding.** "Works with GS1 identifiers" is the safe wording.

The proposed shapes for a yield observation, a lot, an offer and a shipment are in [ADR 0005](../adr/0005-standards-aligned-data-model.md).

### The regulation behind it

The FDA Food Traceability Rule covers essentially all finfish, crustaceans and bivalves. For a direct marketer (search only; confirm before relying on it):

- The fishing vessel's owner or operator is exempt for food produced on the vessel.
- The **first land-based receiver** must keep the harvest dates, harvest locations and landing date, and assigns the traceability lot code.
- Small retail food establishments and restaurants are exempt at or under $250,000 a year.
- Compliance was moved toward **20 July 2028**; a final extension rule was not confirmed.

The practical consequence is a useful feature: a one-page **landing record** generated from a lot, which gives the buyer exactly what they must keep.

## 5. Shipping a catch and finding a buyer

### What exists (search only)

- **Air cargo is how fresh Alaska fish moves**, and Alaska Air Cargo is the default carrier. Booking is by portal, email or phone. Parcel services (FedEx, UPS) suit boxed frozen product from road-system towns.
- **The trap for a first shipment is paperwork.** Cargo that travels on a passenger flight requires **Known Shipper** status, which for an individual takes a site visit and at least seven days. Someone on their way in with fish cannot get it that afternoon. Alaska Air Cargo is reported to exempt shipments that stay within Alaska or travel only on freighter flights, so the checklist has to ask where the fish is going and on what kind of flight before it warns anyone off.
- **Permits decide what is legal.** In Alaska a catcher-seller may sell their own unprocessed catch dockside but may not ship it out of state. A direct marketer licence allows that. Filleting or freezing counts as processing and needs a state permit and a HACCP plan.
- **Shipping rate services** (Shippo, EasyPost) can quote parcel rates cheaply. None models air cargo. Buying labels through the app's own account would make the app a party to the shipment; showing quotes does not.
- **Buyer-finding tools exist but are thin.** FishLine lists dockside sales to the public. The Local Catch Network's Seafood Finder lists sellers. Neither answers a fisherman's question on the way in.
- **Good guides already exist.** The Sea Grant *Seafood Direct Marketing Manual* (6th edition, 2024) covers permits, packaging and shipping. Link to it; do not rewrite it.
- **Why earlier marketplaces struggled:** trust, quality assurance, logistics and payment. One distributor was undone by a provenance scandal. Provenance claims are the liability.

**The gap:** nothing answers "what leaves this port today, what do I need set up, and who do I tell", offline and by port.

### A staged way in

| Stage | What it is | Needs | Risk | What would prove demand |
|---|---|---|---|---|
| **A. A resource** | An offline "ship it" checklist (which permit, Known Shipper lead time, packaging, booking cut-offs) and a by-port directory of cargo stations, carriers, box suppliers, custom processors and buyers. Every entry has a "last verified" date. | No accounts. Content, kept current through the same review flow as community yields. | Stale phone numbers; reading as legal advice. | Views by port, corrections sent in, people asking for their port. |
| **B. A catch notice** | "800 lb of sockeye, gutted, landing Sitka Thursday 4 pm" becomes a shareable message, link or QR code the fisherman sends to their own buyers, with a rough shipping estimate from published rate sheets. Built on the lot shape in ADR 0005, so it is already in the standard's form. | No accounts, no payments. | An estimate taken as a quote; a notice implying a sale the permit does not allow. | Notices made and shared, repeat use, buyers asking how to receive them. |
| **C. A network** | Opt-in buyer lists, notifications, live parcel quotes. | A backend, moderation, spam control. | Brokering, payments and label purchase bring liability and possibly licensing. | Only after B shows repeat use and a partner is interested. |

Two design rules follow from the research. **Ask which permit the person holds first**, because it decides what the app may suggest. **Lead with the Known Shipper question** (is it needed for this route, and is it set up?), because it is what defeats a last-minute first shipment.

### Where it lives

ADR 0003 scoped this app to the calculator and said inventory belongs in a separate tool. Stage A fits inside the app as a fifth destination ("Ship it") without breaking that decision's spirit: it is a resource, it works offline, and it needs no accounts. Stages B and C introduce lots and offers, which is the inventory ADR 0003 kept out. That is the owner's call, and it should be a new ADR.

## 6. Decisions for the owner

1. **Correct the app's reference yields from the re-read bulletin?** 32 conversions change (23 numbers, 9 moved), 40 are respelled and 56 are added. Every change is listed in `comparison.md`.
2. **Adopt ADR 0005** (the standards-aligned data model) as the shape for the Firestore work and for any dataset release?
3. **Shipping and buyers:** start Stage A in this app? Which ports and fisheries first? Are the first users catcher-sellers or licensed direct marketers? Fresh by air, or frozen by parcel?
4. **Permission from Alaska Sea Grant** for the bulletin, and whether to ask them, NOAA or a Sea Grant agent to review the flagged values.
5. **A partner to verify directory entries** (Alaska Sea Grant, ASMI, a fishermen's association, the Local Catch Network).

## 7. What is and is not verified

**Checked here:**
- The bulletin transcription (image reading against the scan's text layer, 581 rows).
- The comparison with the app's data.
- The species codes (against the FAO list as published on GitHub by the FAO/FIRMS working group; that repository has no licence file, so cite FAO).
- The EU presentation codes and conversion factors (extracted from a Markdown copy on GitHub, then checked against the official EUR-Lex HTML: all 250 factors and 32 codes match).
- The Alaska product codes, species codes and recovery rates (50 CFR Part 679 Tables 1a, 2a and 3, from the eCFR and the printed 2024 edition; Table 3 read once by eye).
- The GS1 syntax dictionary and web vocabulary, GDST's documentation and schema, and FoodOn's licence.

**Search only, to verify before relying on it:**
- GS1 US prices; GDST 2.0, which was due in September 2026 and may have changed names in the standard.
- The FDA traceability rule's compliance date and the first-receiver question for someone who sells their own catch.
- Every carrier fact, rate and cut-off; the permit rules in each state.
- Licences for the Norwegian, New Zealand and Canadian tables.

**Hosts.** The owner has since allowed `www.ecfr.gov`, `www.govinfo.gov`, `eur-lex.europa.eu`, `www.fisheries.noaa.gov`, `repository.library.noaa.gov`, `www.fao.org`, `api.fiskeridir.no`, `fdc.nal.usda.gov` and `www.marinespecies.org`; the first three have been used. The eCFR refuses automated requests for its table images, so those came from the printed edition on govinfo. Still blocked, and needed for the remaining leads: `ref.gs1.org`, `thegdst.org`, `www.fda.gov`, and the carrier and state agency sites.
