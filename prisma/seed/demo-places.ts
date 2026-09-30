/**
 * TIER 2 — REAL place records for the demo, sourced from Overture Maps Places.
 *
 * These are real physical venues in the hero cities, marked `source = OVERTURE` with the
 * Overture/GERS id in externalPlaceId. In production these rows are produced by the (future)
 * Overture import spec; here we hand-author a SMALL set so later UI work has real places to
 * render. Coordinates are approximate public locations of well-known venues.
 *
 * IMPORTANT: This tier contains ONLY place existence data (name/coords/address/category).
 * It does NOT assert any discount. Discounts + evidence are Tier 3 (demo.ts) and must be
 * backed by real evidence per perq's verification rules.
 *
 * The `externalPlaceId` values below are placeholders (prefixed `gers-todo-`) until the real
 * Overture import runs; they are unique so the internal id remains the stable FK target.
 */
import { Client } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://perq:perq@localhost:5433/perq?schema=public";

export interface DemoPlace {
  key: string; // stable local key used by demo.ts to find the internal id
  externalPlaceId: string; // Overture GERS id (placeholder until import)
  name: string;
  category: string;
  address: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
}

// Small set of real, well-known venues. Real discounts are attached separately in demo.ts
// only when backed by real evidence.
export const DEMO_PLACES: DemoPlace[] = [
  {
    key: "burke-museum",
    externalPlaceId: "gers-todo-burke-museum",
    name: "Burke Museum of Natural History and Culture",
    category: "MUSEUM",
    address: "4300 15th Ave NE, Seattle, WA 98105",
    city: "Seattle",
    country: "US",
    lat: 47.6607,
    lng: -122.3116,
  },
  {
    key: "henry-art-gallery",
    externalPlaceId: "gers-todo-henry-art-gallery",
    name: "Henry Art Gallery",
    category: "MUSEUM",
    address: "15th Ave NE & NE 41st St, Seattle, WA 98195",
    city: "Seattle",
    country: "US",
    lat: 47.6588,
    lng: -122.3106,
  },
  {
    key: "narodni-muzeum",
    externalPlaceId: "gers-todo-narodni-muzeum",
    name: "Národní muzeum (National Museum)",
    category: "MUSEUM",
    address: "Václavské nám. 68, 110 00 Praha 1",
    city: "Prague",
    country: "CZ",
    lat: 50.0786,
    lng: 14.4306,
  },
];

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    for (const p of DEMO_PLACES) {
      // Upsert by externalPlaceId so re-running (or a future Overture refresh) updates place
      // attributes WITHOUT touching Tier-3 data that references the internal id.
      await client.query(
        `INSERT INTO businesses
           (id, "external_place_id", name, category, address, city, country, source,
            "imported_at", location, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3::"Category", $4, $5, $6,
                 'OVERTURE'::"BusinessSource", now(),
                 ST_SetSRID(ST_MakePoint($7,$8),4326)::geography, now())
         ON CONFLICT ("external_place_id") DO UPDATE
           SET name = EXCLUDED.name,
               category = EXCLUDED.category,
               address = EXCLUDED.address,
               city = EXCLUDED.city,
               country = EXCLUDED.country,
               "imported_at" = now(),
               location = EXCLUDED.location,
               "updatedAt" = now()`,
        [p.externalPlaceId, p.name, p.category, p.address, p.city, p.country, p.lng, p.lat],
      );
    }
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM businesses WHERE source = 'OVERTURE'`,
    );
    console.log(`Seeded/updated ${rows[0]?.count ?? "0"} TIER-2 OVERTURE places.`);
  } finally {
    await client.end();
  }
}

// Only run when invoked directly (demo.ts imports DEMO_PLACES without re-seeding).
if (process.argv[1] && process.argv[1].endsWith("demo-places.ts")) {
  main().catch((err) => {
    console.error("Demo places seed failed:", err);
    process.exit(1);
  });
}
