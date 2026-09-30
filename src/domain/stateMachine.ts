/**
 * perq — verification state machine (PURE, deterministic).
 *
 * This module is the single source of truth for which discount verification transitions are
 * legal and why. It does NOT touch the database: callers pass the current state and a
 * requested transition, and receive either a validated transition (to persist, with an audit
 * reason) or a rejection. The persistence layer (later tasks) is the only code that writes
 * `verificationStatus`, and it must go through here first.
 *
 * Invariant (ai-and-evidence.md): AI extraction can never move a discount into a publicly
 * visible state. That is enforced structurally here — the only transitions that reach a
 * visible state are community quorum and privileged official evidence.
 */
import type { VerificationStatus } from "./types.js";

/** The publicly visible states. NEEDS_REVERIFICATION is visible but flagged. */
export const PUBLICLY_VISIBLE: ReadonlySet<VerificationStatus> = new Set([
  "COMMUNITY_VERIFIED",
  "OFFICIALLY_VERIFIED",
  "NEEDS_REVERIFICATION",
]);

/**
 * What is driving a transition. This lets the state machine enforce, e.g., that AI evidence
 * can never publish and that only privileged actors can force certain transitions.
 */
export type TransitionTrigger =
  | "COMMUNITY_QUORUM" // >=3 unique accounts agreed (deterministic, computed by caller)
  | "OFFICIAL_EVIDENCE" // privileged actor attached valid official evidence
  | "AI_EXTRACTION" // AI produced a candidate — may NEVER publish
  | "CONFLICT_DETECTED" // deterministic conflict rule tripped
  | "COMMUNITY_SUPERSEDE" // a competing claim reached quorum
  | "STALE_TIMEOUT" // no resolution within window
  | "ADMIN"; // privileged moderation (e.g., REJECTED)

export interface TransitionRequest {
  from: VerificationStatus;
  to: VerificationStatus;
  trigger: TransitionTrigger;
}

export type TransitionResult =
  | { ok: true; from: VerificationStatus; to: VerificationStatus; reason: string }
  | { ok: false; reason: string };

/**
 * Legal (from -> to) edges keyed by trigger. An edge is legal only if the requested trigger
 * is listed for that transition. This is the whole ruleset; nothing else may change state.
 */
const LEGAL: ReadonlyArray<{
  from: VerificationStatus;
  to: VerificationStatus;
  triggers: ReadonlySet<TransitionTrigger>;
}> = [
  // Community quorum promotes an unconfirmed discount to visible.
  { from: "UNCONFIRMED", to: "COMMUNITY_VERIFIED", triggers: new Set(["COMMUNITY_QUORUM"]) },

  // Official evidence (privileged) can make any non-terminal state officially verified.
  ...(
    [
      "UNCONFIRMED",
      "COMMUNITY_VERIFIED",
      "NEEDS_REVERIFICATION",
      "STALE",
    ] as VerificationStatus[]
  ).map((from) => ({
    from,
    to: "OFFICIALLY_VERIFIED" as VerificationStatus,
    triggers: new Set<TransitionTrigger>(["OFFICIAL_EVIDENCE"]),
  })),

  // Conflict lowers trust: verified -> needs reverification.
  {
    from: "COMMUNITY_VERIFIED",
    to: "NEEDS_REVERIFICATION",
    triggers: new Set(["CONFLICT_DETECTED"]),
  },
  {
    from: "OFFICIALLY_VERIFIED",
    to: "NEEDS_REVERIFICATION",
    triggers: new Set(["CONFLICT_DETECTED"]),
  },

  // Resolution of a flagged discount by a new competing quorum.
  {
    from: "NEEDS_REVERIFICATION",
    to: "COMMUNITY_VERIFIED",
    triggers: new Set(["COMMUNITY_SUPERSEDE"]),
  },

  // No resolution within the window -> stale (hidden/de-emphasized).
  {
    from: "NEEDS_REVERIFICATION",
    to: "STALE",
    triggers: new Set(["STALE_TIMEOUT"]),
  },

  // Admin moderation to REJECTED from any state.
  ...(
    [
      "UNCONFIRMED",
      "COMMUNITY_VERIFIED",
      "OFFICIALLY_VERIFIED",
      "NEEDS_REVERIFICATION",
      "STALE",
    ] as VerificationStatus[]
  ).map((from) => ({
    from,
    to: "REJECTED" as VerificationStatus,
    triggers: new Set<TransitionTrigger>(["ADMIN"]),
  })),
];

/**
 * Validate a requested transition. Returns a validated transition (with an audit reason) or
 * a rejection. Never throws for a merely-illegal transition; throwing is reserved for
 * programmer error.
 */
export function evaluateTransition(req: TransitionRequest): TransitionResult {
  // Hard invariant: AI extraction may never publish or change a visible state. AI candidates
  // stay in UNCONFIRMED; the only legal "AI" outcome is a no-op keep-in-UNCONFIRMED, which
  // callers handle without a transition. So any AI_EXTRACTION-triggered transition is illegal.
  if (req.trigger === "AI_EXTRACTION") {
    return {
      ok: false,
      reason:
        "ai-cannot-publish: AI_EXTRACTION evidence alone cannot transition a discount (must stay UNCONFIRMED)",
    };
  }

  if (req.from === req.to) {
    return { ok: false, reason: `no-op transition ${req.from} -> ${req.to}` };
  }

  const edge = LEGAL.find((e) => e.from === req.from && e.to === req.to);
  if (!edge) {
    return { ok: false, reason: `illegal transition ${req.from} -> ${req.to}` };
  }
  if (!edge.triggers.has(req.trigger)) {
    return {
      ok: false,
      reason: `trigger ${req.trigger} not allowed for ${req.from} -> ${req.to}`,
    };
  }

  return {
    ok: true,
    from: req.from,
    to: req.to,
    reason: `${req.trigger}: ${req.from} -> ${req.to}`,
  };
}

/** Is this state visible to the public? */
export function isPubliclyVisible(status: VerificationStatus): boolean {
  return PUBLICLY_VISIBLE.has(status);
}

// ---------------------------------------------------------------------------
// Confidence score (deterministic, for sorting only — NOT a probability)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConfidenceInput {
  status: VerificationStatus;
  /** Most recent verification/official-check timestamp, if any. */
  lastVerifiedAt: Date | null;
  /** "Now", injectable for deterministic tests. */
  now?: Date;
}

/**
 * Deterministic confidence used only to order results. Higher = show first.
 *   OFFICIALLY_VERIFIED & checked < 180d -> 100
 *   COMMUNITY_VERIFIED  & verified < 90d -> 70
 *   NEEDS_REVERIFICATION                 -> 30
 *   STALE                                -> 10
 *   otherwise                            -> 0
 */
export function confidenceScore(input: ConfidenceInput): number {
  const now = input.now ?? new Date();
  const ageDays =
    input.lastVerifiedAt === null
      ? Infinity
      : (now.getTime() - input.lastVerifiedAt.getTime()) / DAY_MS;

  switch (input.status) {
    case "OFFICIALLY_VERIFIED":
      return ageDays < 180 ? 100 : 40;
    case "COMMUNITY_VERIFIED":
      return ageDays < 90 ? 70 : 25;
    case "NEEDS_REVERIFICATION":
      return 30;
    case "STALE":
      return 10;
    default:
      return 0;
  }
}
