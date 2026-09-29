# perq — Development Log (Kiro usage)

A lightweight, running record of meaningful Kiro usage for the hackathon submission and the
Builder Center writeup. Keep entries concrete: which Spec drove which feature, which
Steering decision shaped code, which Hook caught a real issue, what architecture changed
because of a Kiro conversation.

## Format

```
### YYYY-MM-DD — short title
- Context: what we were doing
- Kiro artifact: spec / steering / hook / mcp / chat
- Concrete outcome: what it produced or caught
```

## Entries

### 2026-09-29 — Design conversation and scaffolding
- Context: designing perq end-to-end before writing implementation code.
- Kiro artifact: chat (architecture review) + Steering + first Spec.
- Concrete outcome:
  - Created 7 Steering files (`product-principles`, `architecture`, `security`,
    `ai-and-evidence`, `testing`, `coding-standards`, `kiro-workflow`). The
    `ai-and-evidence` invariant — "An AI-generated claim is never sufficient evidence by
    itself for publicly displaying a student discount" — is now always in context.
  - Kiro challenged scope: cut autonomous AI discovery to a single human-gated Bedrock
    extraction endpoint; reduced four hero cities to two (Seattle + Prague) for real seed
    data; dropped a redundant `PENDING_COMMUNITY_VERIFICATION` state.
  - Recommended **RDS PostgreSQL over Aurora** (no scale/HA need; simpler, cheaper;
    identical PostGIS support) and **Cognito** for auth (email verification supports
    community-verification integrity).
  - Defined a deterministic conflict-detection threshold (3 unique, agreeing, more-recent
    contradicting reports in a 90-day window -> NEEDS_REVERIFICATION) and recorded it in
    `testing` steering and the foundation spec.
  - Created the `foundation-and-data-model` Spec (requirements/design/tasks). Task 2 is a
    PostGIS proof-of-concept to validate the riskiest assumption before further build.

### 2026-09-29 — Mapbox place-data storage terms (POC Task 1)
- Context: before designing production place-ingestion around Mapbox, verify whether we may
  persist Mapbox-derived place/coordinate attributes in our own PostgreSQL/PostGIS DB.
- Kiro artifact: chat (web verification), gating decision for a later spec.
- Concrete outcome — **FLAG: storage is NOT allowed by default.**
  - Mapbox Geocoding/Search distinguishes **temporary** (default) vs **permanent**
    geocoding. Per Mapbox docs (Understand Temporary versus Permanent Geocoding):
    - **Temporary (default):** display + real-time use permitted, but **storing the
      coordinate results is restricted** — session-only.
    - **Permanent (`permanent=true`):** storage in a database/cache is permitted, at a
      **higher cost per request**.
  - Implication for perq: we **cannot** freely cache Mapbox place results in Postgres/
    PostGIS under the default temporary mode. Persisting requires permanent geocoding
    (paid, per-request extended rights) and/or must be validated against the current MSA/
    Product Terms and pricing at build time.
  - Decision for production place-ingestion (later spec, NOT the POC): do not architect the
    ingestion flow assuming free caching of Mapbox data. Options to evaluate then:
    (a) use `permanent=true` for the specific records we persist and budget for it;
    (b) source persistent business/place records from an openly licensed dataset
        (e.g., OpenStreetMap/Overture) and use Mapbox only for live/temporary search + tiles;
    (c) store only our own derived data + user-submitted business info, not Mapbox's.
  - Sources: docs.mapbox.com "Understand Temporary versus Permanent Geocoding";
    mapbox.com/legal/tos and /legal/product-terms (verify exact clauses + pricing at
    implementation time). Content rephrased for compliance with licensing restrictions.
  - POC impact: none — the POC uses **synthetic** data only, so no Mapbox storage question
    arises. This flag applies only to the future real place-ingestion design.

### 2026-09-29 — PostGIS + Mapbox POC built and evaluated against the gate
- Context: Phase 0 vertical slice to validate the riskiest assumption (PostGIS spatial
  queries feeding a Mapbox map) before any feature specs.
- Kiro artifact: foundation-and-data-model spec Task 2 + docs/POC.md gate.
- What was built (in `poc/`, throwaway, synthetic data only):
  - Docker `postgis/postgis:16-3.4` (PostGIS 3.4.3 / PG16), healthcheck.
  - Prisma relational schema + raw SQL migration for `geography(Point,4326)` + GiST index.
  - Synthetic seed: 30 `[SYN]`-prefixed Seattle + Prague points (clearly separated from
    any future real demo data).
  - Spatial module (parameterized raw SQL): withinRadius (`ST_DWithin` + `ST_Distance`),
    nearest (`<->` KNN), withinViewport (`ST_MakeEnvelope`), all returning lng/lat.
  - Express endpoints: `/api/nearby`, `/api/viewport`, `/api/config`; bare Mapbox map page
    that re-queries the viewport on `moveend` and drops markers (no-token fallback list).
  - Integration tests: 6/6 pass, incl. an explicit lng/lat-order assertion (~1 km east
    within 800–1200 m tolerance) and Seattle/Prague bbox separation.
- Gate evaluation (docs/POC.md):
  1. PostGIS + 30 pts + GiST index — PASS (verified via `\d businesses` + seed count).
  2. `/api/nearby` parameterized `ST_DWithin` + category + meters — PASS (live curl: 15
     nearest-first; CAFE filter -> 2; bad params -> 400).
  3. Mapbox map markers + re-query on pan — PARTIAL: query loop + endpoints + client wiring
     verified; NOT yet eyeballed in a browser with a real Mapbox token (.env placeholder).
  4. Queries instant + Prisma/raw-SQL workflow comfortable — PASS (tests ~154 ms; split
     worked cleanly).
  5. Mapbox storage terms — PASS w/ FLAG: storing place data is not permitted by default
     (temporary mode); persistence needs `permanent=true` (paid) or openly-licensed data.
     POC unaffected (synthetic only).
- Verdict: **PASS with one open item** — before Phase 1 UI work, render the map in a browser
  with a real `MAPBOX_PUBLIC_TOKEN` to confirm criterion 3 visually. The load-bearing
  risk (PostGIS spatial querying + the Prisma/raw-SQL pattern) is validated.
- Friction notes: `ST_MakePoint` is (lng, lat) — asserted in tests; `prisma validate` needs
  `.env` loaded; the arm64 host pulled an amd64 PostGIS image (runs under emulation, fine
  for POC scale). Prisma postinstall scripts were gated by an allow-scripts policy but the
  client generated fine via `prisma generate`.

<!-- Add new entries above this line as the project progresses. -->
```
### YYYY-MM-DD — (next entry)
- Context:
- Kiro artifact:
- Concrete outcome:
```
