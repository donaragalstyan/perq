# perq

Location-based discovery of in-person student discounts you're **actually likely to
qualify for** with the credentials you hold. Evidence-grounded trust: a discount is shown
publicly only when backed by official evidence or 3 independent community confirmations, and
**an AI-generated claim is never sufficient evidence by itself**.

Built for the "Within Reach" Kiro Hackathon. See `docs/DESIGN.md` for the full design,
`.kiro/steering/` for the guiding principles, and `.kiro/specs/` for feature specs.

## Status

Phase 1 (foundation) complete: PostgreSQL + PostGIS schema, deterministic domain logic
(report normalization + claimKey, verification state machine, community quorum, conflict
detection), evidence handling, and privacy-safe public queries — all tested. Map UI, auth,
eligibility engine, and the bounded Bedrock extraction endpoint come in later specs.

The `poc/` directory is an isolated, completed technical validation (PostGIS + Mapbox) and
is not part of the app.

## Prerequisites

- Node 20+ and npm
- Docker (for local PostgreSQL + PostGIS)

## Setup

```bash
cp .env.example .env          # then set NEXT_PUBLIC_MAPBOX_TOKEN when doing map work
npm install
npm run db:up                 # start local Postgres+PostGIS (host port 5433)
npm run db:sync               # prisma db push + (re)apply the PostGIS spatial migration
```

> Important: `prisma db push` drops the raw-SQL `location geography` column because Prisma
> doesn't manage it. Always use `npm run db:sync` (push + spatial migration) so the geography
> column and its GiST index are present.

## Seeding (three separate tiers)

```bash
npm run seed:synthetic        # TIER 1: [SYN] dev/test fixtures (source=SYNTHETIC) — never production
npm run seed:demo             # TIER 2 (Overture real places) + TIER 3 (real, evidence-backed discounts)
```

Tier 3 (`prisma/seed/demo.ts`) ships no fabricated discounts: each entry must be completed
with real evidence (`sourceUrl` + `sourceSnippet` + `checkedAt`) and `verified: true` before
it loads. This keeps the demo honest.

## Develop / verify

```bash
npm run dev            # Next.js dev server
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run test           # vitest (unit + DB integration; needs db:up)
```

Integration tests share the local DB and run sequentially (configured in `vitest.config.ts`).

## Kiro automation

`.kiro/hooks/` runs typecheck + lint on `.ts/.tsx` save, `prisma validate` on schema save,
the test suite after a spec task completes, and a security-review reminder on write tools.
