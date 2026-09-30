# perq — Production Place-Data Strategy

Decision record for how perq obtains and persistently stores **real** business/place data,
and how that data relates to the map provider and to perq's own discount/community/evidence
data. Investigated 2026-09-29. Does not change the working PostGIS POC.

## TL;DR recommendation

**Persist real place records from Overture Maps (Places theme, CDLA Permissive 2.0) into our
own PostGIS database as the canonical source of perq places. Use Mapbox purely for the
visual map (tiles/rendering) and, if needed, temporary search/autocomplete — never as a
store of persistent place data.**

This cleanly separates concerns:
- **Map rendering / live search** — Mapbox (temporary use only; nothing persisted).
- **Canonical persistent places** — Overture-derived rows in our PostGIS `businesses` table.
- **perq-specific data** — our discounts, evidence, community reports; entirely ours.

Two providers, by design, and you already said that's fine.

## Why not just store Mapbox data

Mapbox's default (temporary) geocoding/search **forbids persisting** results; permanent
storage requires `permanent=true` (higher per-request cost) and is still bound to Mapbox's
terms/pricing over time. Building our canonical place store on Mapbox would create cost and
vendor-lock-in exactly where we want durability and independence. Mapbox is excellent for
what it's genuinely best at — rendering the map — so we keep it there.

## The comparison

| Criterion | OpenStreetMap (ODbL) | **Overture Places (CDLA Perm. 2.0)** | Mapbox permanent geocoding |
|---|---|---|---|
| Persist name/coords/address/category in our DB | Yes | **Yes** | Yes (paid, `permanent=true`) |
| License type | **Share-alike** (ODbL) | **Permissive**, no share-alike | Commercial ToS |
| Share-alike / copyleft risk to our DB | Yes — "Produced Work"/derivative-database obligations can attach | **None** (CDLA §3 "No Restrictions on Results") | None (but proprietary) |
| Obligation when *we* share the data | Attribution + keep derivative DB under ODbL | **Include CDLA text with the Data** (§2.1); no share-alike | Per Mapbox ToS |
| UI attribution required | Effectively yes ("© OpenStreetMap contributors") | **Not mandated** as UI credit; attribution is good practice, obligation is to ship license text with data | Mapbox attribution required on the map |
| Combine legally w/ our discount/community/evidence data | Yes, but derivative-DB/share-alike questions muddy it | **Yes, cleanly** (§3 results unencumbered) | Yes, under ToS |
| Keep PostGIS as canonical source | Yes | **Yes** | Weak — Mapbox is the source of truth |
| Seattle coverage | Excellent | **Excellent** (Meta/Microsoft/Foursquare-sourced) | Excellent |
| Prague coverage | Very good | **Very good** | Very good |
| POI/business data quality | Good, uneven categories | **Good, normalized categories + stable GERS IDs** | High |
| Search / autocomplete UX | DIY (Nominatim/Photon) or self-host | DIY on our data, or pair w/ Mapbox temporary search | **Best turnkey** |
| Dev complexity | Medium (extracts, ODbL care) | **Medium** (download parquet, filter bbox, load) | Low (API calls) |
| Cost | Free | **Free** (data); compute to process only | Per-request, higher for permanent |
| Vendor lock-in | Low | **Low** | High |

### On OSM specifically (the honest nuance)
OSM data is great and free, but ODbL is **share-alike**. If our stored places are deemed a
"Derivative Database," we can face obligations to license that database under ODbL and to
attribute prominently. There are reasonable interpretations where perq stays a "Produced
Work" and only owes attribution — but the ambiguity is exactly the kind of legal surface a
solo hackathon should avoid when a cleaner option exists. Notably, **Overture's Places theme
is CDLA Permissive precisely because it is conflated from permissively-licensed commercial
sources (Meta, Microsoft, Foursquare), not from OSM** — so choosing Overture Places sidesteps
ODbL entirely. (Overture's *other* themes, e.g. buildings, can be ODbL — we only need
Places.)

### Why Overture wins for perq
- **Permissive license** removes share-alike risk to our database and to combining place data
  with our discount/evidence/community data (CDLA §3.1: no restrictions on Results).
- **Only obligation** is shipping the CDLA license text when we redistribute the data — which
  we are not doing (we serve our own app, not a data dump). We will still add a courteous
  "Places data © Overture Maps contributors" credit; it is cheap goodwill, not a hard blocker.
- **Canonical PostGIS**: we import once, own the rows, assign our own IDs (optionally keep the
  Overture **GERS** ID for future re-syncs), and never depend on a live third-party call to
  display a place.
- **Coverage + quality** are strong in both hero cities, with normalized categories that map
  well onto perq's category enum.

## Attribution plan (practical)
- Map view: keep Mapbox's required attribution (automatic with the SDK).
- Places: add a small "Places data © Overture Maps" line in the app's about/credits and,
  optionally, footer. Include the CDLA text in the repo (e.g., `LICENSES/`).
- This satisfies both providers without per-marker clutter.

## The three data tiers (must stay distinct)

1. **Synthetic test fixtures** — fabricated points (the POC's `[SYN]` rows and test
   fixtures). Development/CI only. **Never** shown as production or demo data.
   Location: `prisma/seed/synthetic.ts` and test setup.
2. **Imported real place/business records** — Overture-derived rows: name, coordinates,
   address, category, `country`, plus provenance (`source = OVERTURE`, optional
   `externalPlaceId = GERS id`, `importedAt`). Canonical, stored in our PostGIS. This is what
   users see as "places."
   Location (future): `prisma/seed/demo.ts` / an import script `scripts/import-overture.ts`.
3. **perq-specific data** — discounts, evidence, community reports, verification state.
   Entirely ours; governed by our verification rules; may reference a place by our internal
   business id. Never sourced from a map provider.

Schema note for the foundation spec: add a `source` enum value `OVERTURE` and keep
`externalPlaceId` to store the GERS id, so we can re-sync/refresh place attributes later
without touching perq-specific data.

## Ingestion approach (future spec — not now)
- One-time (or periodic) **bounded import**: download the Overture Places release (GeoParquet)
  for the Seattle and Prague bounding boxes, filter to relevant categories, transform to our
  `businesses` shape, load via parameterized inserts (same pattern as the POC seed).
- Tools: DuckDB (with spatial + the Overture extension) or the `overturemaps` Python CLI to
  extract a bbox to parquet/GeoJSON, then a small loader script. No live crawling; no SSRF
  surface.
- Keep GERS ids to enable future refresh. Real discounts/evidence are added on top per our
  verification rules (community quorum or official evidence) — the place import never creates
  a publicly visible discount by itself.

## What we will do when we agree
Replace the POC's synthetic rows with a **small, real** Seattle + Prague place set imported
from Overture (kept in the tier-2 demo seed), while the `[SYN]` fixtures remain for tests.
Then attach a few **real, evidence-backed** discounts per perq's verification rules for the
demo. All of this is Phase 1+ work; the POC stays as-is for now.

## Sources
- Overture Places license (CDLA Permissive 2.0): docs.overturemaps.org/guides/places.
- CDLA Permissive 2.0 text (§2.1 share condition, §3.1 no restrictions on Results): cdla.dev.
- OSM ODbL attribution/share-alike: osmfoundation.org licence guidelines; openstreetmap.org/copyright.
- Mapbox temporary vs permanent geocoding: docs.mapbox.com (see DEV_LOG entry).
Content rephrased/summarized for compliance with licensing restrictions.
