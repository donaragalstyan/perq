/**
 * perq domain types (pure).
 *
 * These mirror the Prisma enums but are declared independently so the domain layer stays
 * free of any ORM/DB dependency and is trivially unit-testable. Keep the string values
 * identical to the Prisma enum names.
 */

export type DiscountType = "PERCENT" | "FIXED" | "SPECIAL_PRICE" | "FREE" | "NONE";

export type CredentialType =
  | "PHYSICAL_STUDENT_ID"
  | "EDU_EMAIL"
  | "ANY_UNIVERSITY_ID"
  | "ISIC"
  | "UNIDAYS"
  | "STUDENT_BEANS"
  | "OTHER";

export type VerificationStatus =
  | "UNCONFIRMED"
  | "COMMUNITY_VERIFIED"
  | "OFFICIALLY_VERIFIED"
  | "NEEDS_REVERIFICATION"
  | "STALE"
  | "REJECTED";

/** A normalized discount claim: the structured shape the app reasons about. */
export interface NormalizedClaim {
  discountType: DiscountType;
  /** Percent (for PERCENT) or amount (for FIXED/SPECIAL_PRICE). Null for FREE/NONE. */
  discountValue: number | null;
  /** ISO 4217, required for FIXED/SPECIAL_PRICE. */
  currency: string | null;
  credentialType: CredentialType;
}
