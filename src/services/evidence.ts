/**
 * perq — evidence service (DB-touching).
 *
 * Attaches evidence to a discount. Two flows matter for trust:
 *   - Official evidence attached by a PRIVILEGED actor may transition a discount to
 *     OFFICIALLY_VERIFIED (via the state machine).
 *   - AI_EXTRACTION evidence is stored as a candidate proof but can NEVER move the discount
 *     into a publicly visible state (ai-and-evidence.md invariant). It only ever
 *     keeps/places the discount in UNCONFIRMED.
 *
 * `createdByUserId` is stored for provenance but is NEVER selected by any public query
 * (see src/services/publicQueries.ts).
 */
import type { Pool, PoolClient } from "pg";
import { evaluateTransition } from "../domain/stateMachine.js";
import type { VerificationStatus } from "../domain/types.js";

export type EvidenceType =
  | "OFFICIAL_WEBSITE"
  | "TICKETING_PAGE"
  | "AI_EXTRACTION"
  | "COMMUNITY_REPORT"
  | "RECEIPT_PHOTO";

const OFFICIAL_TYPES: ReadonlySet<EvidenceType> = new Set([
  "OFFICIAL_WEBSITE",
  "TICKETING_PAGE",
]);

export interface AttachEvidenceInput {
  discountId: string;
  evidenceType: EvidenceType;
  sourceUrl?: string;
  sourceSnippet?: string;
  checkedAt?: Date;
  createdByUserId?: string;
  /** Whether the caller is a privileged actor (admin/reviewer). Only privileged actors may
   *  drive an official-evidence transition to OFFICIALLY_VERIFIED. Enforced here. */
  privileged?: boolean;
}

export interface AttachEvidenceResult {
  evidenceId: string;
  /** The discount's status after attaching (may be unchanged). */
  status: VerificationStatus;
  transitioned: boolean;
}

export async function attachEvidence(
  pool: Pool,
  input: AttachEvidenceInput,
): Promise<AttachEvidenceResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const evidenceId = await insertEvidence(client, input);

    // Lock the discount and read current status.
    const dres = await client.query<{ verificationStatus: VerificationStatus }>(
      `SELECT "verificationStatus" FROM discounts WHERE id = $1 FOR UPDATE`,
      [input.discountId],
    );
    const current = dres.rows[0]?.verificationStatus;
    if (!current) {
      throw new Error(`discount ${input.discountId} not found`);
    }

    let status: VerificationStatus = current;
    let transitioned = false;

    if (input.evidenceType === "AI_EXTRACTION") {
      // Invariant: AI evidence can never publish. Confirm via the state machine that any
      // attempt to move to a visible state is rejected, then leave the status unchanged.
      const attempt = evaluateTransition({
        from: current,
        to: "OFFICIALLY_VERIFIED",
        trigger: "AI_EXTRACTION",
      });
      // attempt.ok is always false by construction; we assert it to be defensive.
      if (attempt.ok) {
        throw new Error("invariant violation: AI_EXTRACTION must never transition");
      }
      // no-op: discount stays in its current (e.g., UNCONFIRMED) state.
    } else if (OFFICIAL_TYPES.has(input.evidenceType)) {
      if (!input.privileged) {
        // Non-privileged actors may store official-looking evidence, but it does NOT drive a
        // transition. (Authorization boundary: only privileged actors verify officially.)
      } else {
        const decision = evaluateTransition({
          from: current,
          to: "OFFICIALLY_VERIFIED",
          trigger: "OFFICIAL_EVIDENCE",
        });
        if (decision.ok) {
          await client.query(
            `UPDATE discounts
                SET "verificationStatus" = 'OFFICIALLY_VERIFIED'::"VerificationStatus",
                    "lastVerifiedAt" = now(),
                    "confidenceScore" = 100,
                    "updatedAt" = now()
              WHERE id = $1`,
            [input.discountId],
          );
          await client.query(
            `INSERT INTO state_transitions (id, "discountId", "fromStatus", "toStatus", reason)
             VALUES (gen_random_uuid(), $1, $2::"VerificationStatus",
                     'OFFICIALLY_VERIFIED'::"VerificationStatus", $3)`,
            [input.discountId, current, decision.reason],
          );
          status = "OFFICIALLY_VERIFIED";
          transitioned = true;
        }
      }
    }
    // COMMUNITY_REPORT / RECEIPT_PHOTO evidence never transitions by itself here.

    await client.query("COMMIT");
    return { evidenceId, status, transitioned };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertEvidence(
  client: PoolClient,
  input: AttachEvidenceInput,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO evidence
       (id, "discountId", "evidenceType", "sourceUrl", "sourceSnippet", "checkedAt",
        "createdByUserId")
     VALUES (gen_random_uuid(), $1, $2::"EvidenceType", $3, $4, $5, $6)
     RETURNING id`,
    [
      input.discountId,
      input.evidenceType,
      input.sourceUrl ?? null,
      input.sourceSnippet ?? null,
      input.checkedAt ?? new Date(),
      input.createdByUserId ?? null,
    ],
  );
  return rows[0]!.id;
}
