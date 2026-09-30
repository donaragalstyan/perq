import { describe, expect, it } from "vitest";
import {
  bucketOf,
  evaluateConflict,
  type ContradictingReport,
} from "./conflict.js";

const NOW = new Date("2026-09-29T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
const VERIFIED_KEY = "biz|PERCENT|P:15|PHYSICAL_STUDENT_ID";
const COMPETING_KEY = "biz|PERCENT|P:10|PHYSICAL_STUDENT_ID";
const LAST_VERIFIED = daysAgo(120); // verified 120 days ago

function rep(
  reporterUserId: string,
  claimKey: string,
  createdAt: Date,
  isNegative = false,
): ContradictingReport {
  return { reporterUserId, claimKey, createdAt, isNegative };
}

describe("evaluateConflict — trips when 3 unique, agreeing, recent, newer", () => {
  it("3 unique accounts reporting the same competing claim -> conflict + supersede", () => {
    const reports = [
      rep("a", COMPETING_KEY, daysAgo(10)),
      rep("b", COMPETING_KEY, daysAgo(9)),
      rep("c", COMPETING_KEY, daysAgo(8)),
    ];
    const d = evaluateConflict({ verifiedKey: VERIFIED_KEY, lastVerifiedAt: LAST_VERIFIED, reports, now: NOW });
    expect(d.conflict).toBe(true);
    if (d.conflict) {
      expect(d.competingKey).toBe(COMPETING_KEY);
      expect(d.distinctAccounts).toBe(3);
      expect(d.supersede).toBe(true);
    }
  });

  it("3 unique 'no discount' negatives -> conflict but NOT supersede (NONE bucket)", () => {
    const reports = [
      rep("a", "anything", daysAgo(5), true),
      rep("b", "other", daysAgo(4), true),
      rep("c", "x", daysAgo(3), true),
    ];
    const d = evaluateConflict({ verifiedKey: VERIFIED_KEY, lastVerifiedAt: LAST_VERIFIED, reports, now: NOW });
    expect(d.conflict).toBe(true);
    if (d.conflict) {
      expect(d.competingKey).toBe("NONE");
      expect(d.supersede).toBe(false);
    }
  });
});

describe("evaluateConflict — negative cases (must NOT trip) [Requirement 7.5]", () => {
  it("single account repeating does not count 3x (distinct accounts only)", () => {
    const reports = [
      rep("solo", COMPETING_KEY, daysAgo(10)),
      rep("solo", COMPETING_KEY, daysAgo(9)),
      rep("solo", COMPETING_KEY, daysAgo(8)),
    ];
    expect(
      evaluateConflict({ verifiedKey: VERIFIED_KEY, lastVerifiedAt: LAST_VERIFIED, reports, now: NOW }).conflict,
    ).toBe(false);
  });

  it("stale contradictions outside the 90-day window do not trip", () => {
    const reports = [
      rep("a", COMPETING_KEY, daysAgo(100)),
      rep("b", COMPETING_KEY, daysAgo(110)),
      rep("c", COMPETING_KEY, daysAgo(120)),
    ];
    // Also make lastVerified older so the "newer" check isn't the reason it fails.
    expect(
      evaluateConflict({
        verifiedKey: VERIFIED_KEY,
        lastVerifiedAt: daysAgo(200),
        reports,
        now: NOW,
      }).conflict,
    ).toBe(false);
  });

  it("contradictions older than lastVerifiedAt do not trip", () => {
    const reports = [
      rep("a", COMPETING_KEY, daysAgo(130)),
      rep("b", COMPETING_KEY, daysAgo(140)),
      rep("c", COMPETING_KEY, daysAgo(150)),
    ];
    expect(
      evaluateConflict({ verifiedKey: VERIFIED_KEY, lastVerifiedAt: daysAgo(120), reports, now: NOW }).conflict,
    ).toBe(false);
  });

  it("non-agreeing contradictions (different competing keys) do not reach threshold", () => {
    const reports = [
      rep("a", "biz|PERCENT|P:10|PHYSICAL_STUDENT_ID", daysAgo(10)),
      rep("b", "biz|PERCENT|P:20|PHYSICAL_STUDENT_ID", daysAgo(9)),
      rep("c", "biz|FIXED|F:USD:5.00|PHYSICAL_STUDENT_ID", daysAgo(8)),
    ];
    expect(
      evaluateConflict({ verifiedKey: VERIFIED_KEY, lastVerifiedAt: LAST_VERIFIED, reports, now: NOW }).conflict,
    ).toBe(false);
  });

  it("reports that match the verified key are not contradictions", () => {
    const reports = [
      rep("a", VERIFIED_KEY, daysAgo(10)),
      rep("b", VERIFIED_KEY, daysAgo(9)),
      rep("c", VERIFIED_KEY, daysAgo(8)),
    ];
    expect(
      evaluateConflict({ verifiedKey: VERIFIED_KEY, lastVerifiedAt: LAST_VERIFIED, reports, now: NOW }).conflict,
    ).toBe(false);
  });

  it("two agreeing accounts is below threshold", () => {
    const reports = [
      rep("a", COMPETING_KEY, daysAgo(10)),
      rep("b", COMPETING_KEY, daysAgo(9)),
    ];
    expect(
      evaluateConflict({ verifiedKey: VERIFIED_KEY, lastVerifiedAt: LAST_VERIFIED, reports, now: NOW }).conflict,
    ).toBe(false);
  });
});

describe("bucketOf", () => {
  it("collapses negatives to NONE, keeps competing claimKey otherwise", () => {
    expect(bucketOf(rep("a", "some-key", NOW, true))).toBe("NONE");
    expect(bucketOf(rep("a", "some-key", NOW, false))).toBe("some-key");
  });
});
