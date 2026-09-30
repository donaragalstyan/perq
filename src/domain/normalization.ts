/**
 * perq — report normalization + claimKey derivation (PURE, deterministic).
 *
 * This module turns messy human input into a normalized claim and derives a deterministic
 * `claimKey`. The claimKey is how the application decides whether two reports "materially
 * match" (equal claimKey => same underlying claim). No LLM is involved: an LLM may later
 * *pre-fill* normalized fields, but the FINAL match decision is this deterministic code
 * (see .kiro/steering/ai-and-evidence.md).
 *
 * Design bias (trust-first): when normalization is uncertain, prefer producing a DIFFERENT
 * claimKey so ambiguous reports are treated as different claims rather than wrongly merged.
 */
import type { CredentialType, NormalizedClaim } from "./types.js";

/**
 * Build the value bucket used inside the claimKey.
 * - PERCENT: integer percent, "P:<n>"
 * - FIXED / SPECIAL_PRICE: "F:<CUR>:<amount>" / "S:<CUR>:<amount>" (amount to 2 dp)
 * - FREE / NONE: constant token
 */
export function valueBucket(claim: NormalizedClaim): string {
  switch (claim.discountType) {
    case "PERCENT": {
      const pct = claim.discountValue ?? 0;
      return `P:${Math.round(pct)}`;
    }
    case "FIXED":
    case "SPECIAL_PRICE": {
      const prefix = claim.discountType === "FIXED" ? "F" : "S";
      const cur = (claim.currency ?? "XXX").toUpperCase();
      const amt = (claim.discountValue ?? 0).toFixed(2);
      return `${prefix}:${cur}:${amt}`;
    }
    case "FREE":
      return "FREE";
    case "NONE":
      return "NONE";
  }
}

/**
 * Deterministic claimKey for a business + normalized claim.
 * Format: `<businessId>|<discountType>|<valueBucket>|<credentialType>`.
 * Equal claimKey <=> the reports are the same underlying claim.
 */
export function claimKey(businessId: string, claim: NormalizedClaim): string {
  return [businessId, claim.discountType, valueBucket(claim), claim.credentialType].join(
    "|",
  );
}

// ---------------------------------------------------------------------------
// Free-form text normalization (deterministic parser for common shapes)
// ---------------------------------------------------------------------------

const CREDENTIAL_PATTERNS: ReadonlyArray<readonly [RegExp, CredentialType]> = [
  [/\bisic\b/i, "ISIC"],
  [/\bunidays\b/i, "UNIDAYS"],
  [/\bstudent\s*beans\b/i, "STUDENT_BEANS"],
  [/\b(\.edu|edu\s*email|student\s*email|school\s*email)\b/i, "EDU_EMAIL"],
  // "college card", "student id/card", "physical id", "school id"
  [/\b(student|college|school)\s*(id|card)\b/i, "PHYSICAL_STUDENT_ID"],
  [/\bphysical\s*(id|card)\b/i, "PHYSICAL_STUDENT_ID"],
  [/\b(any\s*)?(university|uni)\s*(id|card)\b/i, "ANY_UNIVERSITY_ID"],
];

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "Kč": "CZK",
};

/** Detect a SPECIFIC credential type from free text, or null if the text names none. */
export function detectSpecificCredential(text: string): CredentialType | null {
  for (const [re, cred] of CREDENTIAL_PATTERNS) {
    if (re.test(text)) return cred;
  }
  return null;
}

/** Detect a credential type from free text alone (specific match, else bare-student
 *  fallback to PHYSICAL_STUDENT_ID, else OTHER). */
export function detectCredential(text: string): CredentialType {
  const specific = detectSpecificCredential(text);
  if (specific) return specific;
  if (/\bstudents?\b/i.test(text)) return "PHYSICAL_STUDENT_ID";
  return "OTHER";
}

/**
 * Resolve the credential for a claim: a specific credential named in the text wins; else the
 * structured submission hint; else text-only inference. Keeps the decision deterministic.
 */
