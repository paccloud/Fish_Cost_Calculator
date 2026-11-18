# Corrections to the app's reference yields, November 2026

What changed when `app/src/data/fish_data_v3.js` stopped being a hand-kept copy and became `mab37_yields.js`, generated from the bulletin as re-read (`mab37.json`). "Before" is the app's data up to this change. "After" is what the bulletin prints. Row ids point into `mab37.json`: `p09R-21` is PDF page 9, right-hand printed page, row 21.

| | Rows |
|---|---:|
| Unchanged | 564 |
| Numbers corrected | 23 |
| Moved to the starting form the bulletin prints | 7 |
| Removed | 2 |
| Added | 56 |
| Renamed to the bulletin's wording, numbers unchanged | 59 |

## Numbers corrected

| Species | Before | After | Row |
|---|---|---|---|
| Walleye Pollock | Round → Roe: 7 (3–20) | Round → Roe: 6.5 (3–20) | `p08R-17` |
| Walleye Pollock | Trim → Mince: 87 | Trim → Mince: 90 | `p08R-21` |
| Pacific Hake | Round → Roe: 5 (2–8) | Round → Roe: no average (2–8) | `p07L-16` |
| Pacific Hake | D/H-On → Skin-On Fillets: 54 | D/H-On → Skin-On Fillets: 51 | `p07L-18` |
| Pacific Hake | D/H-On → Skinless Fillets: 40 | D/H-On → Skinless Fillets: 38 | `p07L-19` |
| Pacific Hake | D/H-On → SIB Fillets: 34 | D/H-On → S/B Fillets: 32 | `p07L-20` |
| Pacific Hake | Skin-On Fillets → Skinless Fillets: 74 | Skin-On Fillets → Skinless Fillets: 75 | `p07L-21` |
| Rougheye Rockfish | Round → Skin-On Fillet: 32 (30–36) | Round → Skin-On Fillet: 28 (25–35) | `p09L-13` |
| Rougheye Rockfish | Round → Skinless Fillet: 27 (25–33) | Round → Skinless Fillet: 23 (21–30) | `p09L-14` |
| Rougheye Rockfish | D/H-On → Skin-On Fillet: 56 | D/H-On → Skin-On Fillet: 49 | `p09L-17` |
| Rougheye Rockfish | D/H-On → Skinless Fillet: 48 | D/H-On → Skinless Fillet: 40 | `p09L-18` |
| Shortraker Rockfish | Round → Skin-On Fillet: 32 (30–36) | Round → Skin-On Fillet: 28 (25–35) | `p09L-13` |
| Shortraker Rockfish | Round → Skinless Fillet: 27 (25–33) | Round → Skinless Fillet: 23 (21–30) | `p09L-14` |
| Shortraker Rockfish | D/H-On → Skin-On Fillet: 56 | D/H-On → Skin-On Fillet: 49 | `p09L-17` |
| Shortraker Rockfish | D/H-On → Skinless Fillet: 48 | D/H-On → Skinless Fillet: 40 | `p09L-18` |
| Sablefish | D/H-Off (Eastern) → Skinless Fillet: 52 | D/H-Off (Eastern) → Skinless Fillet: 56 | `p09R-13` |
| Sablefish | D/H-Off (Eastern) → Skin-On Fillet: 59 | D/H-Off (Eastern) → Skin-On Fillets: 64 | `p09R-12` |
| Sturgeon | Round → Roe: 10 (8–12) | Round → Roe: no average (8–12) | `p16L-08` |
| Trout | D/H-Off → Skinless Fillet: 80 | D/H-Off → Skinless Fillet: 79 | `p16L-24` |
| American Shad | Round → Roe: 10 (3–17) | Round → Roe: no average (3–17) | `p13R-07` |
| Oysters | Raw Whole → Raw Meats: 10 (5–14) | Raw Whole → Raw Meats: no average (5–14) | `p08L-21` |
| Sea Urchin (Green) | Round → Roe: 17 (5–30) | Round → Roe: no average (5–30) | `p13R-01` |
| Sea Urchin (Red) | Round → Roe: 19 (8–30) | Round → Roe: no average (8–30) | `p13R-02` |

