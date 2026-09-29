---
inclusion: always
---

# perq — Testing Standards

## Philosophy

We do not chase coverage numbers. We test the code that, if wrong, would cause perq to
**display a discount a student cannot actually use** — because trust is the product.

## Must-have tests (non-negotiable)

These deterministic pieces are the core of perq's trustworthiness and must be tested:

1. **Report normalization** — free-form text -> normalized `{ type, value, credential }`.
   Include the canonical examples ("15% off", "They took 15 percent off when I showed my
   college card", "Student ID = 15% off") all mapping to the same normalized claim.
2. **claimKey matching** — reports that should match do; reports that should NOT match
   (e.g., "15%" vs "15% with ISIC", percent vs currency) do not. Bias toward treating
   ambiguous cases as *different* claims.
3. **Community quorum promotion** — 3 unique accounts -> `COMMUNITY_VERIFIED`; the same
   account reporting 3 times does **not** promote (uniqueness enforced).
4. **State machine transitions** — every legal transition works; illegal transitions are
   rejected; AI extraction can never reach a publicly visible state without a human/quorum.
5. **Eligibility engine** — LIKELY / ADDITIONAL_REQUIREMENTS / UNKNOWN for representative
   credential/discount combinations, including country restrictions.
6. **Spatial queries** — within-radius, nearest, viewport return correct rows against a
   known fixture set (seed a handful of Seattle + Prague points with known distances).
7. **Conflict detection** — a `COMMUNITY_VERIFIED` claim transitions to
   `NEEDS_REVERIFICATION` only when >= 3 unique accounts submit *agreeing*, *more-recent*
   (within the 90-day window) contradicting reports; noise / stale / single-account
   contradictions do NOT trip it; a new competing claim reaching quorum can supersede.

## Security-sensitive tests

- **SSRF guard**: private/link-local IPs and non-allowlisted domains are rejected;
  redirects to internal addresses are blocked.
- **Authz**: a user cannot read/modify another user's profile; community endpoints
  cannot set `verificationStatus`.

## Practices

- Deterministic domain logic is tested as **pure unit tests** (no DB, no network).
- Spatial and DB logic tested against a **local Docker PostGIS** with fixtures.
- Do not add tests for trivial glue. Do not skip tests for the six must-haves above.
- Tests should run in CI and via the post-task hook.
