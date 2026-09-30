# perq — Design Overview

perq helps students discover in-person student discounts they are **actually likely to
qualify for** with the credentials they hold. Built for the "Within Reach" Kiro Hackathon
(submissions due **Oct 23, 2026, 11:59 PM PST** — verify against official terms).

This document is the top-level summary. Detailed rules live in `.kiro/steering/` and
per-feature specs live in `.kiro/specs/`.

## North-star question

> "Which student discounts near me am I actually likely to qualify for with the student
> credentials I have?"

Framed as **student financial accessibility**, not deal-hunting. **Trust is the product**:
we would rather show fewer discounts we are confident about than more we are not.

## MVP thesis

A Kiro-built, AWS-hosted map of **Seattle and Prague** where a logged-in student sets
their credentials and sees nearby student discounts color-coded by personal eligibility.
Every visible discount is backed by **official evidence** or **3 independent community
confirmations**. A **Bedrock-powered extraction tool** proposes new discounts from official
pages but never publishes one on its own.

## Feature triage

**MVP**: PostGIS schema; Cognito auth; profile (university, country, held credentials);
Mapbox map with clustering (Seattle + Prague); category + credential filters; spatial
queries (radius / nearest / viewport / category+distance); eligibility signal
(LIKELY / ADDITIONAL_REQUIREMENTS / UNKNOWN + reason); discount detail with evidence;
community submission (place picked from existing data); deterministic normalization +
claimKey matching + 3-report promotion; verification state machine **with basic conflict
detection**; official verification path; one **bounded, human-gated Bedrock extraction
endpoint** (SSRF-guarded); map/list toggle; "best discounts near me"; rate limiting +
one-confirmation-per-account; separated real-demo vs synthetic-test seed data.

**Stretch (only if core is polished)**: EventBridge -> SQS -> Lambda re-verification of
official evidence; Vienna/Bratislava records.

**Out of scope**: autonomous crawling; worldwide coverage; pgvector; Step Functions;
OpenTelemetry/X-Ray; reputation scoring; uploads; mobile client; ISIC/UNiDAYS API
integrations; any LLM final decision on eligibility or verification.

## Architecture (modular monolith)

```
Next.js (App Router) + Mapbox GL JS   [UI]
  -> Next.js Route Handlers            [API: auth, profile, queries, submissions,
                                        normalization+matching (deterministic),
                                        state machine, Bedrock extraction (human-gated)]
    -> Prisma (+ raw SQL for spatial)
      -> PostgreSQL + PostGIS (RDS demo / Docker dev)  [heart of the system]

Stretch async plane (NOT in sync path):
  EventBridge (cron) -> Lambda -> SQS -> Lambda re-verifier -> flags NEEDS_REVERIFICATION
```

Load-bearing rule: **deterministic logic (normalization matching, quorum, state
transitions, eligibility, conflict) lives in code + DB, never the LLM.** Geospatial lives
in **PostGIS**, not the map SDK (map provider stays swappable via MapLibre).

## Key technology choices (and why)

- **PostgreSQL + PostGIS** — the headline learning goal and the right tool for spatial
  queries. `geography(Point,4326)` + GiST.
- **Amazon RDS for PostgreSQL** (not Aurora) — identical PostGIS support, simpler, cheaper;
  no scaling/HA need at our scale. Local Docker PostGIS for dev.
- **Mapbox GL JS** — map rendering layer only (fast, generous free tier, MapLibre escape
  hatch). Mapbox place data is NOT persisted (its default geocoding forbids storage).
- **Overture Maps Places (CDLA Permissive 2.0)** — source for persistent real place records,
  imported into PostGIS as perq's canonical place store (`source=OVERTURE`, GERS id in
  `externalPlaceId`). Permissive license, no share-alike; combines cleanly with perq data.
  See `docs/PLACE_DATA_STRATEGY.md`.
- **Amazon Cognito** — in-AWS accounts + hosted UI + email verification (needed for
  community-verification integrity). Clerk is the fallback if Cognito blocks week 1.
- **Amazon Bedrock** — structured extraction only; proposes candidates, never publishes.
- **Prisma + raw SQL for spatial** — Prisma for relational, `$queryRaw` for PostGIS.

## Verification state machine

