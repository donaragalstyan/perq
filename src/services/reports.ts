/**
 * perq — community reports service (DB-touching).
 *
 * Responsibilities:
 *  - Insert a normalized community report, enforcing one-confirmation-per-account-per-claim
 *    via the UNIQUE(reporterUserId, claimKey) constraint.
 *  - After each report, count DISTINCT reporters for the report's claimKey and, when an
 *    UNCONFIRMED discount reaches quorum (>=3), promote it to COMMUNITY_VERIFIED via the
 *    pure state machine, writing the status + a StateTransition audit row.
 *
 * The state machine (src/domain/stateMachine) is the ONLY authority on transition legality;
 * this service never writes verificationStatus without a successful evaluateTransition.
 */
import type { Pool, PoolClient } from "pg";
import { claimKey as deriveClaimKey } from "../domain/normalization.js";
import { evaluateTransition } from "../domain/stateMachine.js";
import type { CredentialType, DiscountType, NormalizedClaim } from "../domain/types.js";
import { runConflictCheck, type ConflictOutcome } from "./conflict.js";

export const QUORUM = 3;

export interface SubmitReportInput {
  businessId: string;
  discountId: string;
  reporterUserId: string;
  rawText?: string;
  normalized: NormalizedClaim;
  worked: boolean;
}

export interface SubmitReportResult {
  reportId: string;
  claimKey: string;
  /** distinct reporters for this claimKey after insertion */
  distinctReporters: number;
  promoted: boolean;
  /** true if this exact (reporter, claim) already existed — no double counting */
  duplicate: boolean;
  /** conflict-detection outcome when the report targeted an already-verified discount */
  conflict?: ConflictOutcome;
}

/**
 * Submit a community report and, if quorum is reached, promote the discount. Runs in a single
 * transaction so the count + promotion are consistent.
 */
export async function submitReport(
  pool: Pool,
  input: SubmitReportInput,
): Promise<SubmitReportResult> {
  const key = deriveClaimKey(input.businessId, input.normalized);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await insertReport(client, input, key);
    if (!inserted.reportId) {
      // Unique violation: this account already confirmed this claim. No double count.
      await client.query("COMMIT");
      const distinct = await countDistinctReporters(client, input.businessId, key);
      return {
        reportId: "",
        claimKey: key,
        distinctReporters: distinct,
        promoted: false,
        duplicate: true,
      };
    }

    const distinctReporters = await countDistinctReporters(client, input.businessId, key);

    let promoted = false;
    if (distinctReporters >= QUORUM) {
      promoted = await maybePromote(client, input.discountId, key);
    }

    // If the discount is already COMMUNITY_VERIFIED (and we didn't just promote it), a new
    // report may contradict it — run deterministic conflict detection.
    let conflict: ConflictOutcome = { changed: false };
    if (!promoted) {
      conflict = await runConflictCheck(client, input.discountId);
    }

    await client.query("COMMIT");
    return {
      reportId: inserted.reportId,
      claimKey: key,
      distinctReporters,
      promoted,
      duplicate: false,
      conflict,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertReport(
  client: PoolClient,
  input: SubmitReportInput,
  key: string,
): Promise<{ reportId: string | null }> {
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO community_reports
         (id, "businessId", "discountId", "reporterUserId", "rawText",
          "normalizedType", "normalizedValue", "normalizedCurrency", "normalizedCredential",
          worked, "claimKey")
       VALUES (gen_random_uuid(), $1, $2, $3, $4,
               $5::"DiscountType", $6, $7, $8::"CredentialType", $9, $10)
       RETURNING id`,
      [
        input.businessId,
        input.discountId,
        input.reporterUserId,
        input.rawText ?? null,
        input.normalized.discountType satisfies DiscountType,
        input.normalized.discountValue,
        input.normalized.currency,
        input.normalized.credentialType satisfies CredentialType,
        input.worked,
        key,
      ],
    );
    return { reportId: rows[0]!.id };
  } catch (err) {
    // 23505 = unique_violation (reporterUserId, claimKey): one confirmation per account.
    if (isUniqueViolation(err)) return { reportId: null };
    throw err;
  }
}

async function countDistinctReporters(
  client: PoolClient,
  businessId: string,
  key: string,
): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT COUNT(DISTINCT "reporterUserId")::text AS n
       FROM community_reports
      WHERE "businessId" = $1 AND "claimKey" = $2`,
    [businessId, key],
  );
  return Number(rows[0]?.n ?? "0");
}

/** Promote an UNCONFIRMED discount to COMMUNITY_VERIFIED via the state machine. */
async function maybePromote(
  client: PoolClient,
  discountId: string,
  key: string,
): Promise<boolean> {
  const { rows } = await client.query<{ verificationStatus: string }>(
    `SELECT "verificationStatus" FROM discounts WHERE id = $1 FOR UPDATE`,
    [discountId],
  );
  const current = rows[0]?.verificationStatus;
  if (current !== "UNCONFIRMED") return false; // only promote from UNCONFIRMED

  const decision = evaluateTransition({
    from: "UNCONFIRMED",
    to: "COMMUNITY_VERIFIED",
    trigger: "COMMUNITY_QUORUM",
  });
  if (!decision.ok) return false;

  await client.query(
    `UPDATE discounts
        SET "verificationStatus" = 'COMMUNITY_VERIFIED'::"VerificationStatus",
            "lastVerifiedAt" = now(),
            "updatedAt" = now()
      WHERE id = $1`,
    [discountId],
  );
  await client.query(
    `INSERT INTO state_transitions (id, "discountId", "fromStatus", "toStatus", reason)
     VALUES (gen_random_uuid(), $1, 'UNCONFIRMED'::"VerificationStatus",
             'COMMUNITY_VERIFIED'::"VerificationStatus", $2)`,
    [discountId, `${decision.reason} (claimKey=${key})`],
  );
  return true;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}
