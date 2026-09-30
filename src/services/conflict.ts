/**
 * perq — conflict detection service (DB-integrated).
 *
 * Given a COMMUNITY_VERIFIED discount and a new/relevant report, gather recent contradicting
 * reports for the same business, run the PURE decision (src/domain/conflict), and apply the
 * resulting transition through the state machine:
 *   - conflict, non-supersede -> NEEDS_REVERIFICATION (trigger CONFLICT_DETECTED)
 *   - conflict, supersede      -> stays/returns COMMUNITY_VERIFIED with the new value
 *
 * All decisions are deterministic; this layer only fetches inputs and persists outcomes.
 */
import type { PoolClient } from "pg";
import {
  evaluateConflict,
  type ContradictingReport,
} from "../domain/conflict.js";
import { evaluateTransition } from "../domain/stateMachine.js";

export interface ConflictOutcome {
  changed: boolean;
  to?: "NEEDS_REVERIFICATION";
  competingKey?: string;
  /** True when the competing claim reached quorum and is eligible for LATER supersession.
   *  Phase 1 records this but does not act on it (flag-first). */
  supersedeEligible?: boolean;
}

/**
 * Run conflict detection for a discount that is currently COMMUNITY_VERIFIED. Must be called
 * within an open transaction (client). Returns what changed, if anything.
 */
export async function runConflictCheck(
  client: PoolClient,
  discountId: string,
  now: Date = new Date(),
): Promise<ConflictOutcome> {
  // Load the discount with a row lock.
  const dres = await client.query<{
    businessId: string;
    verificationStatus: string;
    lastVerifiedAt: Date | null;
  }>(
    `SELECT "businessId", "verificationStatus", "lastVerifiedAt"
       FROM discounts WHERE id = $1 FOR UPDATE`,
    [discountId],
  );
  const discount = dres.rows[0];
  if (!discount || discount.verificationStatus !== "COMMUNITY_VERIFIED") {
    return { changed: false };
  }
  if (discount.lastVerifiedAt === null) return { changed: false };

  // Determine the verified claimKey: the claimKey shared by the reports that promoted it.
  // We take the modal claimKey among reports created at/before lastVerifiedAt for this biz.
  const vkeyRes = await client.query<{ claimKey: string }>(
    `SELECT "claimKey"
       FROM community_reports
      WHERE "businessId" = $1 AND "createdAt" <= $2
      GROUP BY "claimKey"
      ORDER BY COUNT(DISTINCT "reporterUserId") DESC, "claimKey" ASC
      LIMIT 1`,
    [discount.businessId, discount.lastVerifiedAt],
  );
  const verifiedKey = vkeyRes.rows[0]?.claimKey;
  if (!verifiedKey) return { changed: false };

  // Gather candidate contradicting reports for the business.
  const rres = await client.query<{
    reporterUserId: string;
    claimKey: string;
    normalizedType: string;
    worked: boolean;
    createdAt: Date;
  }>(
    `SELECT "reporterUserId", "claimKey", "normalizedType", worked, "createdAt"
       FROM community_reports
      WHERE "businessId" = $1`,
    [discount.businessId],
  );

  const reports: ContradictingReport[] = rres.rows.map((r) => ({
    reporterUserId: r.reporterUserId,
    claimKey: r.claimKey,
    isNegative: r.normalizedType === "NONE" || r.worked === false,
    createdAt: r.createdAt,
  }));

  const decision = evaluateConflict({
    verifiedKey,
    lastVerifiedAt: discount.lastVerifiedAt,
    reports,
    now,
  });

  if (!decision.conflict) return { changed: false };

  // FLAG-FIRST (decided 2026-09-29): any conflict moves the discount to NEEDS_REVERIFICATION.
  // A competing claim reaching quorum is recorded as supersede-ELIGIBLE evidence but does NOT
  // perform the supersession here — resolution is deferred to a later re-verification flow.
  const t = evaluateTransition({
    from: "COMMUNITY_VERIFIED",
    to: "NEEDS_REVERIFICATION",
    trigger: "CONFLICT_DETECTED",
  });
  if (!t.ok) return { changed: false };

  await client.query(
    `UPDATE discounts
        SET "verificationStatus" = 'NEEDS_REVERIFICATION'::"VerificationStatus",
            "confidenceScore" = 30,
            "updatedAt" = now()
      WHERE id = $1`,
    [discountId],
  );

  // Preserve the disagreement as structured evidence: verified vs competing claim, the
  // competing reporter count, and whether it is eligible to supersede later. The UI can use
  // this to explain what changed ("Previously verified: X. Recent reports: Y.").
  const reason = JSON.stringify({
    kind: "conflict",
    verifiedKey,
    competingKey: decision.competingKey,
    competingDistinctReporters: decision.distinctAccounts,
    supersedeEligible: decision.supersede, // eligibility only; not applied in Phase 1
  });
  await client.query(
    `INSERT INTO state_transitions (id, "discountId", "fromStatus", "toStatus", reason)
     VALUES (gen_random_uuid(), $1, 'COMMUNITY_VERIFIED'::"VerificationStatus",
             'NEEDS_REVERIFICATION'::"VerificationStatus", $2)`,
    [discountId, reason],
  );

  return {
    changed: true,
    to: "NEEDS_REVERIFICATION",
    competingKey: decision.competingKey,
    supersedeEligible: decision.supersede,
  };
}
