/**
 * perq POC — SYNTHETIC seed data. NOT REAL.
 *
 * These are fabricated points near UW/Seattle and central Prague, used only to exercise
 * the PostGIS spatial queries and the bare Mapbox map during the proof-of-concept.
 *
 * They must NEVER be mixed with real, evidence-backed demo data. Real demo data lives in a
 * separate seed (prisma/seed/demo.ts) in the real app, per the seeding requirement.
 */
import { Client } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://perq:perq@localhost:5432/perq_poc?schema=public";

type SyntheticBusiness = {
  name: string;
  category: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lng: number;
};

// ~15 Seattle (near UW: 47.6553, -122.3035) + ~15 Prague (near center: 50.0755, 14.4378).
// Coordinates are approximate/fabricated. Prefix names with "[SYN]" so it is obvious in any
// UI or query result that these are synthetic.
const SYNTHETIC: SyntheticBusiness[] = [
  // --- Seattle ---
  { name: "[SYN] Ave Cafe", category: "CAFE", city: "Seattle", country: "US", lat: 47.6588, lng: -122.3129 },
  { name: "[SYN] Husky Bookstore", category: "BOOKS", city: "Seattle", country: "US", lat: 47.6559, lng: -122.3080 },
  { name: "[SYN] Burke Museum", category: "MUSEUM", city: "Seattle", country: "US", lat: 47.6604, lng: -122.3116 },
  { name: "[SYN] Rainier Ramen", category: "FOOD_DRINK", city: "Seattle", country: "US", lat: 47.6543, lng: -122.3131 },
  { name: "[SYN] Montlake Cinema", category: "ENTERTAINMENT", city: "Seattle", country: "US", lat: 47.6470, lng: -122.3035 },
  { name: "[SYN] U-District Threads", category: "SHOPPING", city: "Seattle", country: "US", lat: 47.6615, lng: -122.3140 },
  { name: "[SYN] Link Light Rail — UW", category: "TRANSPORTATION", city: "Seattle", country: "US", lat: 47.6497, lng: -122.3040 },
  { name: "[SYN] IMA Fitness", category: "FITNESS", city: "Seattle", country: "US", lat: 47.6534, lng: -122.3013 },
  { name: "[SYN] Byte Computers", category: "TECHNOLOGY", city: "Seattle", country: "US", lat: 47.6579, lng: -122.3132 },
  { name: "[SYN] Kayak Union Bay", category: "EXPERIENCES", city: "Seattle", country: "US", lat: 47.6530, lng: -122.2960 },
  { name: "[SYN] Portage Bay Coffee", category: "CAFE", city: "Seattle", country: "US", lat: 47.6512, lng: -122.3175 },
  { name: "[SYN] Suzzallo Snacks", category: "FOOD_DRINK", city: "Seattle", country: "US", lat: 47.6556, lng: -122.3085 },
  { name: "[SYN] Greek Row Grocery", category: "SHOPPING", city: "Seattle", country: "US", lat: 47.6602, lng: -122.3070 },
  { name: "[SYN] Henry Art Gallery", category: "MUSEUM", city: "Seattle", country: "US", lat: 47.6588, lng: -122.3106 },
  { name: "[SYN] Ravenna Records", category: "OTHER", city: "Seattle", country: "US", lat: 47.6685, lng: -122.3010 },

  // --- Prague ---
  { name: "[SYN] Kavarna Karlova", category: "CAFE", city: "Prague", country: "CZ", lat: 50.0865, lng: 14.4160 },
  { name: "[SYN] Staré Knihy", category: "BOOKS", city: "Prague", country: "CZ", lat: 50.0870, lng: 14.4205 },
  { name: "[SYN] Národní Muzeum", category: "MUSEUM", city: "Prague", country: "CZ", lat: 50.0790, lng: 14.4300 },
  { name: "[SYN] Vltava Bistro", category: "FOOD_DRINK", city: "Prague", country: "CZ", lat: 50.0812, lng: 14.4138 },
  { name: "[SYN] Kino Světozor", category: "ENTERTAINMENT", city: "Prague", country: "CZ", lat: 50.0806, lng: 14.4245 },
  { name: "[SYN] Wenceslas Wear", category: "SHOPPING", city: "Prague", country: "CZ", lat: 50.0810, lng: 14.4270 },
  { name: "[SYN] Tram Stop Národní", category: "TRANSPORTATION", city: "Prague", country: "CZ", lat: 50.0817, lng: 14.4179 },
  { name: "[SYN] Fitness Vinohrady", category: "FITNESS", city: "Prague", country: "CZ", lat: 50.0755, lng: 14.4440 },
  { name: "[SYN] Praha Tech Hub", category: "TECHNOLOGY", city: "Prague", country: "CZ", lat: 50.0899, lng: 14.4210 },
  { name: "[SYN] Castle Walking Tour", category: "EXPERIENCES", city: "Prague", country: "CZ", lat: 50.0900, lng: 14.4000 },
  { name: "[SYN] Old Town Coffee", category: "CAFE", city: "Prague", country: "CZ", lat: 50.0875, lng: 14.4213 },
  { name: "[SYN] Charles Bridge Snacks", category: "FOOD_DRINK", city: "Prague", country: "CZ", lat: 50.0865, lng: 14.4114 },
  { name: "[SYN] Malá Strana Market", category: "SHOPPING", city: "Prague", country: "CZ", lat: 50.0880, lng: 14.4030 },
  { name: "[SYN] Museum Kampa", category: "MUSEUM", city: "Prague", country: "CZ", lat: 50.0855, lng: 14.4075 },
  { name: "[SYN] Žižkov Vinyl", category: "OTHER", city: "Prague", country: "CZ", lat: 50.0870, lng: 14.4500 },
];

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    // Fresh, deterministic seed for the POC.
    await client.query("TRUNCATE TABLE businesses;");

    for (const b of SYNTHETIC) {
      // Parameterized insert. ST_MakePoint takes (longitude, latitude) — longitude first.
      await client.query(
        `INSERT INTO businesses (name, category, city, country, location)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)`,
        [b.name, b.category, b.city, b.country, b.lng, b.lat],
      );
    }

    const { rows } = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM businesses;",
    );
    console.log(`Seeded ${rows[0]?.count ?? "0"} SYNTHETIC businesses (Seattle + Prague).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Synthetic seed failed:", err);
  process.exit(1);
});
