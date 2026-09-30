# perq — Development Log (Kiro usage)

A lightweight, running record of meaningful Kiro usage for the hackathon submission and the
Builder Center writeup. Keep entries concrete: which Spec drove which feature, which
Steering decision shaped code, which Hook caught a real issue, what architecture changed
because of a Kiro conversation.

## Format

```
### YYYY-MM-DD — short title
- Context: what we were doing
- Kiro artifact: spec / steering / hook / mcp / chat
- Concrete outcome: what it produced or caught
```

## Entries

### 2026-09-29 — Design conversation and scaffolding
- Context: designing perq end-to-end before writing implementation code.
- Kiro artifact: chat (architecture review) + Steering + first Spec.
- Concrete outcome:
  - Created 7 Steering files (`product-principles`, `architecture`, `security`,
    `ai-and-evidence`, `testing`, `coding-standards`, `kiro-workflow`). The
    `ai-and-evidence` invariant — "An AI-generated claim is never sufficient evidence by
    itself for publicly displaying a student discount" — is now always in context.
  - Kiro challenged scope: cut autonomous AI discovery to a single human-gated Bedrock
    extraction endpoint; reduced four hero cities to two (Seattle + Prague) for real seed
    data; dropped a redundant `PENDING_COMMUNITY_VERIFICATION` state.
  - Recommended **RDS PostgreSQL over Aurora** (no scale/HA need; simpler, cheaper;
    identical PostGIS support) and **Cognito** for auth (email verification supports
    community-verification integrity).
  - Defined a deterministic conflict-detection threshold (3 unique, agreeing, more-recent
    contradicting reports in a 90-day window -> NEEDS_REVERIFICATION) and recorded it in
    `testing` steering and the foundation spec.
  - Created the `foundation-and-data-model` Spec (requirements/design/tasks). Task 2 is a
    PostGIS proof-of-concept to validate the riskiest assumption before further build.

### 2026-09-29 — Mapbox place-data storage terms (POC Task 1)
- Context: before designing production place-ingestion around Mapbox, verify whether we may
  persist Mapbox-derived place/coordinate attributes in our own PostgreSQL/PostGIS DB.
- Kiro artifact: chat (web verification), gating decision for a later spec.
- Concrete outcome — **FLAG: storage is NOT allowed by default.**
  - Mapbox Geocoding/Search distinguishes **temporary** (default) vs **permanent**
    geocoding. Per Mapbox docs (Understand Temporary versus Permanent Geocoding):
    - **Temporary (default):** display + real-time use permitted, but **storing the
      coordinate results is restricted** — session-only.
    - **Permanent (`permanent=true`):** storage in a database/cache is permitted, at a
      **higher cost per request**.
  - Implication for perq: we **cannot** freely cache Mapbox place results in Postgres/
    PostGIS under the default temporary mode. Persisting requires permanent geocoding
    (paid, per-request extended rights) and/or must be validated against the current MSA/
    Product Terms and pricing at build time.
  - Decision for production place-ingestion (later spec, NOT the POC): do not architect the
    ingestion flow assuming free caching of Mapbox data. Options to evaluate then:
    (a) use `permanent=true` for the specific records we persist and budget for it;
    (b) source persistent business/place records from an openly licensed dataset
        (e.g., OpenStreetMap/Overture) and use Mapbox only for live/temporary search + tiles;
    (c) store only our own derived data + user-submitted business info, not Mapbox's.
  - Sources: docs.mapbox.com "Understand Temporary versus Permanent Geocoding";
    mapbox.com/legal/tos and /legal/product-terms (verify exact clauses + pricing at
    implementation time). Content rephrased for compliance with licensing restrictions.
  - POC impact: none — the POC uses **synthetic** data only, so no Mapbox storage question
    arises. This flag applies only to the future real place-ingestion design.

### 2026-09-29 — PostGIS + Mapbox POC built and evaluated against the gate
- Context: Phase 0 vertical slice to validate the riskiest assumption (PostGIS spatial
  queries feeding a Mapbox map) before any feature specs.
