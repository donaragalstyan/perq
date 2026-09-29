/**
 * perq POC — spatial data-access module.
 *
 * All PostGIS access lives here, isolated from HTTP, using PARAMETERIZED raw SQL only
 * (no string interpolation of inputs). This mirrors the pattern the real app will use:
 * Prisma for relational, hand-written SQL for spatial.
 *
 * Convention: PostGIS ST_MakePoint takes (longitude, latitude) — longitude first.
 */
import { pool } from "./db.js";

export type BusinessRow = {
  id: string;
  name: string;
  category: string;
  city: string;
  country: string;
  lng: number;
  lat: number;
};

export type BusinessWithDistance = BusinessRow & {
  /** Great-circle distance from the query point, in meters. */
  meters: number;
};

export type LatLng = { lat: number; lng: number };

export type Viewport = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

/**
 * Businesses within `radiusMeters` of a point, optionally filtered by category,
 * ordered nearest-first with distance in meters.
 */
export async function withinRadius(
  point: LatLng,
  radiusMeters: number,
  category?: string,
): Promise<BusinessWithDistance[]> {
  const { rows } = await pool.query<BusinessWithDistance>(
    `SELECT id, name, category, city, country,
            ST_X(location::geometry) AS lng,
            ST_Y(location::geometry) AS lat,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS meters
       FROM businesses
      WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
        AND ($4::text IS NULL OR category = $4)
      ORDER BY meters ASC`,
    [point.lng, point.lat, radiusMeters, category ?? null],
  );
  return rows.map((r) => ({
    ...r,
    lng: Number(r.lng),
    lat: Number(r.lat),
    meters: Number(r.meters),
  }));
}

/**
 * The `limit` nearest businesses to a point (KNN via the `<->` operator), with distance.
 */
export async function nearest(
  point: LatLng,
  limit: number,
): Promise<BusinessWithDistance[]> {
  const { rows } = await pool.query<BusinessWithDistance>(
    `SELECT id, name, category, city, country,
            ST_X(location::geometry) AS lng,
            ST_Y(location::geometry) AS lat,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS meters
       FROM businesses
      ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      LIMIT $3`,
    [point.lng, point.lat, limit],
  );
  return rows.map((r) => ({
    ...r,
    lng: Number(r.lng),
    lat: Number(r.lat),
    meters: Number(r.meters),
  }));
}

/**
 * Businesses whose location falls within the given bounding box (map viewport),
 * optionally filtered by category.
 */
export async function withinViewport(
  vp: Viewport,
  category?: string,
): Promise<BusinessRow[]> {
  const { rows } = await pool.query<BusinessRow>(
    `SELECT id, name, category, city, country,
            ST_X(location::geometry) AS lng,
            ST_Y(location::geometry) AS lat
       FROM businesses
      WHERE location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
        AND ($5::text IS NULL OR category = $5)`,
    [vp.minLng, vp.minLat, vp.maxLng, vp.maxLat, category ?? null],
  );
  return rows.map((r) => ({ ...r, lng: Number(r.lng), lat: Number(r.lat) }));
}
