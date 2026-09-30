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
BusinessSource:  OVERTURE | MANUAL | AI_CANDIDATE | SYNTHETIC
                 -- OVERTURE = imported real place (canonical); MANUAL = privileged entry;
                 -- AI_CANDIDATE = proposed by extraction; SYNTHETIC = dev/test fixtures only
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
  id (uuid, pk)                    -- perq's INTERNAL id; the stable FK target for all
                                   -- perq-specific data (discounts, evidence, reports).
                                   -- Never reference a place by externalPlaceId from Tier 3.
  externalPlaceId?                 -- Overture GERS id when source=OVERTURE; enables re-sync.
  name
  category (Category)
  address?
  city, country (char(2))          -- international-ready
  source (BusinessSource)          -- OVERTURE (canonical real) | MANUAL | AI_CANDIDATE | SYNTHETIC
  location geography(Point,4326)   -- SQL migration; GiST indexed
  importedAt?                      -- when Tier 2 place was imported/last refreshed from Overture
  createdAt, updatedAt
  INDEX(externalPlaceId)           -- match target for Overture re-sync

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
NEEDS_REVERIFICATION ──(later re-verification flow: official evidence / future rule)──▶ COMMUNITY_VERIFIED or OFFICIALLY_VERIFIED
NEEDS_REVERIFICATION ──(no resolution within window)──▶ STALE
   (Phase 1 flag-first: a competing quorum is recorded as supersede-ELIGIBLE evidence but
    does NOT itself perform the supersession — resolution is deferred to the re-verify spec.)
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
    transition COMMUNITY_VERIFIED -> NEEDS_REVERIFICATION (reason: "conflict:<competingKey>")
    record the competing bucket (claimKey + distinct reporter count) as disagreement evidence
    IF the competing bucket is a real (non-NONE) claim with >= 3 distinct reporters:
        mark it supersedeEligible = true  (does NOT supersede now — flag-first)
```

**Flag-first (decided 2026-09-29).** A conflict always moves the discount to
NEEDS_REVERIFICATION first. A competing claim reaching quorum becomes *eligible for later
supersession* but is NOT applied in this phase — so the crowd cannot silently swap the
displayed value. The pure decision returns `supersede` only as an eligibility signal; the
service records it (competing claimKey + reporter count) for a future re-verification flow to
act on. Threshold stays 3 (same as quorum); no separate supersession threshold.

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

**Operational gotcha (verified in Phase 1):** `prisma db push` reconciles the DB to the
Prisma schema and will DROP the raw-SQL-managed `location` column (Prisma doesn't know about
it). Therefore the spatial migration MUST be re-applied after every `db push`. Use the
combined `npm run db:sync` (push + re-apply spatial migration) so the geography column and
GiST index are never left missing.

## Place-data strategy: Overture (canonical places) + Mapbox (rendering)

Per `docs/PLACE_DATA_STRATEGY.md` (decided 2026-09-29):

- **Persistent real places** are imported from **Overture Maps Places** (CDLA Permissive 2.0)
  into PostGIS, which is perq's **canonical** place store. Rows are marked `source = OVERTURE`
  with the GERS id in `externalPlaceId` and an `importedAt` timestamp.
- **Mapbox** is the map/rendering layer (and optional *temporary* search) only. Mapbox place
  data is never persisted (its default geocoding forbids storage).
- **Perq's internal `Business.id`** is the stable FK target for all Tier 3 data (discounts,
  evidence, community reports). Tier 3 never references `externalPlaceId`.

### Refresh safety (Requirement 8.4)

Re-syncing Overture places matches on `externalPlaceId` (GERS) and updates only Tier 2 place
attributes (name/coords/address/category/`importedAt`). Because Tier 3 references the internal
`Business.id`, a place refresh leaves discounts/evidence/community reports and verification
history intact. Import/refresh is a **future spec** (bounded bbox extract via DuckDB /
`overturemaps` CLI -> transform -> parameterized load); no live crawling.

### Licensing / attribution (Requirement 10)

- Overture Places is **CDLA Permissive 2.0**: no share-alike; the only obligation when
  redistributing the raw Data is to include the license text (§2.1). CDLA §3.1 ("No
  Restrictions on Results") means perq's derived Tier 3 data is unencumbered and may be
  combined freely with place data.
- Ship the CDLA text in the repo (e.g., `LICENSES/`); show "Places data © Overture Maps" in
  app credits; keep Mapbox's required map attribution.
- OSM/ODbL was rejected to avoid share-alike/derivative-database ambiguity; Overture Places is
  CDLA precisely because it is conflated from permissive commercial sources, not OSM.

## Seeding split — three tiers (Requirement 8)

```
prisma/seed/synthetic.ts     -- TIER 1: [SYN] fake points, source=SYNTHETIC; tests + POC only
prisma/seed/demo-places.ts   -- TIER 2: small REAL Overture place set (source=OVERTURE) for
                                the hero cities; the future import script feeds this tier
prisma/seed/demo.ts          -- TIER 3: REAL discounts w/ real sourceUrl + snippet + checkedAt,
                                attached to Tier 2 places by internal Business.id
```

The demo DB is seeded from the Tier 2 + Tier 3 scripts only. Tests and the POC use the Tier 1
synthetic seed. The tiers are never mixed. (The existing POC `synthetic.ts` remains untouched
as an isolated validation environment.)

## Testing (maps to testing steering)

Pure unit tests: normalization, claimKey matching, state transitions, conflict detection,
confidence score. PostGIS integration tests (Docker) for the four spatial queries against a
known fixture set with pre-computed distances. Authz/privacy: assert public query shapes
exclude reporter identity and user PII.

## Out of scope for this spec

Auth flows, map UI, eligibility engine surface, community submission UX, Bedrock
extraction, S3 uploads, pgvector, and the async re-verification plane. This spec provides
the schema + deterministic rules those depend on.
