import { describe, expect, it } from "vitest";
import {
  confidenceScore,
  evaluateTransition,
  isPubliclyVisible,
  type TransitionTrigger,
} from "./stateMachine.js";
import type { VerificationStatus } from "./types.js";

describe("evaluateTransition — legal transitions", () => {
  const legal: Array<[VerificationStatus, VerificationStatus, TransitionTrigger]> = [
    ["UNCONFIRMED", "COMMUNITY_VERIFIED", "COMMUNITY_QUORUM"],
    ["UNCONFIRMED", "OFFICIALLY_VERIFIED", "OFFICIAL_EVIDENCE"],
    ["COMMUNITY_VERIFIED", "OFFICIALLY_VERIFIED", "OFFICIAL_EVIDENCE"],
    ["NEEDS_REVERIFICATION", "OFFICIALLY_VERIFIED", "OFFICIAL_EVIDENCE"],
    ["STALE", "OFFICIALLY_VERIFIED", "OFFICIAL_EVIDENCE"],
    ["COMMUNITY_VERIFIED", "NEEDS_REVERIFICATION", "CONFLICT_DETECTED"],
    ["OFFICIALLY_VERIFIED", "NEEDS_REVERIFICATION", "CONFLICT_DETECTED"],
    ["NEEDS_REVERIFICATION", "COMMUNITY_VERIFIED", "COMMUNITY_SUPERSEDE"],
    ["NEEDS_REVERIFICATION", "STALE", "STALE_TIMEOUT"],
    ["UNCONFIRMED", "REJECTED", "ADMIN"],
    ["COMMUNITY_VERIFIED", "REJECTED", "ADMIN"],
    ["OFFICIALLY_VERIFIED", "REJECTED", "ADMIN"],
  ];

  it.each(legal)("%s -> %s via %s is allowed", (from, to, trigger) => {
    const r = evaluateTransition({ from, to, trigger });
    expect(r.ok).toBe(true);
  });
});

describe("evaluateTransition — illegal transitions", () => {
  it("rejects an unknown edge", () => {
    const r = evaluateTransition({
      from: "UNCONFIRMED",
      to: "STALE",
      trigger: "STALE_TIMEOUT",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a legal edge requested with the wrong trigger", () => {
    // UNCONFIRMED -> COMMUNITY_VERIFIED is only legal via COMMUNITY_QUORUM, not ADMIN.
    const r = evaluateTransition({
      from: "UNCONFIRMED",
      to: "COMMUNITY_VERIFIED",
      trigger: "ADMIN",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a no-op transition", () => {
    const r = evaluateTransition({
      from: "COMMUNITY_VERIFIED",
      to: "COMMUNITY_VERIFIED",
      trigger: "COMMUNITY_QUORUM",
    });
    expect(r.ok).toBe(false);
  });

  it("does not allow community quorum to reach OFFICIALLY_VERIFIED", () => {
    const r = evaluateTransition({
      from: "UNCONFIRMED",
      to: "OFFICIALLY_VERIFIED",
      trigger: "COMMUNITY_QUORUM",
    });
    expect(r.ok).toBe(false);
  });
});

describe("AI-cannot-publish invariant (ai-and-evidence.md)", () => {
  const visibleTargets: VerificationStatus[] = [
    "COMMUNITY_VERIFIED",
    "OFFICIALLY_VERIFIED",
    "NEEDS_REVERIFICATION",
  ];

  it.each(visibleTargets)(
    "AI_EXTRACTION can never transition UNCONFIRMED -> %s",
    (to) => {
      const r = evaluateTransition({ from: "UNCONFIRMED", to, trigger: "AI_EXTRACTION" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("ai-cannot-publish");
    },
  );

  it("AI_EXTRACTION is rejected regardless of from/to", () => {
    const r = evaluateTransition({
      from: "COMMUNITY_VERIFIED",
      to: "OFFICIALLY_VERIFIED",
      trigger: "AI_EXTRACTION",
    });
    expect(r.ok).toBe(false);
  });
});

describe("isPubliclyVisible", () => {
  it("only COMMUNITY_VERIFIED, OFFICIALLY_VERIFIED, NEEDS_REVERIFICATION are visible", () => {
    expect(isPubliclyVisible("COMMUNITY_VERIFIED")).toBe(true);
    expect(isPubliclyVisible("OFFICIALLY_VERIFIED")).toBe(true);
    expect(isPubliclyVisible("NEEDS_REVERIFICATION")).toBe(true);
    expect(isPubliclyVisible("UNCONFIRMED")).toBe(false);
    expect(isPubliclyVisible("STALE")).toBe(false);
    expect(isPubliclyVisible("REJECTED")).toBe(false);
  });
});

describe("confidenceScore (deterministic ordering)", () => {
  const now = new Date("2026-09-29T00:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  it("recent official > recent community > needs-reverif > stale > unconfirmed", () => {
    const official = confidenceScore({
      status: "OFFICIALLY_VERIFIED",
      lastVerifiedAt: daysAgo(10),
      now,
    });
    const community = confidenceScore({
      status: "COMMUNITY_VERIFIED",
      lastVerifiedAt: daysAgo(10),
      now,
    });
    const needs = confidenceScore({
      status: "NEEDS_REVERIFICATION",
      lastVerifiedAt: daysAgo(10),
      now,
    });
    const stale = confidenceScore({ status: "STALE", lastVerifiedAt: daysAgo(10), now });
    const unconf = confidenceScore({ status: "UNCONFIRMED", lastVerifiedAt: null, now });
    expect(official).toBeGreaterThan(community);
    expect(community).toBeGreaterThan(needs);
    expect(needs).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThan(unconf);
  });

  it("ages down official past 180d and community past 90d", () => {
    expect(
      confidenceScore({ status: "OFFICIALLY_VERIFIED", lastVerifiedAt: daysAgo(200), now }),
    ).toBeLessThan(
      confidenceScore({ status: "OFFICIALLY_VERIFIED", lastVerifiedAt: daysAgo(10), now }),
    );
    expect(
      confidenceScore({ status: "COMMUNITY_VERIFIED", lastVerifiedAt: daysAgo(120), now }),
    ).toBeLessThan(
      confidenceScore({ status: "COMMUNITY_VERIFIED", lastVerifiedAt: daysAgo(10), now }),
    );
  });
});
