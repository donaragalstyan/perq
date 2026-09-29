# Foundation and Data Model — Requirements

## Introduction

This spec establishes perq's foundational data layer: the PostgreSQL + PostGIS schema,
the core relational model (users, credentials, businesses, discounts, evidence,
community reports), the verification state machine (including basic conflict detection),
spatial indexing, and a clearly separated seeding strategy for real demo data vs
synthetic test data.

This is the first spec and a dependency of all later specs. It deliberately does **not**
implement auth flows, the map UI, the eligibility engine, community submission UX, or AI
extraction — those are later specs. It implements the *storage and deterministic domain
rules* those features will build on.

Aligned with steering: `product-principles`, `architecture`, `security`,
`ai-and-evidence`, `testing`, `coding-standards`.

## Glossary

- **claimKey** — a deterministic identifier for a normalized discount claim, derived from
  `{ businessId, discountType, valueBucket, credentialType }`. Two reports "materially
  match" iff their claimKeys are equal.
- **valueBucket** — the normalized value used in the claimKey (e.g., the exact percent for
  PERCENT, a currency+amount for FIXED/SPECIAL_PRICE, none for FREE/NONE).
- **quorum** — 3 unique accounts.
- **hero cities** — Seattle and Prague (schema stays international).

## Requirements

### Requirement 1 — Spatially-indexed business/place storage

**User story:** As the system, I want to store businesses with precise geographic
coordinates and query them spatially, so that the app can answer "near me / in this
viewport / closest" quickly.

#### Acceptance criteria
1. WHEN a business is stored THEN the system SHALL persist its location as
   `geography(Point, 4326)`.
2. THE system SHALL maintain a GiST index on the business location column.
3. THE system SHALL store `city` and `country` (ISO 3166) on each business so the schema
   supports international data beyond the hero cities.
4. WHERE a business originates from a map provider, THE system SHALL store an
   `externalPlaceId` and a `source` of `PROVIDER`; WHERE entered manually, `source` of
   `MANUAL`; WHERE proposed by AI extraction, `source` of `AI_CANDIDATE`.
5. THE system SHALL support the category enum: FOOD_DRINK, CAFE, MUSEUM, BOOKS,
   ENTERTAINMENT, SHOPPING, TRANSPORTATION, FITNESS, TECHNOLOGY, EXPERIENCES, OTHER.

### Requirement 2 — Extensible discount records

**User story:** As the system, I want discount records rich enough to represent real
student-discount rules and extensible to new credential/discount types, so the model does
not need major migrations later.

#### Acceptance criteria
1. THE system SHALL represent discount type as an enum: PERCENT, FIXED, SPECIAL_PRICE,
   FREE, NONE.
2. WHERE the discount is FIXED or SPECIAL_PRICE, THE system SHALL store a currency
   (ISO 4217) alongside the value.
3. THE system SHALL store the set of accepted credential/verification methods per discount
   as a set of enum values: PHYSICAL_STUDENT_ID, EDU_EMAIL, ANY_UNIVERSITY_ID, ISIC,
   UNIDAYS, STUDENT_BEANS, OTHER.
4. THE system SHALL store optional `restrictions`, `countryRestrictions` (ISO country set),
   and `eligibilityNotes`.
5. THE system SHALL store `verificationStatus`, a derived `confidenceScore`, and
   `lastVerifiedAt`.
6. THE system SHALL allow adding a new credential type or discount rule without a migration
   to core tables (enums/lookup + set columns, not hard-coded relations).

### Requirement 3 — Evidence records

**User story:** As the system, I want every publicly visible discount backed by stored
evidence, so trust is grounded in verifiable sources.

#### Acceptance criteria
1. THE system SHALL store evidence with an `evidenceType`: OFFICIAL_WEBSITE,
   TICKETING_PAGE, AI_EXTRACTION, COMMUNITY_REPORT, RECEIPT_PHOTO.
2. WHERE evidence is official or AI-extracted, THE system SHALL store a `sourceUrl` and a
   preserved `sourceSnippet` and a `checkedAt` timestamp.
3. THE system SHALL associate a `createdByUserId` with evidence WHERE applicable, and this
   value SHALL NOT be exposed by any public API.
4. AI_EXTRACTION evidence SHALL NOT, by itself, cause a discount to enter a publicly
   visible state (enforced by the state machine — Requirement 5).

### Requirement 4 — Users, credentials, and reporter privacy

**User story:** As a student, I want to record which credentials I hold and my university
context, while keeping my identity private in public data.

#### Acceptance criteria
1. THE system SHALL store a user with an auth-provider identifier, optional `university`,
   optional `universityCountry` (ISO), and a `trustLevel` defaulting to NORMAL.