Where "After" says "no average", the bulletin prints only a range and the old figure was made up. The calculator now asks for a yield within the range.

## Moved to the starting form the bulletin prints

The old rows applied a whole-fish yield to a fish already headed and gutted.

| Species | Before | After | Row |
|---|---|---|---|
| Atka Mackerel | D/H-Off → Salted: 41 | Round → Salted D/H-Off: 41 | `p08L-14` |
| Smelt | D/H-Off → Salted: 45 | Round → Salted D/H-Off: 45 | `p15L-07` |
| Smelt | D/H-Off → Smoked: 57 | Round → Smoked D/H-Off: 57 | `p15L-08` |
| Sturgeon | D/H-Off → Salted: 46 | Round → Salted D/H-Off: 46 | `p16L-06` |
| Sturgeon | D/H-Off → Smoked: 56 | Round → Smoked D/H-Off: 56 | `p16L-07` |
| Trout | D/H-Off → Smoked: 54 | Round → Smoked D/H-Off: 54 | `p16L-18` |
| Eels | D/H-Off → Smoked: 65 | Round → Smoked D/H-Off: 65 | `p06R-23` |

## Removed

| Species | Row removed |
|---|---|
| Pacific Cod | D/H-Off → Smoked: 58 (50–65) |
| Capelin | Round → Belly Flaps: 10 |

The Pacific cod row duplicated `Round → Smoked D/H-Off`, which stays. The capelin row belongs to Pacific cod, on the facing page, where it already was.

## Added

| Species | Row | Id |
|---|---|---|
| Chinook Salmon | Raw Steak → Baked Steak: 89 | `p12L-25` |
| Chinook Salmon | Raw Steak → Broiled Steak: 83 | `p12L-26` |
| Walleye Pollock | Skin-On Fillets → Trim: 15 | `p08R-19` |
| Walleye Pollock | Skin-On Fillets → S/B Fillets: 70 | `p08R-20` |
| Pacific Hake | D/H-On → D/H-Off: 71 | `p07L-17` |
| Pacific Hake | Skin-On Fillets → Trim: 12 | `p07L-22` |
| Pacific Hake | Trim → Mince: 90 | `p07L-24` |
| Black Rockfish | Skin-On Fillet → Skinless Fillet: 85 | `p09L-06` |
| Greenstriped Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-03` |
| Greenstriped Rockfish | Skin-On Fillet → Skinless Fillet: 85 | `p09L-06` |
| Thornyhead Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-03` |
| Thornyhead Rockfish | Skin-On Fillet → Skinless Fillet: 85 | `p09L-06` |
| Canary Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Canary Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| China Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| China Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Dusky Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Dusky Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Quillback Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Quillback Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Redbanded Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Redbanded Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Rougheye Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Rougheye Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Shortraker Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Shortraker Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Silvergray Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Silvergray Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Tiger Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Tiger Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Widow Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Widow Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Yelloweye Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Yelloweye Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Yellowtail Rockfish | Round → D/H-Off (Eastern): 50 | `p09L-12` |
| Yellowtail Rockfish | Skin-On Fillet → Skinless Fillet: 82 | `p09L-15` |
| Spiny Dogfish | Round → Viscera: 51 | `p06R-16` |
| Spiny Dogfish | D/H-On → Backs: 38 | `p06R-18` |
| Spiny Dogfish | D/H-On → Belly Flaps: 7 | `p06R-19` |
| Sablefish | Round → Salted D/H-Off: 45 | `p09R-07` |
| Sablefish | Round → Smoked Sides: 31 (27–35) | `p09R-08` |
| Sablefish | D/H-Off → Skinless Fillet: 28 | `p09R-10` |
| Sablefish | D/H-Off (Eastern) → Smoked Sides: 50 (45–52) | `p09R-14` |
| Pacific Herring | Round → Salted Gibbed: 65 | `p07R-19` |
| Pacific Herring | Round → Pickled D/H-On: 74 | `p07R-23` |
| Pacific Herring | Skin-On Fillets → Salted Fillets: 85 | `p07R-24` |
| Pacific Herring | Skin-On Fillets → Pickled: 90 | `p07R-25` |
| Smelt | Round → Cooked Fillet: 35 | `p15L-09` |
| Sturgeon | D/H-On → Steaks: 73 | `p16L-12` |
| Trout | D/H-On → Steaks: 68 | `p16L-22` |
| Trout | D/H-Off → Steaks: 86 | `p16L-25` |
| Dungeness Crab | Raw Whole → Cooked Meat (during molt): no average (13–14) | `p06L-05` |
| King Crab (Red/Brown/Golden) | Raw Whole → Cooked Meat (during molt): no average (16–19) | `p06L-13` |
| Blue King Crab | Raw Whole → Cooked Meat (during molt): no average (13–14) | `p06L-21` |
| Tanner Crab | Raw Whole → Cooked Meat (during molt): no average (10–14) | `p06R-05` |
| Razor Clams | Raw Meat → Cooked Meat: 60 | `p05L-15` |

