/**
 * perq — conflict detection (PURE, deterministic).
 *
 * Decides whether a COMMUNITY_VERIFIED discount should move to NEEDS_REVERIFICATION because
 * recent reports contradict the verified claim, and whether a competing claim has itself
 * reached quorum (supersede). No scoring, no reputation — only counts, dates, and claimKey
 * equality (Requirement 7, testing steering item 7).
 *
 * Rules (all must hold to flag a conflict):
 *   1. >= 3 UNIQUE accounts submit contradicting reports, where a contradicting report is
 *      one for the same business whose claimKey != verifiedKey, OR a NONE / worked=false
 *      report (all such negatives grouped into one "NONE" bucket).
 *   2. Those contradicting reports were created AFTER the verified claim's lastVerifiedAt.
 *   3. They are within the rolling window (default 90 days).
 *   4. They AGREE with each other: the largest agreeing bucket (by distinct accounts) is the
 *      one evaluated; it must reach the threshold on its own.
 * A competing (non-NONE) bucket that reaches quorum is SUPERSEDE-ELIGIBLE. Flag-first policy
 * (decided 2026-09-29): eligibility is only a signal — the service transitions to
 * NEEDS_REVERIFICATION and records the competing claim; it does NOT apply supersession in
 * Phase 1. A later re-verification flow decides resolution.
 */

export const CONFLICT_WINDOW_DAYS = 90;
export const CONFLICT_THRESHOLD = 3; // same number as community quorum, by design

const DAY_MS = 24 * 60 * 60 * 1000;

/** One contradicting report, reduced to just what the decision needs. */
export interface ContradictingReport {
  reporterUserId: string;
  /** The report's claimKey; for NONE/worked=false reports this is normalized to the NONE
   *  bucket by the caller or by `bucketOf` below. */
  claimKey: string;
  isNegative: boolean; // normalizedType === "NONE" || worked === false
  createdAt: Date;
}

export interface ConflictInput {
  verifiedKey: string;
  lastVerifiedAt: Date;
  reports: ContradictingReport[];
  now?: Date;
  windowDays?: number;
  threshold?: number;
}

export type ConflictDecision =
  | { conflict: false }
  | {
      conflict: true;
      /** The winning contradicting bucket key ("NONE" or a competing claimKey). */
      competingKey: string;
      distinctAccounts: number;
      /** True when the competing bucket is a real (non-NONE) claim that reached the
       *  threshold and is ELIGIBLE for later supersession. Flag-first: this is a signal only;
       *  the service does not apply supersession in Phase 1. */
      supersede: boolean;
    };

const NONE_BUCKET = "NONE";

/** The bucket a report contributes to: negatives collapse to a single NONE bucket. */
export function bucketOf(r: ContradictingReport): string {
  return r.isNegative ? NONE_BUCKET : r.claimKey;
}

/**
 * Evaluate whether a conflict trips. Pure and deterministic.
 */
export function evaluateConflict(input: ConflictInput): ConflictDecision {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? CONFLICT_WINDOW_DAYS;
  const threshold = input.threshold ?? CONFLICT_THRESHOLD;
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS);

  // Keep only genuine contradictions that are recent AND newer than the last verification.
  const relevant = input.reports.filter((r) => {
    const isContradiction = r.isNegative || r.claimKey !== input.verifiedKey;
    const recent = r.createdAt >= windowStart;
    const newerThanVerified = r.createdAt > input.lastVerifiedAt;
    return isContradiction && recent && newerThanVerified;
  });

  if (relevant.length === 0) return { conflict: false };

  // Group by bucket; count DISTINCT accounts per bucket (one confirmation per account).
  const bucketToAccounts = new Map<string, Set<string>>();
  for (const r of relevant) {
    const b = bucketOf(r);
    const set = bucketToAccounts.get(b) ?? new Set<string>();
    set.add(r.reporterUserId);
    bucketToAccounts.set(b, set);
  }

  // Pick the largest agreeing bucket (by distinct accounts); deterministic tie-break by key.
  let best: { key: string; count: number } | null = null;
  for (const [key, accounts] of [...bucketToAccounts.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    const count = accounts.size;
    if (best === null || count > best.count) best = { key, count };
  }

  if (best === null || best.count < threshold) return { conflict: false };

  return {
    conflict: true,
    competingKey: best.key,
    distinctAccounts: best.count,
    supersede: best.key !== NONE_BUCKET, // a real competing claim can supersede; NONE cannot
  };
}
