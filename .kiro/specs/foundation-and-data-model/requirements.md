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
4. THE system SHALL record each business's `source`: `OVERTURE` (imported from Overture
   Maps Places — the canonical source for real place records), `MANUAL` (entered by a
   privileged actor), `AI_CANDIDATE` (proposed by AI extraction), or `SYNTHETIC`
   (development/test fixtures only — never production/demo).
5. WHERE a business is imported from Overture Maps, THE system SHALL store the Overture/GERS
   identifier in `externalPlaceId` so the record can be re-synced later, AND SHALL treat
   perq's own internal `id` (not `externalPlaceId`) as the stable identifier that all
   perq-specific data references.
6. THE system SHALL treat PostGIS as perq's **canonical** place database: once imported, a
   place is served from perq's own storage and does not require a live third-party call to
   display. Mapbox is used for map rendering (and optional temporary search), never as the
   persistent place store.
7. THE system SHALL support the category enum: FOOD_DRINK, CAFE, MUSEUM, BOOKS,
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
4. WHEN a conflict trips, THE system SHALL transition the discount to NEEDS_REVERIFICATION
   **first** (flag-first), and SHALL NOT immediately replace the previously verified claim
   with the competing claim — even if the competing claim has itself reached the normal
   3-account quorum. THE system SHALL preserve the competing claim as structured evidence of
   the disagreement (its `claimKey` and distinct reporter count) so the UI can explain what
   changed (e.g., "Previously verified: 15% off. Recent reports: 10% off."). A competing claim
   reaching quorum becomes *eligible for later supersession* but SHALL NOT perform
   supersession in this phase; a later re-verification flow (official evidence or a future
   deterministic rule) SHALL define how NEEDS_REVERIFICATION resolves.
5. Single-account, stale (outside the window), or non-agreeing contradictions SHALL NOT
   trip the transition.
6. THE conflict threshold SHALL remain 3 (the same value as community quorum). No separate,
   higher supersession threshold is introduced in this phase.

### Requirement 8 — Three data tiers, cleanly separated

**User story:** As the developer, I want synthetic fixtures, imported real place data, and
perq-specific verification data kept logically separate, so the demo is trustworthy, tests
are deterministic, and imported place data can be refreshed without touching perq's
verification history.

The three tiers:
- **Tier 1 — Synthetic fixtures:** fabricated `[SYN]`-prefixed records, `source = SYNTHETIC`.
  Development/test only.
- **Tier 2 — Imported real places:** Overture-derived business records, `source = OVERTURE`,
  with the GERS id in `externalPlaceId`. Canonical real-world places shown to users.
- **Tier 3 — perq-specific data:** discounts, evidence, community reports, verification
  state — produced by perq's own rules, referencing places by perq's internal `id`.

#### Acceptance criteria
1. THE system SHALL provide a synthetic seed (Tier 1) usable by tests and the PostGIS POC,
   clearly labeled `SYNTHETIC`, and SHALL NEVER present Tier 1 data as production/demo data.
2. THE demo/production place data (Tier 2) SHALL be imported from Overture Maps Places and
   marked `source = OVERTURE`; the demo/production discounts (Tier 3) SHALL contain only real
   student discounts with real evidence (`sourceUrl` + `sourceSnippet` + `checkedAt`) for the
   hero cities.
3. Tier 1, Tier 2, and Tier 3 SHALL live in separate scripts/paths and SHALL NOT be mixed in
   the demo database.
4. THE system SHALL allow Tier 2 (imported place) records to be refreshed/re-synced from
   Overture (matched by `externalPlaceId`/GERS) WITHOUT deleting or altering Tier 3
   (discount/evidence/community/verification) data that references a place by perq's internal
   `id`. Perq's verification history SHALL survive a place refresh.

### Requirement 10 — Place-source provenance and licensing obligations

**User story:** As the system owner, I want provenance and license obligations for imported
place data recorded, so perq stays compliant and can refresh sources safely.

#### Acceptance criteria
1. THE system SHALL retain, for each imported place, its `source` and `externalPlaceId`
   (GERS id) as provenance.
2. THE application SHALL display attribution for imported place data (e.g., "Places data ©
   Overture Maps") and SHALL retain the map provider's required attribution (Mapbox) on the
   map view.
3. THE repository SHALL include the CDLA Permissive 2.0 license text for the Overture Places
   data, per its share condition.
4. Perq-specific data (Tier 3) SHALL NOT be encumbered by the place-source license; combining
   it with imported place data is permitted (CDLA Permissive "No Restrictions on Results").
   See `docs/PLACE_DATA_STRATEGY.md`.

### Requirement 9 — Security and privacy at the data layer

**User story:** As the system, I want the data layer to enforce privacy and resist abuse
by construction.

#### Acceptance criteria
1. All spatial and relational queries SHALL be parameterized (no string interpolation of
   user input).
2. Public read APIs SHALL NOT return reporter identity, `createdByUserId`, or user
   university/credential data tied to a discount.
3. THE system SHALL not store any user location history (per Requirement 4.4).