## Renamed

| Species | Before | After |
|---|---|---|
| Pink Salmon | Round → SIB Fillet (Pinboning) | Round → S/B Fillet (Pinboning) |
| Pink Salmon | Round → SIB Trim | Round → S/B Trim |
| Pink Salmon | D/H-On → SIB Fillet (Pinboning) | D/H-On → S/B Fillet (Pinboning) |
| Pink Salmon | D/H-On → SIB Trim | D/H-On → S/B Trim |
| Pink Salmon | D/H-Off → SIB Fillet (Pinboning) | D/H-Off → S/B Fillet (Pinboning) |
| Pink Salmon | D/H-Off → SIB Trim | D/H-Off → S/B Trim |
| Pink Salmon | Round → SIB Fillet (V-Cut) | Round → S/B Fillet (Hand-V-Cut) |
| Pink Salmon | D/H-On → SIB Fillet (V-Cut) | D/H-On → S/B Fillet (Hand-V-Cut) |
| Pink Salmon | D/H-Off → SIB Fillet (V-Cut) | D/H-Off → S/B Fillet (Hand-V-Cut) |
| Chum Salmon | Round → SIB Fillet (Pinboning) | Round → S/B Fillet (Pinboning) |
| Chum Salmon | Round → SIB Trim | Round → S/B Trim |
| Chum Salmon | D/H-On → SIB Fillet (Pinboning) | D/H-On → S/B Fillet (Pinboning) |
| Chum Salmon | D/H-On → SIB Trim | D/H-On → S/B Trim |
| Chum Salmon | D/H-Off → SIB Fillet (Pinboning) | D/H-Off → S/B Fillet (Pinboning) |
| Chum Salmon | D/H-Off → SIB Trim | D/H-Off → S/B Trim |
| Chum Salmon | Round → SIB Fillet (V-Cut) | Round → S/B Fillet (Hand-V-Cut) |
| Chum Salmon | D/H-On → SIB Fillet (V-Cut) | D/H-On → S/B Fillet (Hand-V-Cut) |
| Chum Salmon | D/H-Off → SIB Fillet (V-Cut) | D/H-Off → S/B Fillet (Hand-V-Cut) |
| Sockeye Salmon | Round → SIB Fillet (Pinboning) | Round → S/B Fillet (Pinboning) |
| Sockeye Salmon | Round → SIB Trim | Round → S/B Trim |
| Sockeye Salmon | D/H-On → SIB Fillet (Pinboning) | D/H-On → S/B Fillet (Pinboning) |
| Sockeye Salmon | D/H-On → SIB Trim | D/H-On → S/B Trim |
| Sockeye Salmon | D/H-Off → SIB Fillet (Pinboning) | D/H-Off → S/B Fillet (Pinboning) |
| Sockeye Salmon | D/H-Off → SIB Trim | D/H-Off → S/B Trim |
| Sockeye Salmon | Round → SIB Fillet (V-Cut) | Round → S/B Fillet (Hand-V-Cut) |
| Sockeye Salmon | D/H-On → SIB Fillet (V-Cut) | D/H-On → S/B Fillet (Hand-V-Cut) |
| Sockeye Salmon | D/H-Off → SIB Fillet (V-Cut) | D/H-Off → S/B Fillet (Hand-V-Cut) |
| Coho Salmon | Round → SIB Fillet (Pinboning) | Round → S/B Fillet (Pinboning) |
| Coho Salmon | Round → SIB Trim | Round → S/B Trim |
| Coho Salmon | D/H-On → SIB Fillet (Pinboning) | D/H-On → S/B Fillet (Pinboning) |
| Coho Salmon | D/H-On → SIB Trim | D/H-On → S/B Trim |
| Coho Salmon | D/H-Off → SIB Fillet (Pinboning) | D/H-Off → S/B Fillet (Pinboning) |
| Coho Salmon | D/H-Off → SIB Trim | D/H-Off → S/B Trim |
| Coho Salmon | Round → SIB Fillet (V-Cut) | Round → S/B Fillet (Hand-V-Cut) |
| Coho Salmon | D/H-On → SIB Fillet (V-Cut) | D/H-On → S/B Fillet (Hand-V-Cut) |
| Coho Salmon | D/H-Off → SIB Fillet (V-Cut) | D/H-Off → S/B Fillet (Hand-V-Cut) |
| Chinook Salmon | Round → SIB Fillet (Pinboning) | Round → S/B Fillet (Pinboning) |
| Chinook Salmon | Round → SIB Trim | Round → S/B Trim |
| Chinook Salmon | D/H-On → SIB Fillet (Pinboning) | D/H-On → S/B Fillet (Pinboning) |
| Chinook Salmon | D/H-On → SIB Trim | D/H-On → S/B Trim |
| Chinook Salmon | D/H-Off → SIB Fillet (Pinboning) | D/H-Off → S/B Fillet (Pinboning) |
| Chinook Salmon | D/H-Off → SIB Trim | D/H-Off → S/B Trim |
| Chinook Salmon | Round → SIB Fillet (V-Cut) | Round → S/B Fillet (Hand-V-Cut) |
| Chinook Salmon | D/H-On → SIB Fillet (V-Cut) | D/H-On → S/B Fillet (Hand-V-Cut) |
| Chinook Salmon | D/H-Off → SIB Fillet (V-Cut) | D/H-Off → S/B Fillet (Hand-V-Cut) |
| Pacific Cod | Round → SIB Fillets (V-cut) | Round → S/B Fillets (V-cut) |
| Pacific Cod | Round → SIB Fillets (J-cut) | Round → S/B Fillets (J-cut) |
| Pacific Cod | D/H-On → SIB Fillets | D/H-On → S/B Fillets |
| Pacific Cod | D/H-Off → SIB Fillets | D/H-Off → S/B Fillets |
| Pacific Cod | Skin-On Fillets → SIB Fillets | Skin-On Fillets → S/B Fillets |
| Pacific Cod | Skinless Fillets → SIB Fillets | Skinless Fillets → S/B Fillets |
| Walleye Pollock | Round → SIB Fillets | Round → S/B Fillets |
| Walleye Pollock | Round → Surimi (Traditional) | Round → Surimi (Traditional Process) |
| Walleye Pollock | Round → Surimi (Decanter) | Round → Surimi (Decanter Process) |
| Pacific Hake | Round → SIB Fillets | Round → S/B Fillets |
| Pacific Hake | Skin-On Fillets → SIB Fillets | Skin-On Fillets → S/B Fillets |
| Pacific Hake | Round → Surimi (Decanter) | Round → Surimi (Decanter Process) |
| Arrowtooth Flounder | Round → SIB fillets | Round → S/B fillets |
| Lingcod | D/H-Off → Skinless Fillet | D/H-Off → Skinless Fillets |
