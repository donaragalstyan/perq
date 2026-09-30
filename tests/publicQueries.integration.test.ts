/**
 * Integration tests for privacy-safe public queries (Requirements 4.3, 9.2, 9.3).
 * Requires local perq-db.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getPublicDiscountsForBusiness,
  getPublicEvidenceForDiscount,
} from "../src/services/publicQueries.js";
import { attachEvidence } from "../src/services/evidence.js";
import {
  closeDb,
  insertBusiness,
  insertDiscount,
  insertUser,
  resetDb,
  testPool,
} from "./helpers/db.js";

// Field names that must NEVER appear in any public payload.
const FORBIDDEN_FIELDS = [
  "reporterUserId",
  "createdByUserId",
  "authProviderId",
  "university",
  "universityCountry",
  "email",
  "emailVerified",
];

function assertNoPrivateFields(payload: unknown): void {
  const json = JSON.stringify(payload);
  for (const f of FORBIDDEN_FIELDS) {
    expect(json).not.toContain(f);
  }
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

describe("getPublicDiscountsForBusiness", () => {
  it("returns only publicly visible discounts (hides UNCONFIRMED)", async () => {
    const businessId = await insertBusiness();
    const visible = await insertDiscount(businessId, { status: "COMMUNITY_VERIFIED" });
    const hidden = await insertDiscount(businessId, { status: "UNCONFIRMED" });

    const rows = await getPublicDiscountsForBusiness(testPool, businessId);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(visible);
    expect(ids).not.toContain(hidden);
  });

  it("exposes an aggregate confirmationCount but no reporter identity", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId, { status: "COMMUNITY_VERIFIED" });

    // Two distinct reporters (inserted directly for count purposes).
    for (const u of ["ra", "rb"]) {
      const uid = await insertUser(u);
      await testPool.query(
        `INSERT INTO community_reports
           (id,"businessId","discountId","reporterUserId","normalizedType",
            "normalizedCredential",worked,"claimKey")
         VALUES (gen_random_uuid(),$1,$2,$3,'PERCENT'::"DiscountType",
                 'PHYSICAL_STUDENT_ID'::"CredentialType",true,$4)`,
        [businessId, discountId, uid, `${businessId}|PERCENT|P:15|PHYSICAL_STUDENT_ID`],
      );
    }

    const rows = await getPublicDiscountsForBusiness(testPool, businessId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.confirmationCount).toBe(2);
    assertNoPrivateFields(rows);
  });

  it("public discount payload contains no private fields", async () => {
    const businessId = await insertBusiness();
    await insertDiscount(businessId, { status: "OFFICIALLY_VERIFIED" });
    const rows = await getPublicDiscountsForBusiness(testPool, businessId);
    assertNoPrivateFields(rows);
    // Whitelisted fields present:
    expect(rows[0]).toHaveProperty("verificationStatus");
    expect(rows[0]).toHaveProperty("confirmationCount");
  });
});

describe("getPublicEvidenceForDiscount", () => {
  it("returns evidence without createdByUserId, preserving the snippet", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId, { status: "OFFICIALLY_VERIFIED" });
    const reviewer = await insertUser("rev");

    await attachEvidence(testPool, {
      discountId,
      evidenceType: "OFFICIAL_WEBSITE",
      sourceUrl: "https://example.org",
      sourceSnippet: "Students free",
      createdByUserId: reviewer, // stored, but must NOT surface publicly
      privileged: true,
    });

    const evidence = await getPublicEvidenceForDiscount(testPool, discountId);
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    expect(evidence[0]!.sourceSnippet).toContain("Students free");
    assertNoPrivateFields(evidence);
  });
});
