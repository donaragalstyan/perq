---
inclusion: always
---

# perq — Coding Standards

## Language and stack

- **TypeScript everywhere** (strict mode). No implicit `any`.
- **Next.js (App Router)** for both UI and API route handlers.
- **Prisma** for the relational model; **raw SQL via `$queryRaw`** for spatial queries
  (Prisma does not model PostGIS types well — this is expected, not a workaround to hide).
- **Mapbox GL JS** behind a thin, swappable client wrapper.

## Structure

- Keep deterministic domain logic (normalization, `claimKey`, state machine, eligibility)
  in a **pure, well-tested module** independent of HTTP and the ORM. This is the code
  most worth testing and least worth coupling.
- Isolate spatial queries in a **data-access layer**, not inline in route handlers.
- Isolate the map provider behind one wrapper so MapLibre can replace Mapbox.
- Isolate the Bedrock extraction call behind one service with schema validation at the
  boundary.

## Errors and validation

- Validate all external input at the boundary (request bodies, query params, model
  output) with a schema (e.g., Zod). Parse, don't assume.
- Fail loudly on invalid state transitions; never silently coerce.
- Return typed, structured errors; do not leak internal details or secrets.

## Naming and enums

- Credential types, discount types, categories, and verification states are **enums /
  lookup tables**, designed to be extended without core-schema migrations.
- Use the canonical enum names from the specs (e.g., `PHYSICAL_STUDENT_ID`, `PERCENT`,
  `COMMUNITY_VERIFIED`) consistently across DB, API, and UI.

## SQL and spatial

- Always use parameterized queries. Never interpolate user input into SQL strings.
- Use `geography(Point, 4326)`; index with GiST; prefer `ST_DWithin` for radius,
  `<->` (KNN) for nearest, `&&` with `ST_MakeEnvelope` for viewport.

## Comments

- Comment the *why*, especially for trust logic and any place a shortcut was taken for
  hackathon scope (mark with `// HACKATHON-SCOPE:`).
