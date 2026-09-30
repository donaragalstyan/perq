-- perq — spatial migration (the PostGIS parts Prisma cannot express).
-- Run AFTER the Prisma relational schema exists (prisma db push / migrate).
-- Idempotent.

CREATE EXTENSION IF NOT EXISTS postgis;
-- NOTE: on Amazon RDS this requires a role with the rds_superuser-granted privilege.

-- Add the geography column + GiST index to the Prisma-managed businesses table.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

CREATE INDEX IF NOT EXISTS businesses_location_gix
  ON businesses USING GIST (location);
