---
inclusion: always
---

# perq — Kiro Workflow (artifacts are part of the submission)

This is an entry in the "Within Reach" Kiro Hackathon. The project **must be built with
Kiro**, and *how* Kiro is used is part of what is judged. Kiro artifacts are deliverables,
not scaffolding to discard. Keep them clean, honest, and demonstrable.

## Steering

The `.kiro/steering/` set encodes perq's principles and rules and is always in context:

- `product-principles.md` — north-star question, trust-first, MVP guardrails.
- `architecture.md` — modular monolith, PostGIS owns geo, AWS choices justified.
- `security.md` — SSRF, authz, abuse resistance, privacy.
- `testing.md` — the six must-test deterministic pieces.
- `coding-standards.md` — TS strict, structure, spatial patterns.
- `ai-and-evidence.md` — **the invariant**: AI is never sufficient evidence alone.

## Specs

Features are built through Kiro Specs (`requirements -> design -> tasks`), not one giant
prompt. Planned specs, in rough dependency order:

1. `foundation-and-data-model` (MVP)
2. `auth-and-profile` (MVP)
3. `geospatial-discovery-api` (MVP)
4. `map-and-discovery-ui` (MVP)
5. `eligibility-engine` (MVP)
6. `community-verification` (MVP)
7. `official-verification-and-ai-extraction` (MVP)
8. `reverification-pipeline` (STRETCH — written, built only if core lands early)

## Hooks

Event-driven automation lives in `.kiro/hooks/`:

- typecheck on save, lint on save, `prisma validate` on schema save, tests after a spec
  task completes. Keep the set small and high-value.

## MCP

Add MCP only where it genuinely helps. Candidate: a **PostgreSQL MCP server** for
inspecting the DB and iterating on PostGIS queries during development (PostGIS is new to
this developer). Skip generic web-fetch MCP — it overlaps with the guarded extraction
endpoint and adds SSRF surface.

## Keep a "how Kiro was used" log

Maintain notes on which specs drove which features and which hooks caught what. This
feeds the required Builder Center blog post and the submission writeup. Honest, specific
examples ("the prisma-validate hook caught an invalid relation before migration") are
worth more than generic praise.
