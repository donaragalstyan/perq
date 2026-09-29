---
inclusion: always
---

# perq — Architecture

## Shape: modular monolith + one database, async plane deferred

For the MVP, perq is a **modular monolith**: one Next.js (App Router) application that
serves both the UI and the API, backed by one PostgreSQL + PostGIS database. Do not
build microservices for a solo hackathon.

```
Client (Next.js + Mapbox GL JS)
   -> REST/RPC (typed)
API (Next.js Route Handlers)
   - auth, profile, discount queries, submissions
   - report normalization + matching (DETERMINISTIC)
   - verification state machine
   - bounded AI extraction endpoint (human-in-the-loop, Bedrock)
   -> Prisma (+ raw SQL for spatial)
PostgreSQL + PostGIS  (the heart of the system)
   - geography(Point, 4326), GiST spatial index
   - discounts, evidence, reports, credentials, users
   - (later) pgvector

Async plane (STRETCH, not MVP request path):
   EventBridge (cron) -> Lambda scheduler -> SQS -> Lambda re-verifier
   -> compares official evidence, flags NEEDS_REVERIFICATION
   -> CloudWatch / X-Ray for observability
```

## The load-bearing rule: deterministic logic lives in code + DB, never the LLM

Normalization matching, the 3-report threshold, state transitions, and eligibility
computation are **deterministic application/database logic**. The LLM only *proposes*
structured candidates. Code and evidence decide. See `ai-and-evidence.md`.

## Geospatial belongs to PostGIS, not the map SDK

"What exists near me / in this viewport / closest" is always answered by a PostGIS
query. Mapbox handles rendering and client-side clustering only. This keeps the map
provider swappable (MapLibre GL JS is a drop-in escape hatch) and puts the interesting
work in the database.

## Cloud (AWS) choices, and why each is present

This is an AWS hackathon; real cloud is part of the story. But no service is included
for its own sake — each must solve a concrete problem, and the MVP must genuinely need
it or it stays a stretch goal.

- **RDS / Aurora PostgreSQL** (demo) + **local Docker PostGIS** (dev): the primary data
  store; PostGIS and pgvector are available. Solves: durable spatial storage. MVP: yes.
- **Amazon Cognito**: real user accounts + sessions. Solves: community-verification
  integrity (one confirmation per real account) and authz. MVP: yes.
- **Amazon Bedrock**: the structured extraction LLM call. Solves: turning an official
  page into a *candidate* structured claim. MVP: yes (single bounded endpoint).
- **EventBridge + SQS + Lambda**: scheduled, decoupled, retryable re-verification of
  official evidence. Solves: "official prices change and we must not present stale data."
  MVP: **stretch** — attempt only if the core lands early. SQS gives retries + DLQ.
- **S3**: evidence snapshots / uploaded receipts. MVP: only if evidence upload ships.
- **CloudWatch / X-Ray**: observability of the async plane. Only once async workers exist.
- **Step Functions**: multi-step autonomous discovery. Explicitly **out of scope** for
  the hackathon.

## Swappability

- Map provider isolated behind a thin client wrapper (Mapbox today, MapLibre if needed).
- Spatial queries isolated in a data-access layer (raw SQL), not scattered through
  route handlers.
