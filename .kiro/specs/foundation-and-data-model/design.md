# Foundation and Data Model — Design

## Overview

This design defines perq's storage layer and the deterministic domain rules built on top
of it. It covers: the PostGIS-enabled schema, Prisma modeling with a raw-SQL spatial
layer, the verification state machine, the normalization/claimKey algorithm, conflict
detection, and the seeding split. It does not implement HTTP endpoints, UI, auth flows, or
Bedrock extraction (later specs consume this foundation).

## Technology decisions (locked)

- **DB**: PostgreSQL 16 + PostGIS. Local dev via Docker `postgis/postgis`; demo target
  **Amazon RDS for PostgreSQL** (not Aurora — no scaling/HA need at our scale; RDS is
  simpler and cheaper, PostGIS support is identical).
- **ORM**: Prisma for relational modeling; **raw SQL via `$queryRaw`** for all spatial
  operations (Prisma does not model `geography` well). Spatial SQL is isolated in a
  data-access module.
- **Auth**: Amazon Cognito (later spec). This spec stores only an opaque
  `authProviderId` on `User`; it does not implement auth.
- **AI**: Amazon Bedrock (later spec). This spec models `AI_EXTRACTION` evidence and the
  state-machine rule that AI alone cannot publish.

## Data model

Prisma models the relational columns. The `location` column is added/maintained via a SQL
migration because Prisma cannot express `geography(Point,4326)`; it is represented in
Prisma as `Unsupported("geography(Point,4326)")` or managed out-of-band and read via raw
SQL.

### Enums (extensible)

```
Category:        FOOD_DRINK | CAFE | MUSEUM | BOOKS | ENTERTAINMENT | SHOPPING |
                 TRANSPORTATION | FITNESS | TECHNOLOGY | EXPERIENCES | OTHER
CredentialType:  PHYSICAL_STUDENT_ID | EDU_EMAIL | ANY_UNIVERSITY_ID | ISIC |
                 UNIDAYS | STUDENT_BEANS | OTHER
DiscountType:    PERCENT | FIXED | SPECIAL_PRICE | FREE | NONE
VerificationStatus: UNCONFIRMED | COMMUNITY_VERIFIED | OFFICIALLY_VERIFIED |
                    NEEDS_REVERIFICATION | STALE | REJECTED
EvidenceType:    OFFICIAL_WEBSITE | TICKETING_PAGE | AI_EXTRACTION | COMMUNITY_REPORT |
                 RECEIPT_PHOTO
BusinessSource:  PROVIDER | MANUAL | AI_CANDIDATE
TrustLevel:      NORMAL | TRUSTED | ADMIN
```

New credential/discount types are added by extending an enum (or a lookup table if we want
runtime extensibility) — no core-table migration, satisfying Requirement 2.6.

### Tables (conceptual)

```
User
  id (uuid, pk)
  authProviderId (unique)          -- Cognito subject; opaque
  university?                      -- nullable, private
  universityCountry? (char(2))     -- ISO 3166-1 alpha-2, private
  trustLevel (TrustLevel = NORMAL)
  createdAt

UserCredential
  id (uuid, pk)
  userId (fk -> User)
  credentialType (CredentialType)
  UNIQUE(userId, credentialType)   -- self-asserted, no proof stored (MVP)

Business
  id (uuid, pk)
  externalPlaceId?                 -- from map provider; nullable
  name
  category (Category)
  address?
  city, country (char(2))          -- international-ready
  source (BusinessSource)
  location geography(Point,4326)   -- SQL migration; GiST indexed
  createdAt, updatedAt

Discount
  id (uuid, pk)
  businessId (fk -> Business)
  discountType (DiscountType)
  discountValue? (numeric)         -- percent or amount; null for FREE/NONE
  currency? (char(3))              -- required for FIXED/SPECIAL_PRICE
  acceptedCredentials (CredentialType[])
  restrictions?
  countryRestrictions? (char(2)[])
  eligibilityNotes?
  verificationStatus (VerificationStatus = UNCONFIRMED)
  confidenceScore (numeric = 0)    -- derived, for sorting
  lastVerifiedAt?
  createdAt, updatedAt
  INDEX(businessId), INDEX(verificationStatus)

Evidence
  id (uuid, pk)
  discountId (fk -> Discount)
  evidenceType (EvidenceType)
  sourceUrl?
  sourceSnippet?                   -- preserved proof text
  storageKey?                      -- S3 key for uploads (post-MVP)
  checkedAt
  createdByUserId? (fk -> User)    -- NEVER exposed publicly
  createdAt

CommunityReport
  id (uuid, pk)
  businessId (fk -> Business)
  discountId? (fk -> Discount)     -- may attach to an existing discount
  reporterUserId (fk -> User)      -- used only for uniqueness; never public
  rawText?
  normalizedType (DiscountType)
  normalizedValue? (numeric)
  normalizedCurrency? (char(3))
  normalizedCredential (CredentialType)
  worked (boolean)
  claimKey (text)                  -- derived; indexed
  createdAt
  UNIQUE(reporterUserId, claimKey) -- one confirmation per account per claim
  INDEX(businessId), INDEX(claimKey), INDEX(createdAt)

StateTransition (audit)
  id, discountId (fk), fromStatus, toStatus, reason, createdAt
```

### claimKey derivation (deterministic)