States: UNCONFIRMED, COMMUNITY_VERIFIED, OFFICIALLY_VERIFIED, NEEDS_REVERIFICATION, STALE,
REJECTED. Only COMMUNITY_VERIFIED / OFFICIALLY_VERIFIED are publicly visible;
NEEDS_REVERIFICATION is shown but flagged. 3 unique accounts sharing a claimKey promote
UNCONFIRMED -> COMMUNITY_VERIFIED. AI_EXTRACTION evidence alone keeps a discount in
UNCONFIRMED. Full diagram + transitions in the foundation spec design.

### Conflict detection (deterministic, in MVP)

A COMMUNITY_VERIFIED claim moves to NEEDS_REVERIFICATION when **>= 3 unique accounts**
submit **agreeing**, **more-recent** (after last verification), contradicting reports within
a **rolling 90-day window**. A competing claim reaching quorum can supersede. No reputation
or confidence modeling — just counts, dates, and key equality.

## Official vs community evidence

Two independent evidence sources feeding one picture. One good **official** source can make
a discount visible on its own; **community** requires quorum (3 unique accounts). When they
conflict, the more recent / higher-tier evidence wins and the record moves to
NEEDS_REVERIFICATION rather than silently overwriting. **AI evidence is never sufficient
alone** — it is a candidate a human or community must upgrade.

## Geospatial approach

All in PostGIS: `ST_DWithin` (radius), `<->` KNN (nearest), `&&` + `ST_MakeEnvelope`
(viewport), `ST_Distance` (display). Mapbox does rendering + client clustering only.

## Discovery / re-verification (mostly deferred)

MVP AI = **one synchronous, human-triggered, SSRF-guarded** Bedrock extraction endpoint:
paste allowlisted official URL -> fetch (guarded) -> structured extract -> validate schema
-> store preserved snippet as AI_EXTRACTION evidence -> land as UNCONFIRMED awaiting human
approval. Autonomous crawling and Step Functions discovery are **out of scope**. Scheduled
EventBridge/SQS/Lambda re-verification is a **stretch** goal.

## Top risks

SSRF (allowlist + private-range block + redirect re-validation + caps); sockpuppet
confirmations (real Cognito accounts, one-per-account unique constraint, rate limits;
3-collusion is a documented known limit); stale data (lastVerifiedAt surfaced, conflict ->
NEEDS_REVERIFICATION); AI hallucination (structurally cannot publish); place-data licensing
(Mapbox chosen partly for this); privacy (ephemeral location, reporter identity never
public).

## Specs (dependency order)

1. `foundation-and-data-model` (created) — schema, state machine, deterministic rules.
2. `auth-and-profile`
3. `geospatial-discovery-api`
4. `map-and-discovery-ui`
5. `eligibility-engine`
6. `community-verification`
7. `official-verification-and-ai-extraction`
8. `reverification-pipeline` (stretch; written, built only if core lands early)

## Phased plan through Oct 23

Today is Sept 29, 2026. ~3.5 weeks solo.

- **Phase 0 — POC (Sep 29 – Oct 1):** Validate the riskiest assumption. Docker PostGIS +
  ~30 synthetic points + the four spatial queries + a bare Mapbox map that re-queries on
  pan. Gate: if fast and clean, proceed; if licensing/raw-SQL friction surprises, adapt now.
  See `docs/POC.md`.
- **Phase 1 — Foundation (Oct 1 – Oct 5):** Full Prisma schema, normalization + claimKey,
  state machine, quorum, conflict detection — all unit-tested. Specs 1 complete.
- **Phase 2 — Auth + API (Oct 5 – Oct 9):** Cognito auth, profile + credentials, the
  geospatial discovery API. Specs 2–3.
- **Phase 3 — Map UI + eligibility (Oct 9 – Oct 14):** Map/list, filters, markers,
  clustering, detail pages, eligibility signal. Specs 4–5.
- **Phase 4 — Community + official + AI (Oct 14 – Oct 19):** Submission flow, promotion in
  the live app, official verification path, the bounded Bedrock extraction endpoint. Specs
  6–7. Seed **real** demo data.
- **Phase 5 — Polish + submission (Oct 19 – Oct 23):** Demo script, README, DEV_LOG, Builder
  Center writeup, deploy to RDS. Stretch: attempt the re-verification pipeline only if time
  remains. Submit before the deadline with buffer.

## Riskiest assumption

That we can store businesses/discounts in PostGIS and answer nearby / filtered /
eligibility-aware queries fast, feeding a Mapbox map — including place-data licensing. This
is the new, load-bearing, unproven piece. **Validate it first (Phase 0).**
