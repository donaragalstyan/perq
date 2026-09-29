---
inclusion: always
---

# perq — AI and Evidence Rules

## The invariant (non-negotiable)

> **An AI-generated claim is never sufficient evidence by itself for publicly
> displaying a student discount.**

This is the soul of perq. Every AI-related decision defers to it.

## What AI is allowed to do

The LLM (Amazon Bedrock) may perform bounded, supporting tasks:

- **Discovery** (post-MVP): propose candidate businesses/attractions.
- **Extraction**: from an allowlisted official page, extract a *candidate* structured
  claim: `{ discountType, discountValue, currency?, acceptedCredentials[], sourceSnippet }`.
- **Classification / normalization**: map free-form community reports into a normalized
  shape for the app to compare.

## What AI is NEVER allowed to do

- Make the **final** decision that two reports "materially match." The application does
  that deterministically via `claimKey`.
- Move a discount into a **publicly visible** state.
- Assert **eligibility** for a user. The eligibility engine is deterministic.
- Act as the **source of truth**. Evidence is the source of truth.

## Evidence is the source of truth

Every discount that becomes publicly visible must be backed by one of:

- **Official evidence**: a first-party `sourceUrl` (official business site, official
  ticketing/admissions page) + a preserved `sourceSnippet` + `checkedAt` date.
- **Community quorum**: >= 3 unique accounts independently submitting materially
  matching reports.

AI extraction produces **AI_EXTRACTION** evidence, which:

- always preserves the original `sourceSnippet` (the proof),
- lands the discount in `UNCONFIRMED` (invisible),
- requires a **human** to attach/confirm official evidence to reach
  `OFFICIALLY_VERIFIED`, OR requires community quorum.

## Extraction endpoint rules (MVP)

- **Human-triggered** only. No autonomous crawling in the MVP.
- **Allowlist** of domains; block private/link-local IP ranges; disallow redirects to
  internal addresses; enforce timeout + response-size caps (SSRF guard — see
  `security.md`).
- **Strict JSON schema** validation on the model output. Reject on schema failure.
- Always store the source snippet alongside the extracted structure.

## Presentation honesty

- Show `verificationStatus`, `lastVerifiedAt`, and a plain-language eligibility reason.
- Never present AI-derived, unconfirmed data as if a human or community had verified it.
- When evidence conflicts, lower confidence and move toward `NEEDS_REVERIFICATION`
  rather than silently keeping the old value.