```
valueBucket =
  PERCENT       -> "P:" + integerPercent           (e.g. "P:15")
  FIXED         -> "F:" + currency + ":" + amount   (e.g. "F:CZK:50")
  SPECIAL_PRICE -> "S:" + currency + ":" + amount
  FREE          -> "FREE"
  NONE          -> "NONE"

claimKey = hash( businessId + "|" + discountType + "|" + valueBucket + "|" + credentialType )
```

Bias: when normalization is uncertain, produce a *different* claimKey (fail toward
"not the same claim"), per the trust-first principle.

## Normalization (pure module, LLM-optional)

Free-form `rawText` -> normalized fields. In this spec the normalizer is a **deterministic
parser** for the common shapes (percent, "X off", currency prices, "free", "no discount").
Later, Bedrock may *pre-normalize* messy text into these fields, but the app always
computes the final claimKey and match decision (Requirement 6.5, ai-and-evidence invariant).

Canonical test: the three example phrases all yield
`{ PERCENT, 15, PHYSICAL_STUDENT_ID }` -> identical claimKey.

## Verification state machine

```
UNCONFIRMED ──(3 unique accounts, same claimKey)──▶ COMMUNITY_VERIFIED
UNCONFIRMED ──(privileged: valid official evidence)──▶ OFFICIALLY_VERIFIED
any state   ──(privileged: valid official evidence)──▶ OFFICIALLY_VERIFIED
COMMUNITY_VERIFIED ──(conflict threshold met)──▶ NEEDS_REVERIFICATION
OFFICIALLY_VERIFIED ──(official page changed; later spec)──▶ NEEDS_REVERIFICATION
NEEDS_REVERIFICATION ──(competing claimKey reaches quorum)──▶ COMMUNITY_VERIFIED (new value)
NEEDS_REVERIFICATION ──(no resolution within window)──▶ STALE
any state   ──(admin)──▶ REJECTED

Visible publicly: COMMUNITY_VERIFIED, OFFICIALLY_VERIFIED (and NEEDS_REVERIFICATION shown
but flagged). AI_EXTRACTION evidence alone keeps a discount in UNCONFIRMED — never visible.
```

Transitions run in a single module (`stateMachine`) that validates the from→to edge,
records a `StateTransition` audit row with a reason, and is the *only* code allowed to
write `verificationStatus`. HTTP/community layers request transitions; they never set the
column directly (Requirement 5.4, security authz boundary).

### Confidence score (simple, deterministic — for sorting only)

```
OFFICIALLY_VERIFIED & checkedAt < 180d       -> 100
COMMUNITY_VERIFIED  & lastVerifiedAt < 90d   -> 70
NEEDS_REVERIFICATION                          -> 30
STALE                                         -> 10
otherwise                                     -> 0
```

Not a probability — just a defensible ordering. No ML, no reputation (out of MVP scope).

## Conflict detection algorithm (deterministic)

Runs on each new `CommunityReport` insert for a discount that is `COMMUNITY_VERIFIED`:

```
window        = now - 90 days
verifiedKey   = the claimKey that promoted this discount
contradicting = reports for the SAME businessId where
                  createdAt > discount.lastVerifiedAt
                  AND createdAt >= window
                  AND (claimKey != verifiedKey  OR  worked = false OR normalizedType = NONE)
group contradicting by claimKey (treat all NONE/worked=false as one bucket "NONE")
pick the largest agreeing bucket
IF distinct reporterUserId count in that bucket >= 3:
    transition COMMUNITY_VERIFIED -> NEEDS_REVERIFICATION (reason: "conflict:<newKey>")
IF that competing bucket's distinct reporters >= 3 AND it is a real discount (not NONE):
    it may supersede -> COMMUNITY_VERIFIED with the new value (reason: "superseded")
```

All inputs are counts, dates, and key equality — no scoring, fully testable.

## Spatial data-access layer

Isolated module with parameterized raw SQL:

```
withinRadius(point, meters, filters)  -> ST_DWithin(location, $p, $m) + category/status
nearest(point, limit, filters)        -> ORDER BY location <-> $p LIMIT $n
withinViewport(bbox, filters)         -> location && ST_MakeEnvelope(...4326)
distanceMeters(point)                 -> ST_Distance(location, $p) per row
```

Public queries filter `verificationStatus IN (COMMUNITY_VERIFIED, OFFICIALLY_VERIFIED,
NEEDS_REVERIFICATION)` and never join reporter identity.

## Migrations

1. Prisma migration for relational tables/enums.
2. Raw SQL migration: `CREATE EXTENSION IF NOT EXISTS postgis;`, add
   `location geography(Point,4326)`, create the GiST index.
   (`CREATE EXTENSION` requires the `rds_superuser`-granted role on RDS — documented in POC.)

## Seeding split (Requirement 8)

```
prisma/seed/synthetic.ts   -- fake Seattle/Prague points for tests + POC; clearly labeled
prisma/seed/demo.ts        -- REAL discounts w/ real sourceUrl + snippet + checkedAt only
```

The demo DB is seeded only from `demo.ts`. Tests and the POC use `synthetic.ts`. They are
never mixed.

## Testing (maps to testing steering)

Pure unit tests: normalization, claimKey matching, state transitions, conflict detection,
confidence score. PostGIS integration tests (Docker) for the four spatial queries against a
known fixture set with pre-computed distances. Authz/privacy: assert public query shapes
exclude reporter identity and user PII.

## Out of scope for this spec

Auth flows, map UI, eligibility engine surface, community submission UX, Bedrock
extraction, S3 uploads, pgvector, and the async re-verification plane. This spec provides
the schema + deterministic rules those depend on.
