/**
 * TIER 1 — SYNTHETIC seed. NOT REAL. Development/test only.
 *
 * Fabricated points near UW/Seattle and central Prague, marked `source = SYNTHETIC` and
 * prefixed `[SYN]`. These exercise spatial queries and local development. They must NEVER be
 * presented as production/demo data and must never be loaded into the demo database
 * (which uses demo-places.ts + demo.ts only).
 */
import { Client } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://perq:perq@localhost:5433/perq?schema=public";

interface SyntheticBusiness {
  name: string;
  category: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
}

const SYNTHETIC: SyntheticBusiness[] = [
  { name: "[SYN] Ave Cafe", category: "CAFE", city: "Seattle", country: "US", lat: 47.6588, lng: -122.3129 },
  { name: "[SYN] Husky Bookstore", category: "BOOKS", city: "Seattle", country: "US", lat: 47.6559, lng: -122.308 },
  { name: "[SYN] Burke Museum", category: "MUSEUM", city: "Seattle", country: "US", lat: 47.6604, lng: -122.3116 },
  { name: "[SYN] Rainier Ramen", category: "FOOD_DRINK", city: "Seattle", country: "US", lat: 47.6543, lng: -122.3131 },
  { name: "[SYN] Montlake Cinema", category: "ENTERTAINMENT", city: "Seattle", country: "US", lat: 47.647, lng: -122.3035 },
  { name: "[SYN] U-District Threads", category: "SHOPPING", city: "Seattle", country: "US", lat: 47.6615, lng: -122.314 },
  { name: "[SYN] Kavarna Karlova", category: "CAFE", city: "Prague", country: "CZ", lat: 50.0865, lng: 14.416 },
  { name: "[SYN] Národní Muzeum", category: "MUSEUM", city: "Prague", country: "CZ", lat: 50.079, lng: 14.43 },
  { name: "[SYN] Vltava Bistro", category: "FOOD_DRINK", city: "Prague", country: "CZ", lat: 50.0812, lng: 14.4138 },
  { name: "[SYN] Kino Světozor", category: "ENTERTAINMENT", city: "Prague", country: "CZ", lat: 50.0806, lng: 14.4245 },
];

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    // Only remove synthetic rows so this never disturbs real (OVERTURE) or perq data.
    await client.query(`DELETE FROM businesses WHERE source = 'SYNTHETIC'`);
    for (const b of SYNTHETIC) {
      await client.query(
        `INSERT INTO businesses (id, name, category, city, country, source, location, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2::"Category", $3, $4, 'SYNTHETIC'::"BusinessSource",
                 ST_SetSRID(ST_MakePoint($5,$6),4326)::geography, now())`,
        [b.name, b.category, b.city, b.country, b.lng, b.lat],
      );
    }
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM businesses WHERE source = 'SYNTHETIC'`,
    );
    console.log(`Seeded ${rows[0]?.count ?? "0"} TIER-1 SYNTHETIC businesses.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Synthetic seed failed:", err);
  process.exit(1);
});
