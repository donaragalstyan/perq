/**
 * Integration tests for the evidence service (Requirements 3, 5.5, 5.6, 9.2).
 * Requires local perq-db.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachEvidence } from "../src/services/evidence.js";
import { isPubliclyVisible } from "../src/domain/stateMachine.js";
import {
  closeDb,
  insertBusiness,
  insertDiscount,
  insertUser,
  resetDb,
  testPool,
} from "./helpers/db.js";

async function statusOf(id: string): Promise<string> {
  const { rows } = await testPool.query<{ verificationStatus: string }>(
    `SELECT "verificationStatus" FROM discounts WHERE id = $1`,
    [id],
  );
  return rows[0]!.verificationStatus;
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

describe("official evidence", () => {
  it("privileged actor + official evidence -> OFFICIALLY_VERIFIED with audit + snippet", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId);
    const reviewer = await insertUser("reviewer");

    const res = await attachEvidence(testPool, {
      discountId,
      evidenceType: "OFFICIAL_WEBSITE",
      sourceUrl: "https://example-museum.org/tickets",
      sourceSnippet: "Students: free entry with valid ID",
      createdByUserId: reviewer,
      privileged: true,
    });

    expect(res.transitioned).toBe(true);
    expect(res.status).toBe("OFFICIALLY_VERIFIED");
    expect(await statusOf(discountId)).toBe("OFFICIALLY_VERIFIED");

    // Snippet preserved as evidence.
    const ev = await testPool.query<{ sourceSnippet: string }>(
      `SELECT "sourceSnippet" FROM evidence WHERE id = $1`,
      [res.evidenceId],
    );
    expect(ev.rows[0]!.sourceSnippet).toContain("free entry");

    // Audit row exists.
    const t = await testPool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM state_transitions
        WHERE "discountId" = $1 AND "toStatus" = 'OFFICIALLY_VERIFIED'`,
      [discountId],
    );
    expect(Number(t.rows[0]!.n)).toBe(1);
  });

  it("non-privileged actor + official evidence stores it but does NOT transition", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId);

    const res = await attachEvidence(testPool, {
      discountId,
      evidenceType: "OFFICIAL_WEBSITE",
      sourceUrl: "https://example.org",
      sourceSnippet: "student price listed",
      privileged: false,
    });

    expect(res.transitioned).toBe(false);
    expect(res.status).toBe("UNCONFIRMED");
    expect(await statusOf(discountId)).toBe("UNCONFIRMED");
    // Evidence still stored.
    const ev = await testPool.query(`SELECT 1 FROM evidence WHERE id = $1`, [res.evidenceId]);
    expect(ev.rowCount).toBe(1);
  });
});

describe("AI-cannot-publish invariant (Requirement 5.6)", () => {
  it("AI_EXTRACTION evidence keeps the discount UNCONFIRMED (never visible)", async () => {
    const businessId = await insertBusiness({ source: "AI_CANDIDATE" });
    const discountId = await insertDiscount(businessId);

    const res = await attachEvidence(testPool, {
      discountId,
      evidenceType: "AI_EXTRACTION",
      sourceUrl: "https://example.org/pricing",
      sourceSnippet: "Student ticket: €8",
    });

    expect(res.transitioned).toBe(false);
    expect(res.status).toBe("UNCONFIRMED");
    expect(isPubliclyVisible(res.status)).toBe(false);
    expect(await statusOf(discountId)).toBe("UNCONFIRMED");

    // The snippet is preserved as a candidate proof for later human review.
    const ev = await testPool.query<{ sourceSnippet: string; evidenceType: string }>(
      `SELECT "sourceSnippet", "evidenceType" FROM evidence WHERE id = $1`,
      [res.evidenceId],
    );
    expect(ev.rows[0]!.evidenceType).toBe("AI_EXTRACTION");
    expect(ev.rows[0]!.sourceSnippet).toContain("€8");
  });

  it("even for a COMMUNITY_VERIFIED discount, AI_EXTRACTION does not change status", async () => {
    const businessId = await insertBusiness();
    const discountId = await insertDiscount(businessId, { status: "COMMUNITY_VERIFIED" });

    const res = await attachEvidence(testPool, {
      discountId,
      evidenceType: "AI_EXTRACTION",
      sourceSnippet: "Students save 20%",
    });

    expect(res.transitioned).toBe(false);
    expect(res.status).toBe("COMMUNITY_VERIFIED"); // unchanged
    expect(await statusOf(discountId)).toBe("COMMUNITY_VERIFIED");
  });
});