- Kiro artifact: foundation-and-data-model spec Task 2 + docs/POC.md gate.
- What was built (in `poc/`, throwaway, synthetic data only):
  - Docker `postgis/postgis:16-3.4` (PostGIS 3.4.3 / PG16), healthcheck.
  - Prisma relational schema + raw SQL migration for `geography(Point,4326)` + GiST index.
  - Synthetic seed: 30 `[SYN]`-prefixed Seattle + Prague points (clearly separated from
    any future real demo data).
  - Spatial module (parameterized raw SQL): withinRadius (`ST_DWithin` + `ST_Distance`),
    nearest (`<->` KNN), withinViewport (`ST_MakeEnvelope`), all returning lng/lat.
  - Express endpoints: `/api/nearby`, `/api/viewport`, `/api/config`; bare Mapbox map page
    that re-queries the viewport on `moveend` and drops markers (no-token fallback list).
  - Integration tests: 6/6 pass, incl. an explicit lng/lat-order assertion (~1 km east
    within 800–1200 m tolerance) and Seattle/Prague bbox separation.
- Gate evaluation (docs/POC.md):
  1. PostGIS + 30 pts + GiST index — PASS (verified via `\d businesses` + seed count).
  2. `/api/nearby` parameterized `ST_DWithin` + category + meters — PASS (live curl: 15
     nearest-first; CAFE filter -> 2; bad params -> 400).
  3. Mapbox map markers + re-query on pan — PARTIAL: query loop + endpoints + client wiring
     verified; NOT yet eyeballed in a browser with a real Mapbox token (.env placeholder).
  4. Queries instant + Prisma/raw-SQL workflow comfortable — PASS (tests ~154 ms; split
     worked cleanly).
  5. Mapbox storage terms — PASS w/ FLAG: storing place data is not permitted by default
     (temporary mode); persistence needs `permanent=true` (paid) or openly-licensed data.
     POC unaffected (synthetic only).
- Verdict: **PASS with one open item** — before Phase 1 UI work, render the map in a browser
  with a real `MAPBOX_PUBLIC_TOKEN` to confirm criterion 3 visually. The load-bearing
  risk (PostGIS spatial querying + the Prisma/raw-SQL pattern) is validated.
- Friction notes: `ST_MakePoint` is (lng, lat) — asserted in tests; `prisma validate` needs
  `.env` loaded; the arm64 host pulled an amd64 PostGIS image (runs under emulation, fine
  for POC scale). Prisma postinstall scripts were gated by an allow-scripts policy but the
  client generated fine via `prisma generate`.

### 2026-09-29 — Production place-data strategy decided (Overture + Mapbox split)
- Context: before choosing production place-ingestion, compare sources for permanently
  storing real business/place data (name, coords, address, category) in our PostGIS.
- Kiro artifact: chat (licensing investigation) -> docs/PLACE_DATA_STRATEGY.md.
- Decision: **persist real places from Overture Maps Places (CDLA Permissive 2.0) as our
  canonical PostGIS data; use Mapbox only for map rendering + temporary search (never store
  Mapbox place data).**
