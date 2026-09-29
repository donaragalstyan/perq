/**
 * perq POC — spatial integration tests.
 *
 * Runs against the local Docker PostGIS (must be up: `docker compose up -d`).
 * Uses a dedicated, controlled fixture set (NOT the synthetic seed) so distances are
 * hand-checkable and the lng/lat order is asserted explicitly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import { nearest, withinRadius, withinViewport } from "../src/spatial.js";

// Known fixtures with pre-computed relationships.
// UW quad reference point:
const UW = { lat: 47.6553, lng: -122.3035 };
// A point ~1 km east-ish and one ~5 km away, plus a Prague point far away.
const FIXTURES = [
  { name: "FX Origin", category: "CAFE", city: "Seattle", country: "US", lat: 47.6553, lng: -122.3035 },
  { name: "FX Near", category: "BOOKS", city: "Seattle", country: "US", lat: 47.6553, lng: -122.2902 }, // ~1 km east
  { name: "FX Far", category: "CAFE", city: "Seattle", country: "US", lat: 47.6100, lng: -122.3035 }, // ~5 km south
  { name: "FX Prague", category: "MUSEUM", city: "Prague", country: "CZ", lat: 50.0755, lng: 14.4378 },
];

beforeAll(async () => {
  await pool.query("TRUNCATE TABLE businesses;");
  for (const f of FIXTURES) {
    await pool.query(
      `INSERT INTO businesses (name, category, city, country, location)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($5,$6),4326)::geography)`,
      [f.name, f.category, f.city, f.country, f.lng, f.lat],
    );
  }
});

afterAll(async () => {
  await pool.end();
});

describe("withinRadius", () => {
  it("returns points inside the radius, nearest-first, with meters", async () => {
    const res = await withinRadius(UW, 2000); // 2 km
    const names = res.map((r) => r.name);
    expect(names).toContain("FX Origin");
    expect(names).toContain("FX Near");
    expect(names).not.toContain("FX Far"); // ~5 km away, excluded
    expect(names).not.toContain("FX Prague");
    // ordered ascending by distance
    for (let i = 1; i < res.length; i++) {
      expect(res[i]!.meters).toBeGreaterThanOrEqual(res[i - 1]!.meters);
    }
    // origin distance ~0
    expect(res[0]!.name).toBe("FX Origin");
    expect(res[0]!.meters).toBeLessThan(5);
  });

  it("computes the ~1 km east distance within tolerance (proves lng/lat order)", async () => {
    const res = await withinRadius(UW, 2000);
    const near = res.find((r) => r.name === "FX Near");
    expect(near).toBeDefined();
    // ~1 km; if lng/lat were swapped this would be wildly wrong or the point would vanish.
    expect(near!.meters).toBeGreaterThan(800);
    expect(near!.meters).toBeLessThan(1200);
  });

  it("applies the category filter", async () => {
    const res = await withinRadius(UW, 10000, "CAFE");
    const names = res.map((r) => r.name);
    expect(names).toContain("FX Origin");
    expect(names).toContain("FX Far");
    expect(names).not.toContain("FX Near"); // BOOKS
  });
});

describe("nearest", () => {
  it("returns the K nearest points ordered by distance", async () => {
    const res = await nearest(UW, 2);
    expect(res).toHaveLength(2);
    expect(res[0]!.name).toBe("FX Origin");
    expect(res[1]!.name).toBe("FX Near");
  });
});

describe("withinViewport", () => {
  it("returns only points inside the bbox", async () => {
    // Tight Seattle bbox around UW; excludes the ~5km-south and Prague points.
    const res = await withinViewport({
      minLng: -122.31,
      minLat: 47.65,
      maxLng: -122.28,
      maxLat: 47.66,
    });
    const names = res.map((r) => r.name);
    expect(names).toContain("FX Origin");
    expect(names).toContain("FX Near");
    expect(names).not.toContain("FX Far");
    expect(names).not.toContain("FX Prague");
  });

  it("separates Prague from Seattle by bbox", async () => {
    const res = await withinViewport({
      minLng: 14.40,
      minLat: 50.06,
      maxLng: 14.46,
      maxLat: 50.09,
    });
    const names = res.map((r) => r.name);
    expect(names).toEqual(["FX Prague"]);
  });
});
