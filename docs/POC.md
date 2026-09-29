# perq — Phase 0 Proof-of-Concept

## Purpose

Validate the **riskiest technical assumption** before building anything else:

> That we can store businesses in PostGIS and answer "nearby / viewport / nearest /
> category-filtered" queries **fast**, feeding a Mapbox map — including the practical
> friction of Prisma + raw SQL for spatial and the map provider's place-data licensing.

Everything else in perq (auth, community verification, Bedrock extraction) is conventional
work. This slice is the new, load-bearing, unproven piece. If it comes together cleanly,
the rest is execution. If Mapbox terms or the raw-SQL friction surprise us, we find out on
day 1–2, not day 20.

## Success criteria (the gate)

The POC passes when **all** of these hold:

1. A local PostGIS DB holds ~30 **synthetic** Seattle + Prague points with a GiST-indexed
   `geography(Point,4326)` column.
2. A single endpoint answers `GET /api/nearby?lat=&lng=&radiusKm=&category=` using a real
   parameterized `ST_DWithin` + category filter, returning each row's distance in meters.
3. A bare Mapbox GL map renders those points as markers and **re-queries on pan/zoom** using
   the viewport bounding box.
4. Queries feel instant on 30 rows (they will be), and the raw-SQL + Prisma workflow is
   comfortable enough to commit to.
5. We have confirmed Mapbox's terms permit **storing** the place attributes we intend to
   cache (id, name, coordinates). (Decision recorded below.)

If any criterion fails or feels wrong, we adapt the plan here before Phase 1 — that's the
whole point of doing this first.

## Scope discipline

This POC is **throwaway-quality** and uses **synthetic data only** (`prisma/seed/synthetic.ts`).
Do NOT add auth, the full schema, discounts, evidence, styling, or real data here. Its only
job is to de-risk PostGIS + Mapbox. Real, evidence-backed demo data comes later
(`prisma/seed/demo.ts`), kept strictly separate per the seeding requirement.

## Steps

### 1. Local PostGIS via Docker
Create `docker-compose.yml` with the official `postgis/postgis` image, a database, and a
mapped port. Bring it up and confirm you can connect.

```yaml
# docker-compose.yml (POC)
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: perq
      POSTGRES_PASSWORD: perq
      POSTGRES_DB: perq
    ports: ["5432:5432"]
```

Enable the extension once connected:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```
Note for later: on Amazon RDS this requires a role with the `rds_superuser`-granted
privilege; locally the default superuser is fine.

### 2. Minimal schema + spatial index
One table only:
```sql
CREATE TABLE businesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category    text NOT NULL,
  city        text NOT NULL,
  country     char(2) NOT NULL,
  location    geography(Point, 4326) NOT NULL
);
CREATE INDEX businesses_location_gix ON businesses USING GIST (location);
```
(You can manage this via a Prisma migration + a raw SQL migration for the `location` column
and index, exactly as the foundation spec describes — this is where you first feel that
workflow.)

### 3. Seed ~30 synthetic points
`prisma/seed/synthetic.ts`: ~15 Seattle points near UW (47.6553, -122.3035) and ~15 Prague
points near the center (50.0755, 14.4378), spread across a few categories. Clearly label the
file/data as synthetic. Insert with a parameterized statement, e.g.:
```sql
INSERT INTO businesses (name, category, city, country, location)
VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography);
-- note: ST_MakePoint takes (lng, lat) — longitude first
```

### 4. The four spatial queries (data-access module)
Isolate these in one module with parameterized raw SQL (the pattern the whole app will use):
```sql
-- within radius (meters), optional category
SELECT id, name, category,
       ST_Distance(location, ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography) AS meters
FROM businesses
WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography, $meters)
  AND ($category IS NULL OR category = $category)
ORDER BY meters ASC;

-- nearest N (KNN)
SELECT id, name,
       location <-> ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography AS d
FROM businesses ORDER BY d LIMIT $n;

-- within viewport (bbox: minLng,minLat,maxLng,maxLat)
SELECT id, name, category
FROM businesses
WHERE location && ST_MakeEnvelope($minLng,$minLat,$maxLng,$maxLat,4326)::geography;
```

### 5. One API endpoint
`GET /api/nearby?lat=&lng=&radiusKm=&category=` -> withinRadius query -> JSON of
`{ id, name, category, meters }`. Validate/parse query params at the boundary.

### 6. Bare Mapbox map
A single page: initialize Mapbox GL JS centered on Seattle or Prague, fetch `/api/nearby`
for the initial center, drop markers. On `moveend`, read `map.getBounds()` and call a
viewport endpoint (or reuse nearby with the center) to refresh markers. No styling, no
clustering yet — just prove the loop: pan -> query PostGIS -> markers update.

### 7. Verify + record
- Run the spatial integration tests against known fixtures (distances you can hand-check,
  e.g., two UW points a known ~distance apart).
- Confirm the four queries return correct rows.
- Record the Mapbox licensing decision and any raw-SQL friction in `docs/DEV_LOG.md`.

## Things to watch (likely friction points)
- **lng/lat order**: `ST_MakePoint(lng, lat)` — longitude first. A swapped pair puts Prague
  in the ocean; catch it in tests.
- **geography vs geometry**: use `geography` so `ST_DWithin`/`ST_Distance` are in meters
  without projection math.
- **Prisma + PostGIS**: Prisma won't model `geography`; you'll manage that column via raw SQL
  and read it with `$queryRaw`. Confirm this feels acceptable — it's the pattern for the
  whole app.
- **Mapbox token + terms**: put the token in an env var (never commit it). Confirm the plan
  to cache place attributes is within terms; if not, adjust the data model now.

## What comes after the gate
Only once the POC passes, proceed to Phase 1 (foundation spec Tasks 3–11): full schema,
normalization + claimKey, state machine, quorum, and conflict detection — all unit-tested.
Do not start auth, map UI, eligibility, community, or AI specs until the foundation is in
place.

## How I can help next
When you're ready to build the POC, I can:
- generate the `docker-compose.yml`, Prisma init, the SQL migration, and the synthetic seed;
- write the spatial data-access module + the `/api/nearby` endpoint;
- stand up the bare Mapbox page;
- write the spatial integration tests.
Say the word and I'll start with the Docker + schema + seed, then we validate before going
further.
