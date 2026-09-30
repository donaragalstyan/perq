/**
 * Integration tests for community quorum promotion (Requirements 5.3, 6.1, 6.3).
 * Requires local perq-db (docker compose up -d).
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

const CLAIM_15_STUDENT_ID: NormalizedClaim = {
  discountType: "PERCENT",
  discountValue: 15,
  currency: null,
  credentialType: "PHYSICAL_STUDENT_ID",
};

async function statusOf(discountId: string): Promise<string> {
  const { rows } = await testPool.query<{ verificationStatus: string }>(
    `SELECT "verificationStatus" FROM discounts WHERE id = $1`,
    [discountId],
  );
  return rows[0]!.verificationStatus;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

describe("community quorum promotion", () => {
  it("promotes to COMMUNITY_VERIFIED after 3 unique accounts submit the same claim", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId);
    const users = await Promise.all([
      insertUser("u1"),
      insertUser("u2"),
      insertUser("u3"),
    ]);

    const results = [];
    for (const reporterUserId of users) {
      results.push(
        await submitReport(testPool, {
          businessId,
          discountId,
          reporterUserId,
          rawText: "15% off with student id",
          normalized: CLAIM_15_STUDENT_ID,
          worked: true,
        }),
      );
    }

    expect(results[0]!.promoted).toBe(false); // 1 reporter
    expect(results[1]!.promoted).toBe(false); // 2 reporters
    expect(results[2]!.promoted).toBe(true); // 3rd unique reporter -> promote
    expect(results[2]!.distinctReporters).toBe(3);
    expect(await statusOf(discountId)).toBe("COMMUNITY_VERIFIED");

    // Audit row written.
    const { rows } = await testPool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM state_transitions
        WHERE "discountId" = $1 AND "toStatus" = 'COMMUNITY_VERIFIED'`,
      [discountId],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("does NOT promote when the same account reports 3 times (one-per-account)", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId);
    const reporterUserId = await insertUser("solo");

    const first = await submitReport(testPool, {
      businessId,
      discountId,
      reporterUserId,
      normalized: CLAIM_15_STUDENT_ID,
      worked: true,
    });
    const second = await submitReport(testPool, {
      businessId,
      discountId,
      reporterUserId,
      normalized: CLAIM_15_STUDENT_ID,
      worked: true,
    });
    const third = await submitReport(testPool, {
      businessId,
      discountId,
      reporterUserId,
      normalized: CLAIM_15_STUDENT_ID,
      worked: true,
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(third.duplicate).toBe(true);
    expect(third.distinctReporters).toBe(1);
    expect(await statusOf(discountId)).toBe("UNCONFIRMED");
  });

  it("does NOT promote when 3 reporters submit DIFFERENT claims", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId);

    const r1 = await submitReport(testPool, {
      businessId,
      discountId,
      reporterUserId: await insertUser("a"),
      normalized: { ...CLAIM_15_STUDENT_ID, discountValue: 15 },
      worked: true,
    });
    const r2 = await submitReport(testPool, {
      businessId,
      discountId,
      reporterUserId: await insertUser("b"),
      normalized: { ...CLAIM_15_STUDENT_ID, discountValue: 10 },
      worked: true,
    });
    const r3 = await submitReport(testPool, {
      businessId,
      discountId,
      reporterUserId: await insertUser("c"),
      normalized: { ...CLAIM_15_STUDENT_ID, discountValue: 20 },
      worked: true,
    });

    // Each distinct claimKey has only 1 reporter; no quorum.
    expect(r1.promoted || r2.promoted || r3.promoted).toBe(false);
    expect(await statusOf(discountId)).toBe("UNCONFIRMED");
  });
});