- Why: Overture Places is permissive (no share-alike). CDLA §3.1 places no restrictions on
  "Results," so combining place data with our discount/evidence/community data is clean; the
  only obligation is shipping the CDLA text if we redistribute the raw data (we don't). OSM
  is free but ODbL is share-alike and creates derivative-database/attribution ambiguity best
  avoided in a solo hackathon. Mapbox permanent geocoding works but is paid and lock-in.
  Overture Places is CDLA specifically because it's conflated from Meta/Microsoft/Foursquare,
  not OSM — so choosing it sidesteps ODbL. Coverage/quality strong in Seattle + Prague.
- Schema impact for foundation spec: add `source = OVERTURE` and keep `externalPlaceId` for
  the Overture GERS id (enables future re-sync). Confirmed three data tiers stay distinct:
  (1) synthetic test fixtures [SYN], (2) imported real Overture places, (3) perq-specific
  discount/evidence/community data.
- Ingestion (future spec, not now): bounded bbox extract of Overture Places (DuckDB/
  overturemaps CLI) for Seattle + Prague -> transform -> parameterized load. No live
  crawling, no SSRF surface. Place import never creates a visible discount by itself.
- POC untouched, per instruction.

### 2026-09-29 — Foundation spec + docs updated for Overture/Mapbox split
- Context: fold the agreed place-data strategy into the spec, steering, and design docs
  before Phase 1. POC left untouched.
- Kiro artifact: foundation-and-data-model spec + architecture steering + DESIGN.md + LICENSES.
- Concrete changes:
  - requirements.md: Requirement 1 now defines `source` = OVERTURE|MANUAL|AI_CANDIDATE|
    SYNTHETIC, `externalPlaceId` = Overture/GERS id, internal `Business.id` as the stable FK
    target, and PostGIS as canonical (Mapbox = rendering only). Requirement 8 rewritten as
    three data tiers with refresh-safety (8.4). New Requirement 10 = provenance + CDLA
    attribution obligations.
  - design.md: BusinessSource enum updated; Business table gains `importedAt` + indexed
    `externalPlaceId` and a note that Tier 3 references internal id only; added a
    "Place-data strategy" section (Overture canonical, refresh safety, licensing) and a
    three-tier seeding split (synthetic / demo-places / demo).
  - tasks.md: Task 3 notes the enum/provenance; Task 10 becomes the three-tier seeding with a
    note that Overture *ingestion* is a future spec.
  - architecture.md steering: added "Place data: Overture (canonical) + Mapbox (rendering)".
  - DESIGN.md: corrected the earlier "storable Mapbox place data" line; added Overture as the
    persistent place source.
  - LICENSES/: added CDLA-Permissive-2.0.txt (satisfies §2.1) + README explaining obligations.
- NOT done (per instruction): no Overture ingestion implementation; POC data unchanged.

### 2026-09-29 — Phase 1 Tasks 1 & 3: root app scaffold + schema
- Context: begin the real perq app at the workspace root (poc/ stays isolated).
- Kiro artifact: foundation-and-data-model spec Tasks 1, 3.
- Concrete outcome:
  - Scaffolded Next.js (App Router) + TS strict, Prisma, Vitest, ESLint, docker-compose.
  - Dev DB `perq-db` on host port **5433** (POC uses 5432 — chosen to avoid a clash so both
    can run side by side).
  - Full Prisma schema: User, UserCredential, Business, Discount, Evidence, CommunityReport,
    StateTransition + all enums. BusinessSource = OVERTURE|MANUAL|AI_CANDIDATE|SYNTHETIC;
    Business has externalPlaceId + importedAt (indexed); uniqueness on
    UserCredential(userId,credentialType) and CommunityReport(reporterUserId,claimKey).
  - `prisma db push` created 8 app tables; raw SQL migration added geography(Point,4326) +
    GiST index to businesses. Verified via `\d businesses`. FKs from discounts/reports target
    the internal businesses.id (not externalPlaceId), as designed.
  - Shared clients in src/lib/db.ts (Prisma for relational, pg Pool for spatial raw SQL).
  - Checks: `prisma validate` OK, typecheck exit 0, lint exit 0.

### 2026-09-29 — Phase 1 Task 4: normalization + claimKey (pure module)
- Context: implement the deterministic report normalization and claimKey (the "materially
  matching" decision) with no LLM.
- Kiro artifact: foundation spec Task 4 / Requirement 6; testing steering (must-test items 1-2).
- Concrete outcome: `src/domain/normalization.ts` + 19 unit tests, all green.
- Issue found & decision (clarification, not a redesign):
  - The canonical example (Req 6.4) requires "15% off", "...college card", "Student ID =
    15% off" to share a claimKey. But "15% off" alone names NO credential, so pure text
    inference gave credential=OTHER while the others gave PHYSICAL_STUDENT_ID -> different
    keys. Two real regex bugs also surfaced (`%\b` never matches before a space; `\bstudent\b`
    misses "students").
  - Resolution consistent with the spec: Requirement 6.1 says a report carries a structured
    `normalizedCredential`. So `normalizeText(text, credentialHint?)` now resolves credential
    as: specific-in-text > structured hint > text-only fallback. The canonical phrases share a
    claimKey when reported in the same student-ID context (hint), deterministically and with
    no LLM (Req 6.5). This clarified the function contract; the data model is unchanged.
  - Fixed the two regex bugs; added precedence tests (specific text beats hint; hint used
    when text is generic).
- Checks: 19/19 tests pass; typecheck 0; lint 0 (removed an unused import the lint hook would
  have caught).

### 2026-09-29 — Phase 1 Tasks 5-7: state machine, quorum, conflict (flag-first decision)
- Context: implement the deterministic verification lifecycle and community-report handling.
- Kiro artifact: foundation spec Tasks 5-7 / Requirements 5-7; ai-and-evidence + testing steering.
- Concrete outcome:
  - Task 5: `src/domain/stateMachine.ts` (pure) — evaluateTransition is the single authority
    on transition legality; AI_EXTRACTION can never publish (structural); confidenceScore for
    ordering. 23 tests.
  - Task 6: `src/services/reports.ts` — transactional submitReport; one-per-account via 23505
    unique-violation handling; distinct-reporter quorum (3) promotes UNCONFIRMED ->
    COMMUNITY_VERIFIED with an audit row. 3 integration tests.
  - Task 7: `src/domain/conflict.ts` (pure, 9 tests) + `src/services/conflict.ts` (integration).
- Decision surfaced & escalated to the user — **flag-first conflict resolution**:
  - Because the conflict threshold == community quorum (both 3), a real competing claim would
    hit BOTH the conflict trip and the supersede condition at the same instant, so my first
    implementation silently swapped the verified value. Flagged this as a behavior decision.
  - User chose Option 1 (flag-first): on conflict, ALWAYS transition to NEEDS_REVERIFICATION;
    never auto-swap the verified claim, even at competing quorum. Preserve the competing claim
    (claimKey + reporter count) as structured disagreement evidence; competing quorum only
    marks the claim supersede-ELIGIBLE for a future re-verification flow. Keep the single
    threshold of 3.
  - Applied across: Requirement 7.4 (+ new 7.6), design.md conflict section + state diagram,
    src/services/conflict.ts (always NEEDS_REVERIFICATION; audit reason is JSON with
    verifiedKey/competingKey/competingDistinctReporters/supersedeEligible), and tests.
- Issue found & fixed: integration test files share one local DB and each TRUNCATEs between
  tests; parallel file execution caused a mid-test FK violation. Fixed by setting Vitest
  `fileParallelism: false` + `singleFork` so DB tests run sequentially. All 57 tests green.
- Checks: 57/57 tests pass; typecheck 0; lint 0.

### 2026-09-29 — Phase 1 Tasks 8-10: evidence, public queries, three-tier seeding
- Context: finish the data-layer services and the tier-separated seeding.
- Kiro artifact: foundation spec Tasks 8-10 / Requirements 3, 8, 9, 10.
- Concrete outcome:
  - Task 8: `src/services/evidence.ts` — privileged official evidence -> OFFICIALLY_VERIFIED;
    AI_EXTRACTION stored but structurally cannot publish; createdByUserId never public. 4 tests.
  - Task 9: `src/services/publicQueries.ts` — explicit PublicDiscount/PublicEvidence DTOs;
    only visible statuses; aggregate confirmationCount; forbidden-field scan test. 4 tests.
  - Task 10: three tiers wired — `prisma/seed/synthetic.ts` (SYNTHETIC, deletes only its own
    rows), `demo-places.ts` (OVERTURE real places, upsert by external_place_id),
    `demo.ts` (real discounts). Result: 10 SYNTHETIC + 3 OVERTURE, 0 discounts.
- Trust decision (data quality): demo.ts ships NO fabricated discounts. Each entry is a
  template requiring real evidence (sourceUrl + sourceSnippet + checkedAt) and `verified:true`
  before it loads; unverified templates are skipped with a warning. So the demo never shows a
  discount we haven't backed with real evidence — consistent with product-principles. The
  developer fills these in from official pages before the demo.
- Schema refinement: made `externalPlaceId` UNIQUE (re-sync match key for Overture refresh,
  Req 8.4) — enables the upsert-by-GERS in demo-places.ts.
- Issue found & fixed (important operational gotcha): `prisma db push` DROPPED the raw-SQL
  `location` column (Prisma doesn't manage it), breaking the seeds. Fix: always re-apply the
  spatial migration after a push. Added `npm run db:sync` (push + spatial migration) and
  documented it in design.md Migrations. Also found the unique-constraint push hangs on an
  interactive prompt — use `--accept-data-loss` non-interactively.
- Checks: 65/65 tests pass; typecheck 0; lint 0.

### 2026-09-29 — Phase 1 Task 11: hooks wiring verified; foundation complete
- Context: confirm the Kiro hooks run against the real project and close out Phase 1.
- Kiro artifact: foundation spec Task 11 / kiro-workflow steering.
- Concrete outcome:
  - All 5 hook files in `.kiro/hooks/` parse as valid JSON.
  - Each command hook succeeds against the project: `npm run lint` (0), `npm run typecheck`
    (0), `npx prisma validate` (0), `npm run test -- --run` (0). The npm scripts the hooks
    reference now exist, so the hooks are live from the next session.
  - Added a root `README.md` with setup/run/test instructions (incl. the `db:sync` gotcha).
- Phase 1 foundation status: COMPLETE. 7 test files, 65 tests, all green; typecheck + lint +
  prisma validate clean. Deterministic trust logic (normalization/claimKey, state machine,
  quorum, conflict) and privacy-safe queries are implemented and tested. No stretch features
  built. POC remains isolated in poc/.

<!-- Add new entries above this line as the project progresses. -->
```
### YYYY-MM-DD — (next entry)
- Context:
- Kiro artifact:
- Concrete outcome:
```
