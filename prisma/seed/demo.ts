/**
 * TIER 3 — REAL discounts with REAL evidence, attached to Tier-2 (Overture) places by the
 * internal Business.id (never externalPlaceId).
 *
 * TRUST RULE (product-principles + ai-and-evidence): every discount seeded here MUST be a
 * real student discount backed by real evidence (a first-party sourceUrl + a preserved
 * sourceSnippet + a checkedAt date). We do NOT fabricate percentages/prices and present them
 * as real.
 *
 * Because verifying live student-discount prices requires checking each venue's official page
 * at seed time, this file ships with NO fabricated discounts. Each entry below is a template
 * the developer completes with verified data (fill sourceUrl + sourceSnippet + checkedAt,
 * then set `verified: true`). Only verified entries are loaded; unverified templates are
 * skipped with a warning, so the demo never shows unverified data.
 */
import { Client } from "pg";
import { DEMO_PLACES } from "./demo-places.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://perq:perq@localhost:5433/perq?schema=public";

interface DemoDiscount {
  placeKey: string; // matches DEMO_PLACES[].key
  discountType: "PERCENT" | "FIXED" | "SPECIAL_PRICE" | "FREE" | "NONE";
  discountValue: number | null;
  currency: string | null;
  acceptedCredentials: string[];
  eligibilityNotes?: string;
  // Real evidence — required to load:
  evidenceType: "OFFICIAL_WEBSITE" | "TICKETING_PAGE";
  sourceUrl: string;
  sourceSnippet: string;
  checkedAt: string; // ISO date the official page was checked
  verified: boolean; // set true ONLY after a human confirms the evidence above is real
}

// Templates. Fill in real evidence and flip `verified` to true before relying on them.
// Left unverified on purpose so nothing fake is ever presented as a real discount.
const DEMO_DISCOUNTS: DemoDiscount[] = [
  {
    placeKey: "burke-museum",
    discountType: "SPECIAL_PRICE",
    discountValue: null,
    currency: "USD",
    acceptedCredentials: ["PHYSICAL_STUDENT_ID", "ANY_UNIVERSITY_ID"],
    eligibilityNotes: "Student admission price — confirm current amount on the official page.",
    evidenceType: "OFFICIAL_WEBSITE",
    sourceUrl: "",
    sourceSnippet: "",
    checkedAt: "",
    verified: false,
  },
  {
    placeKey: "narodni-muzeum",
    discountType: "SPECIAL_PRICE",
    discountValue: null,
    currency: "CZK",
    acceptedCredentials: ["ISIC", "PHYSICAL_STUDENT_ID"],
    eligibilityNotes: "Reduced (student) entry — confirm current amount + accepted IDs.",
    evidenceType: "TICKETING_PAGE",
    sourceUrl: "",
    sourceSnippet: "",
    checkedAt: "",
    verified: false,
  },
];

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    let loaded = 0;
    let skipped = 0;
    for (const d of DEMO_DISCOUNTS) {
      if (!d.verified || !d.sourceUrl || !d.sourceSnippet || !d.checkedAt) {
        skipped++;
        console.warn(
          `SKIP (unverified) discount for "${d.placeKey}": provide real sourceUrl + ` +
            `sourceSnippet + checkedAt and set verified=true before it will load.`,
        );
        continue;
      }
      const place = DEMO_PLACES.find((p) => p.key === d.placeKey);
      if (!place) {
        console.warn(`SKIP: unknown placeKey "${d.placeKey}"`);
        continue;
      }
      // Resolve the internal business id by the Overture externalPlaceId (never trust the key).
      const bres = await client.query<{ id: string }>(
        `SELECT id FROM businesses WHERE "external_place_id" = $1`,
        [place.externalPlaceId],
      );
      const businessId = bres.rows[0]?.id;
      if (!businessId) {
        console.warn(`SKIP: place "${d.placeKey}" not found — run demo-places.ts first.`);
        continue;
      }

      // Create the discount as OFFICIALLY_VERIFIED (it has real official evidence).
      const dres = await client.query<{ id: string }>(
        `INSERT INTO discounts
           (id, "businessId", "discountType", "discountValue", currency,
            "acceptedCredentials", "eligibilityNotes", "verificationStatus",
            "confidenceScore", "lastVerifiedAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2::"DiscountType", $3, $4,
                 $5::"CredentialType"[], $6, 'OFFICIALLY_VERIFIED'::"VerificationStatus",
                 100, $7::timestamptz, now())
         RETURNING id`,
        [
          businessId,
          d.discountType,
          d.discountValue,
          d.currency,
          d.acceptedCredentials,
          d.eligibilityNotes ?? null,
          d.checkedAt,
        ],
      );
      const discountId = dres.rows[0]!.id;

      await client.query(
        `INSERT INTO evidence
           (id, "discountId", "evidenceType", "sourceUrl", "sourceSnippet", "checkedAt")
         VALUES (gen_random_uuid(), $1, $2::"EvidenceType", $3, $4, $5::timestamptz)`,
        [discountId, d.evidenceType, d.sourceUrl, d.sourceSnippet, d.checkedAt],
      );
      await client.query(
        `INSERT INTO state_transitions (id, "discountId", "fromStatus", "toStatus", reason)
         VALUES (gen_random_uuid(), $1, 'UNCONFIRMED'::"VerificationStatus",
                 'OFFICIALLY_VERIFIED'::"VerificationStatus", 'demo seed: real official evidence')`,
        [discountId],
      );
      loaded++;
    }
    console.log(
      `TIER-3 demo discounts: loaded ${loaded} verified, skipped ${skipped} unverified.`,
    );
    if (loaded === 0) {
      console.warn(
        "No verified demo discounts loaded. Fill in real evidence in demo.ts before the demo.",
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Demo discounts seed failed:", err);
  process.exit(1);
});
