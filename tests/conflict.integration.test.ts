/**
 * Integration tests for conflict detection (Requirement 7). Requires local perq-db.
 *
 * Scenario mirrors the spec: a discount is COMMUNITY_VERIFIED at 15% off; later, 3 unique
 * accounts report 10% off. The discount should move to NEEDS_REVERIFICATION.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { submitReport } from "../src/services/reports.js";
import type { NormalizedClaim } from "../src/domain/types.js";
import {
  closeDb,
  insertBusiness,
  insertDiscount,
  insertUser,
  resetDb,
  testPool,
} from "./helpers/db.js";

const CLAIM_15: NormalizedClaim = {
  discountType: "PERCENT",
  discountValue: 15,
  currency: null,
  credentialType: "PHYSICAL_STUDENT_ID",
};
const CLAIM_10: NormalizedClaim = { ...CLAIM_15, discountValue: 10 };

async function statusOf(id: string): Promise<string> {
  const { rows } = await testPool.query<{ verificationStatus: string }>(
    `SELECT "verificationStatus" FROM discounts WHERE id = $1`,
    [id],
  );
  return rows[0]!.verificationStatus;
}

/** Promote a discount to COMMUNITY_VERIFIED via 3 unique 15%-off reports, then backdate their
 *  createdAt + lastVerifiedAt so subsequent reports count as "more recent". */
async function makeVerified(businessId: string, discountId: string): Promise<void> {
  for (const u of ["v1", "v2", "v3"]) {
    await submitReport(testPool, {
      businessId,
      discountId,
      reporterUserId: await insertUser(u),
      normalized: CLAIM_15,
      worked: true,
    });
  }
  // Backdate the promoting reports and the verification time to 60 days ago.
  await testPool.query(
    `UPDATE community_reports SET "createdAt" = now() - interval '60 days'
      WHERE "businessId" = $1`,
    [businessId],
  );
  await testPool.query(
    `UPDATE discounts SET "lastVerifiedAt" = now() - interval '60 days' WHERE id = $1`,
    [discountId],
  );
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

describe("conflict detection", () => {
  it("flips COMMUNITY_VERIFIED -> NEEDS_REVERIFICATION on 3 recent contradicting reports", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId);
    await makeVerified(businessId, discountId);
    expect(await statusOf(discountId)).toBe("COMMUNITY_VERIFIED");

    // 3 unique accounts now report 10% off (recent, after lastVerifiedAt).
    let last;
    for (const u of ["c1", "c2", "c3"]) {
      last = await submitReport(testPool, {
        businessId,
        discountId,
        reporterUserId: await insertUser(u),
        normalized: CLAIM_10,
        worked: true,
      });
    }
    // Flag-first: even though the competing 10%-off claim reached quorum (3), the discount
    // moves to NEEDS_REVERIFICATION and is NOT silently swapped to the new value.
    expect(await statusOf(discountId)).toBe("NEEDS_REVERIFICATION");
    expect(last!.conflict?.changed).toBe(true);
    expect(last!.conflict?.to).toBe("NEEDS_REVERIFICATION");
    expect(last!.conflict?.supersedeEligible).toBe(true); // eligible, but not applied

    // Audit row preserves the disagreement as structured evidence.
    const { rows } = await testPool.query<{ reason: string }>(
      `SELECT reason FROM state_transitions
        WHERE "discountId" = $1 AND "toStatus" = 'NEEDS_REVERIFICATION'`,
      [discountId],
    );
    expect(rows).toHaveLength(1);
    const evidence = JSON.parse(rows[0]!.reason) as {
      kind: string;
      verifiedKey: string;
      competingKey: string;
      competingDistinctReporters: number;
      supersedeEligible: boolean;
    };
    expect(evidence.kind).toBe("conflict");
    expect(evidence.verifiedKey).toContain("P:15");
    expect(evidence.competingKey).toContain("P:10");
    expect(evidence.competingDistinctReporters).toBe(3);
    expect(evidence.supersedeEligible).toBe(true);
  });

  it("a NONE/no-discount conflict flags but is not supersede-eligible", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId);
    await makeVerified(businessId, discountId);

    let last;
    for (const u of ["n1", "n2", "n3"]) {
      last = await submitReport(testPool, {
        businessId,
        discountId,
        reporterUserId: await insertUser(u),
        normalized: {
          discountType: "NONE",
          discountValue: null,
          currency: null,
          credentialType: "PHYSICAL_STUDENT_ID",
        },
        worked: false,
      });
    }
    expect(await statusOf(discountId)).toBe("NEEDS_REVERIFICATION");
    expect(last!.conflict?.supersedeEligible).toBe(false);
  });

  it("does NOT flip on a single contradicting account", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId);
    await makeVerified(businessId, discountId);

    await submitReport(testPool, {
      businessId,
      discountId,
      reporterUserId: await insertUser("lonely"),
      normalized: CLAIM_10,
      worked: true,
    });
    expect(await statusOf(discountId)).toBe("COMMUNITY_VERIFIED");
  });
});
