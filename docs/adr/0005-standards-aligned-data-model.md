---
status: proposed
---

# Yields, lots and offers follow the seafood traceability standard's shape; GS1 numbers are optional

Not yet accepted. It is written for the owner to accept, change or reject. The
evidence is in `docs/reviews/2026-11-data-and-standards.md`.

Every record the app stores or publishes uses identifiers from open standards
where one exists, and is shaped so it can be exported as an event in the
seafood traceability standard (GDST, which is built on GS1's EPCIS 2.0). The
app keeps its own identifiers. It accepts a person's own GS1 numbers but never
issues or requires them.

## Why

- A conversion with a yield is already what the standard calls a transformation
  event: an input quantity, an output quantity, and yield as the ratio.
- GS1's fishery fields (catch area, harvest date, species, gear) all require a
  product number (GTIN). Most one-boat businesses have none. GDST defines its
  own identifier format for exactly that case.
- The vocabularies and schemas involved are openly licensed (GS1 web vocabulary
  and syntax tools: Apache-2.0; GDST documentation: MIT). Being compatible costs
  nothing and needs no membership. Issuing GS1 numbers is something only GS1
  member organisations can do.

## Identifiers

| Thing | Identifier | Notes |
|---|---|---|
| Species | FAO ASFIS 3-alpha code, with the WoRMS AphiaID | `research/vocab/species.json`. Local names stay as labels. A genus-level entry with no FAO code keeps the app's own id. |
| Starting form and product | The app's own form id, described by facets and mapped to an EU presentation code and state code, and to an Alaska product code where one exists | `research/sources/eu-2025-2196/`. Facets: part, head, viscera, skin, bones, cut style, method, preservation, heat. |
| Units | UN/ECE Recommendation 20 codes (`LBR`, `KGM`) | What EPCIS uses. |
| Place | UN/LOCODE for ports; FAO major fishing area for catch area | A GLN only if the person has one. |
| Everything the app creates | The app's own opaque id | Never a made-up GS1 number. |

## Shapes

One row per source value. A value from one source is never overwritten by
another.

```jsonc
// A yield: reference, custom or community
{
  "id": "yld_…",
  "species": { "asfis": "PIN", "aphiaId": 127182, "label": "Pink salmon" },
  "from": { "form": "round", "presentation": "WHL", "state": "FRE" },
  "to": { "form": "skinless-fillet", "presentation": "FIS", "state": "FRE" },
  "yieldPct": 42,
  "range": [41, 46],                 // null when the source gives none
  "basis": "compiled",               // compiled | measured | regulatory | derived
  "source": { "id": "mab37-2004", "row": "p09R-21", "licence": "…" },
  "check": null                      // a caution shown beside the value
}

// A lot: fish a person has or expects (stage B of the shipping work; needs its own ADR)
{
  "id": "lot_…",
  "species": { "asfis": "SOC", "label": "Sockeye salmon" },
  "form": { "form": "dressed-head-on", "presentation": "GUT", "state": "FRE" },
  "quantity": { "value": 800, "unit": "LBR" },
  "harvest": { "from": "2026-07-14", "to": "2026-07-16", "faoArea": "67", "gear": "GNS" },
  "landing": { "port": "USSIT", "at": "2026-07-17T16:00:00-08:00" },
  "gtin": null, "gln": null          // the person's own, checked for a valid check digit
}

// An offer: a lot, a price and how long it stands
{ "id": "off_…", "lot": "lot_…", "price": { "amount": 6.5, "currency": "USD", "per": "LBR" }, "validUntil": "…" }

// A shipment: a lot, a carrier and a route
{ "id": "shp_…", "lot": "lot_…", "from": "USSIT", "to": "USSEA", "carrier": "…", "sscc": null }
```

A yield with a measured input and output weight exports as an EPCIS
`TransformationEvent`. A lot exports as the standard's landing record.

## Consequences

- The Firestore work (issues #123 to #133) stores species and forms by these
  identifiers from the start. Changing identifiers after people have saved data
  is far more expensive than choosing them now.
- The community dataset (ADR 0004) is published with these identifiers, so other
  tools can join it to FAO, EU and NOAA data without a lookup table of ours.
- Reference yields gain a `basis` and a `source`. Regulatory factors are labelled
  as standards, not measurements, and a form-to-form yield computed from two of
  them is labelled derived.
- The app describes itself as "works with GS1 identifiers" and "shaped like
  GDST". It does not claim to be GDST-capable, which needs GDST's own test, and
  does not use GS1's name or logo as a badge. A small boat cannot satisfy every
  field GDST requires (it asks for an IMO number and vessel-tracking details).
- Lots, offers and shipments are inventory, which ADR 0003 keeps out of this app.
  Adopting this record fixes only their shape. Whether they are built here or in
  a separate tool is a separate decision.
- GDST 2.0 was due in late 2026 and may rename fields. Check the published
  version before writing an exporter.