2. THE system SHALL store a user's held credentials as `UserCredential` rows using the
   credential-type enum; these are self-asserted in the MVP (no proof stored).
3. THE system SHALL NOT expose a user's identity, university, or reporter linkage through
   any public/read API for discounts or reports; only aggregate counts SHALL be public.
4. THE system SHALL NOT persist a history of user query locations.

### Requirement 5 — Verification state machine

**User story:** As the system, I want an explicit, deterministic verification lifecycle,
so only trustworthy discounts are shown and AI can never publish on its own.

#### Acceptance criteria
1. THE system SHALL support states: UNCONFIRMED, COMMUNITY_VERIFIED, OFFICIALLY_VERIFIED,
   NEEDS_REVERIFICATION, STALE, REJECTED.
2. Only COMMUNITY_VERIFIED and OFFICIALLY_VERIFIED SHALL be publicly visible.
3. WHEN >= 3 unique accounts submit reports sharing one claimKey for an UNCONFIRMED
   discount THEN the system SHALL transition it to COMMUNITY_VERIFIED.
4. THE system SHALL reject illegal transitions and SHALL log the reason for every
   transition.
5. WHEN valid official evidence is attached by a privileged actor THEN the system SHALL
   allow transition to OFFICIALLY_VERIFIED from any state.
6. AI_EXTRACTION evidence alone SHALL only ever place/keep a discount in UNCONFIRMED.
7. THE system SHALL provide an admin transition to REJECTED for spam/abuse.

### Requirement 6 — Community reports, normalization, and one-per-account

**User story:** As a student, I want to report a discount I received; as the system, I want
to count only genuine, unique confirmations.

#### Acceptance criteria
1. THE system SHALL store a community report with `reporterUserId`, optional `rawText`,
   normalized fields (`normalizedType`, `normalizedValue`, `normalizedCredential`), a
   `worked` boolean, and `createdAt`.
2. THE system SHALL compute a `claimKey` for each report deterministically.
3. THE system SHALL enforce `UNIQUE(reporterUserId, claimKey)` so one account contributes
   at most one confirmation per claim.
4. THE normalization of the canonical examples ("15% off", "They took 15 percent off when
   I showed my college card", "Student ID = 15% off") SHALL produce the same claimKey.
5. THE final decision that two reports match SHALL be made deterministically by the
   application, never by an LLM.

### Requirement 7 — Basic conflict detection

**User story:** As the system, I want to notice when recent reports contradict a verified
discount, so I stop presenting stale information as current.

#### Acceptance criteria
1. THE system SHALL treat a report for the same business with a different claimKey (or a
   NONE / `worked = false` report) as a *contradicting report* relative to a verified claim.
2. WHEN a COMMUNITY_VERIFIED discount receives contradicting reports from >= 3 unique
   accounts, AND those reports were created after the verified claim's `lastVerifiedAt`,
   AND those contradicting reports share a single claimKey (or are all NONE/`worked=false`),
   all within a rolling 90-day window, THEN the system SHALL transition the discount to
   NEEDS_REVERIFICATION.
3. A discount in NEEDS_REVERIFICATION SHALL remain visible but flagged, with a lowered
   confidenceScore for sorting.
4. WHEN a competing claimKey itself reaches quorum (3 unique accounts) THEN the system MAY
   supersede the prior claim and return to COMMUNITY_VERIFIED with the new value.
5. Single-account, stale (outside the window), or non-agreeing contradictions SHALL NOT
   trip the transition.

### Requirement 8 — Separated seeding strategy

**User story:** As the developer, I want real evidence-backed demo data kept separate from
synthetic test data, so the demo is trustworthy and tests are deterministic.

#### Acceptance criteria
1. THE system SHALL provide a synthetic seed usable by tests and the PostGIS POC, clearly
   labeled as synthetic.
2. THE demo/production seed SHALL contain only real student discounts with real evidence
   (`sourceUrl` + `sourceSnippet` + `checkedAt`) for the hero cities.
3. Synthetic and real seed data SHALL be in separate scripts/paths and SHALL NOT be mixed
   in the demo database.

### Requirement 9 — Security and privacy at the data layer

**User story:** As the system, I want the data layer to enforce privacy and resist abuse
by construction.

#### Acceptance criteria
1. All spatial and relational queries SHALL be parameterized (no string interpolation of
   user input).
2. Public read APIs SHALL NOT return reporter identity, `createdByUserId`, or user
   university/credential data tied to a discount.
3. THE system SHALL not store any user location history (per Requirement 4.4).
