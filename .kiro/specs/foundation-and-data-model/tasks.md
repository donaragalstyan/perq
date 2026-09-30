# Foundation and Data Model — Tasks

Implementation plan for the foundation. Tasks are ordered so the PostGIS proof-of-concept
(Task 2) can be validated before the rest of the model is built out. Do not start later
application specs until the POC (Task 2) is validated.

Each task references the requirements it satisfies.

- [ ] 1. Project + local database setup
  - Initialize the Next.js (App Router) + TypeScript (strict) project and Prisma.
  - Add `docker-compose.yml` with a `postgis/postgis` service for local dev.
  - Add `.env.example` (no secrets) with `DATABASE_URL` for local PostGIS.
  - _Requirements: 1, 9.1_

- [ ] 2. PostGIS proof-of-concept (VALIDATE BEFORE PROCEEDING)
  - Create a minimal `businesses` table with `location geography(Point,4326)` via a raw SQL
    migration; `CREATE EXTENSION IF NOT EXISTS postgis`; add the GiST index.
  - Seed ~30 synthetic Seattle + Prague points (`prisma/seed/synthetic.ts`).
  - Implement the spatial data-access module: withinRadius, nearest, withinViewport,
    distanceMeters (parameterized raw SQL).
  - Write integration tests asserting correct rows/distances against the fixture set.
  - _Requirements: 1.1, 1.2, 9.1 — validates the riskiest assumption_

- [ ] 3. Full relational schema in Prisma
  - Model User, UserCredential, Business, Discount, Evidence, CommunityReport,
    StateTransition and all enums.
  - BusinessSource enum = OVERTURE | MANUAL | AI_CANDIDATE | SYNTHETIC; add `externalPlaceId`
    (GERS id) + `importedAt` on Business; index `externalPlaceId`. Internal `Business.id` is
    the FK target for Discount/Evidence/CommunityReport (never `externalPlaceId`).
  - Add uniqueness constraints: `UserCredential(userId, credentialType)`,
    `CommunityReport(reporterUserId, claimKey)`.
  - Reconcile the `location` column between Prisma and the raw SQL migration.
  - _Requirements: 1, 2, 3, 4, 6.3, 8.4_

- [ ] 4. Normalization + claimKey module (pure, tested)
  - Deterministic parser: rawText -> { normalizedType, value, currency, credential }.
  - claimKey derivation with valueBucket rules.
  - Unit tests incl. the canonical three-phrase example -> identical claimKey, and the
    non-match cases ("15%" vs "15% with ISIC", percent vs currency).
  - _Requirements: 6.2, 6.4, 6.5_

- [ ] 5. Verification state machine module (pure, tested)
  - Legal transition table; single writer of `verificationStatus`; audit row per transition.
  - Enforce: AI_EXTRACTION alone keeps UNCONFIRMED; only privileged official evidence ->
    OFFICIALLY_VERIFIED; illegal transitions rejected.
  - Confidence score function.
  - Unit tests for every legal + representative illegal transition.
  - _Requirements: 5.1–5.7, 2.5_

- [ ] 6. Community quorum promotion
  - On report insert: count distinct reporterUserId per claimKey; at >=3 for an UNCONFIRMED
    discount, request COMMUNITY_VERIFIED transition; set lastVerifiedAt.
  - Enforce one-per-account via the unique constraint (test the 3x-same-account case).
  - _Requirements: 5.3, 6.1, 6.3_

- [ ] 7. Conflict detection
  - Implement the deterministic algorithm from design (90-day window; >=3 unique, agreeing,
    more-recent contradicting reports -> NEEDS_REVERIFICATION; competing quorum supersedes).
  - Unit tests incl. negative cases (single account, stale, non-agreeing do NOT trip).
  - _Requirements: 7.1–7.5_

- [ ] 8. Evidence model + AI-cannot-publish guard
  - Evidence CRUD at the data layer; `createdByUserId` never selected by public queries.
  - Assert in code + test that AI_EXTRACTION evidence cannot move a discount to a visible
    state.
  - _Requirements: 3.1–3.4, 5.6, 9.2_

- [ ] 9. Public query shapes (privacy-safe)
  - Data-access read functions for discounts that exclude reporter identity, createdByUserId,
    and user PII; expose aggregate confirmation counts only.
  - Tests asserting the serialized shape contains no private fields.
  - _Requirements: 4.3, 9.2, 9.3_

- [ ] 10. Seeding split — three tiers
  - Tier 1 `prisma/seed/synthetic.ts` (`source=SYNTHETIC`, `[SYN]`, tests/POC only).
  - Tier 2 `prisma/seed/demo-places.ts` (small REAL Overture place set, `source=OVERTURE`,
    GERS id in `externalPlaceId`, hero cities).
  - Tier 3 `prisma/seed/demo.ts` (real discounts w/ real sourceUrl + snippet + checkedAt,
    attached to Tier 2 places by internal `Business.id`).
  - Demo DB seeded from Tier 2 + Tier 3 only; tiers never mixed. Add CDLA license text to
    `LICENSES/` and an "Places data © Overture Maps" credit placeholder.
  - NOTE: the actual Overture *import/ingestion* (bbox extract -> transform -> load) is a
    FUTURE spec, not part of this foundation spec. Here we only establish the schema, tiers,
    and a hand-authored small Tier 2 set if needed for early UI work.
  - _Requirements: 8.1–8.4, 10.1–10.4_

- [ ] 11. Dev log + hooks wiring
  - Start `docs/DEV_LOG.md` capturing meaningful Kiro usage (specs, steering, hooks, changes).
  - Confirm typecheck/lint/prisma-validate/post-task-test hooks run against this spec.
  - _Requirements: supports submission; see kiro-workflow steering_
