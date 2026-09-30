/**
 * perq — privacy-safe PUBLIC read queries (DB-touching).
 *
 * These are the shapes returned to end users / the public API. They enforce, by construction:
 *   - Only publicly visible discounts are returned
 *     (COMMUNITY_VERIFIED, OFFICIALLY_VERIFIED, NEEDS_REVERIFICATION).
 *   - Reporter identity is NEVER exposed — only an aggregate confirmation count.
 *   - Evidence `createdByUserId` is NEVER selected.
 *   - No user PII (university, universityCountry, auth ids) is joined or returned.
 *
 * The public DTOs are explicit interfaces with NO private fields, so a future accidental
 * `SELECT *` cannot leak: the mapping only ever reads the whitelisted columns.
 */
import type { Pool } from "pg";
import type { CredentialType, DiscountType, VerificationStatus } from "../domain/types.js";

/** Public shape of a discount. Deliberately contains no user/reporter identity. */
export interface PublicDiscount {
  id: string;
  businessId: string;
  businessName: string;
  category: string;
  discountType: DiscountType;
  discountValue: number | null;
  currency: string | null;
  acceptedCredentials: CredentialType[];
  restrictions: string | null;
  eligibilityNotes: string | null;
  verificationStatus: VerificationStatus;
  confidenceScore: number;
  lastVerifiedAt: string | null; // ISO string
  /** Aggregate only: how many DISTINCT accounts confirmed the currently-verified claim.
   *  Never the identities. */
  confirmationCount: number;
}

/** Public shape of evidence. Never includes createdByUserId. */
export interface PublicEvidence {
  id: string;
  evidenceType: string;
  sourceUrl: string | null;
  sourceSnippet: string | null;
  checkedAt: string; // ISO string
}

const VISIBLE = ["COMMUNITY_VERIFIED", "OFFICIALLY_VERIFIED", "NEEDS_REVERIFICATION"];

/**
 * List publicly visible discounts for a business, highest confidence first. Includes an
 * aggregate confirmation count but no reporter identities.
 */
export async function getPublicDiscountsForBusiness(
  pool: Pool,
  businessId: string,
): Promise<PublicDiscount[]> {
  const { rows } = await pool.query(
    `SELECT d.id,
            d."businessId",
            b.name AS "businessName",
            b.category::text AS category,
            d."discountType"::text AS "discountType",
            d."discountValue",
            d.currency,
            d."acceptedCredentials"::text[] AS "acceptedCredentials",
            d.restrictions,
            d."eligibilityNotes",
            d."verificationStatus"::text AS "verificationStatus",
            d."confidenceScore",
            d."lastVerifiedAt",
            COALESCE((
              SELECT COUNT(DISTINCT cr."reporterUserId")
                FROM community_reports cr
               WHERE cr."businessId" = d."businessId"
            ), 0) AS "confirmationCount"
       FROM discounts d
       JOIN businesses b ON b.id = d."businessId"
      WHERE d."businessId" = $1
        AND d."verificationStatus" = ANY($2::"VerificationStatus"[])
      ORDER BY d."confidenceScore" DESC, d."lastVerifiedAt" DESC NULLS LAST`,
    [businessId, VISIBLE],
  );
  return rows.map(mapPublicDiscount);
}

/** Publicly visible evidence for a discount (no createdByUserId). */
export async function getPublicEvidenceForDiscount(
  pool: Pool,
  discountId: string,
): Promise<PublicEvidence[]> {
  const { rows } = await pool.query(
    `SELECT id, "evidenceType"::text AS "evidenceType", "sourceUrl", "sourceSnippet",
            "checkedAt"
       FROM evidence
      WHERE "discountId" = $1
      ORDER BY "checkedAt" DESC`,
    [discountId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    evidenceType: r.evidenceType as string,
    sourceUrl: (r.sourceUrl as string | null) ?? null,
    sourceSnippet: (r.sourceSnippet as string | null) ?? null,
    checkedAt: (r.checkedAt as Date).toISOString(),
  }));
}

// Row shape returned by the discount query (only whitelisted columns are selected).
interface DiscountRow {
  id: string;
  businessId: string;
  businessName: string;
  category: string;
  discountType: DiscountType;
  discountValue: string | null;
  currency: string | null;
  acceptedCredentials: CredentialType[];
  restrictions: string | null;
  eligibilityNotes: string | null;
  verificationStatus: VerificationStatus;
  confidenceScore: string;
  lastVerifiedAt: Date | null;
  confirmationCount: string;
}

function mapPublicDiscount(row: unknown): PublicDiscount {
  const r = row as DiscountRow;
  return {
    id: r.id,
    businessId: r.businessId,
    businessName: r.businessName,
    category: r.category,
    discountType: r.discountType,
    discountValue: r.discountValue === null ? null : Number(r.discountValue),
    currency: r.currency,
    acceptedCredentials: r.acceptedCredentials ?? [],
    restrictions: r.restrictions,
    eligibilityNotes: r.eligibilityNotes,
    verificationStatus: r.verificationStatus,
    confidenceScore: Number(r.confidenceScore),
    lastVerifiedAt: r.lastVerifiedAt ? r.lastVerifiedAt.toISOString() : null,
    confirmationCount: Number(r.confirmationCount),
  };
}
