-- perq POC spatial migration (raw SQL — the PostGIS parts Prisma can't express).
-- Idempotent so it can be re-run safely during the POC.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Relational table (kept in sync with prisma/schema.prisma Business model).
CREATE TABLE IF NOT EXISTS businesses (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text    NOT NULL,
  category  text    NOT NULL,
  city      text    NOT NULL,
  country   char(2) NOT NULL
);

-- Spatial column + index (the reason this migration is raw SQL).
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

CREATE INDEX IF NOT EXISTS businesses_location_gix
  ON businesses USING GIST (location);