export function resolveCredential(
  text: string,
  hint?: CredentialType,
): CredentialType {
  const specific = detectSpecificCredential(text);
  if (specific) return specific;
  if (hint) return hint;
  return detectCredential(text);
}

/**
 * Parse free-form text into a NormalizedClaim.
 *
 * Handles the common shapes seen in real reports:
 *   - "15% off", "15 percent off", "Student ID = 15% off"  -> PERCENT 15
 *   - "€2 off", "$5 off"                                    -> FIXED amount+currency
 *   - "student price €8", "students: 8 EUR"                 -> SPECIAL_PRICE amount+currency
 *   - "free entry", "free for students"                     -> FREE
 *   - "no discount", "didn't work", "no student discount"   -> NONE (worked=false semantics)
 *
 * `credentialHint` is the credential the reporter selected in the structured submission
 * field (per Requirement 6.1, a report carries `normalizedCredential`). Text detection wins
 * when it finds a SPECIFIC credential in the free text; otherwise the hint is used; otherwise
 * we fall back to text-only inference. This is why the canonical examples ("15% off",
 * "...college card", "Student ID = 15% off") share a claimKey when reported in the same
 * student-ID context (Requirement 6.4) — deterministically, with no LLM (Requirement 6.5).
 *
 * Returns null when no discount shape is recognizable (caller treats as unparseable rather
 * than guessing — trust-first).
 */
export function normalizeText(
  rawText: string,
  credentialHint?: CredentialType,
): NormalizedClaim | null {
  const text = rawText.trim();
  if (text === "") return null;

  const credentialType = resolveCredential(text, credentialHint);

  // NONE / negative reports first (so "no student discount" doesn't match "student").
  if (/\b(no|not|without)\b[^.]*\bdiscount\b/i.test(text) || /\bdid\s*n['o]?t\s*work\b/i.test(text)) {
    return { discountType: "NONE", discountValue: null, currency: null, credentialType };
  }

  // FREE
  if (/\bfree\b/i.test(text)) {
    return { discountType: "FREE", discountValue: null, currency: null, credentialType };
  }

  // PERCENT: "15%", "15 percent", "15 % off".
  // Note: no trailing \b after the group — "%" is not a word char, so \b would fail
  // before a following space (both non-word). Use a lookahead for word forms instead.
  const pct = text.match(/(\d{1,3})\s*(?:%|percent\b|pct\b)/i);
  if (pct && pct[1] !== undefined) {
    return {
      discountType: "PERCENT",
      discountValue: Number(pct[1]),
      currency: null,
      credentialType,
    };
  }

  // Currency amount: symbol or ISO code with a number, e.g. "€8", "$5", "8 EUR", "Kč120".
  const money = detectMoney(text);
  if (money) {
    // "student price / students: <amount>" reads as a SPECIAL_PRICE; "<amount> off" as FIXED.
    const isSpecialPrice = /\b(price|students?\s*:|student\s*price)\b/i.test(text);
    return {
      discountType: isSpecialPrice ? "SPECIAL_PRICE" : "FIXED",
      discountValue: money.amount,
      currency: money.currency,
      credentialType,
    };
  }

  return null;
}

interface Money {
  amount: number;
  currency: string;
}

/** Detect a monetary amount + ISO currency from text. Returns null if none found. */
export function detectMoney(text: string): Money | null {
  // Symbol-prefixed: €8, $5, £3, Kč120
  const sym = text.match(/(Kč|[$€£])\s*(\d+(?:[.,]\d{1,2})?)/);
  if (sym && sym[1] !== undefined && sym[2] !== undefined) {
    const currency = CURRENCY_SYMBOLS[sym[1]] ?? "XXX";
    return { amount: parseAmount(sym[2]), currency };
  }
  // Amount then ISO code: "8 EUR", "120 CZK", "5 USD"
  const iso = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(USD|EUR|GBP|CZK)\b/i);
  if (iso && iso[1] !== undefined && iso[2] !== undefined) {
    return { amount: parseAmount(iso[1]), currency: iso[2].toUpperCase() };
  }
  return null;
}

function parseAmount(s: string): number {
  return Number(s.replace(",", "."));
}
