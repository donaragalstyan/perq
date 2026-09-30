# Auth and Profile — Design

## Overview

Identity comes from Amazon Cognito, but perq depends on a minimal **claims contract** behind
a `TokenVerifier` interface. The Cognito adapter validates a JWT and reduces it to
`AuthClaims`. Provisioning links a verified `sub` to a perq `User`. Profile and credential
services are owner-scoped and private. No ID proof is ever stored.

This design keeps the trust-critical, testable logic (claims validation, provisioning,
authz, credential rules) independent of the provider SDK, so:
- unit tests run without Cognito, and
- swapping to Clerk (fallback) means writing one new `TokenVerifier` adapter, nothing else.

## Provider-agnostic boundary

```
Request (Authorization: Bearer <jwt>)
  -> TokenVerifier.verify(token) -> AuthClaims { sub, email, emailVerified }   [adapter]
  -> provisionUser(claims) -> User (authProviderId = sub, emailVerified stored) [pure-ish svc]
  -> profile / credential services (owner-scoped)                              [pure-ish svc]
```

### Interfaces

```ts
interface AuthClaims { sub: string; email: string; emailVerified: boolean }

interface TokenVerifier {
  verify(token: string): Promise<AuthClaims>; // throws on invalid/expired/wrong-aud
}
```

- **CognitoTokenVerifier**: validates signature via the pool JWKS, checks `iss` (the pool
  URL), `aud`/`client_id`, and `exp`; maps `sub`, `email`, `email_verified` to `AuthClaims`.
  The pure mapping/validation of an already-decoded token payload is separated into a
  `claimsFromPayload(payload)` function so it is unit-testable without network/JWKS.
- Fallback: a `ClerkTokenVerifier` could be added later with the same interface; nothing
  downstream changes.

### Cognito configuration (documented, minimal for MVP)

- User pool with email sign-in + a Google identity provider (hosted UI).
- App client (public, PKCE) for the web app; issues JWTs with `email` and `email_verified`.
- Config via env: `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, region. No secrets committed.
- Phase note: wiring the hosted-UI redirect is app-shell work; this spec delivers the
  server-side verification + profile/credential logic and does not build UI polish.

## Data model (reuses foundation; one additive column)

`User` already has `authProviderId`, `university`, `universityCountry`, `trustLevel`. We add:

```
User.emailVerified  Boolean @default(false)   // provider-asserted; private
```

This is an additive, backward-compatible column. `UserCredential` is unchanged
(`UNIQUE(userId, credentialType)`, no proof). No new tables.

## Services

### provisionUser(prisma, claims): User
- Upsert by `authProviderId = claims.sub`: create if missing; always refresh `emailVerified`.
- Idempotent; never creates two users for one `sub`. Never stores proof.

### profile service (owner-scoped)
- `getProfile(userId)` / `updateProfile(userId, { university?, universityCountry? })`.
- All functions take the authenticated `userId` from verified claims; there is no parameter
  by which one user can address another's data — the authz boundary is structural.
- Validates `universityCountry` as `[A-Za-z]{2}` when provided.

### credential service (owner-scoped)
- `listCredentials(userId)`, `addCredential(userId, type)` (idempotent via unique constraint),
  `removeCredential(userId, type)`.
- `canContributeCommunityConfirmation(user)` = `user.emailVerified === true`. Community
  report counting (foundation `reports` service) will consult this in the community spec;
  here we expose the deterministic check and test it.

## Authorization boundary

The API layer resolves the caller to a `userId` via `TokenVerifier` + `provisionUser`, then
passes only that `userId` into services. Services never accept a "target user id" distinct
from the caller, so cross-user access is impossible by construction. (Admin flows are a later
concern and out of scope here.)

## Privacy

- `emailVerified`, `email`, `authProviderId`, `university`, `universityCountry`, and held
  credentials are private. They are never selected by public query shapes.
- Regression test: the existing `publicQueries` forbidden-field scan is extended to include
  `emailVerified` and `email`.

## Verification / testing

- Pure unit tests: `claimsFromPayload` (valid, missing email, unverified, wrong issuer/aud,
  expired); `canContributeCommunityConfirmation`.
- Integration tests (local Postgres): provisioning idempotency; profile owner-scoped
  read/update + country validation; credential add/list/remove + uniqueness; privacy
  regression (no PII in public shapes).
- No live Cognito calls in tests — the verifier is exercised via `claimsFromPayload` and a
  fake `TokenVerifier`.

## Out of scope (this spec)

Hosted-UI theming, session cookie plumbing/refresh rotation, geospatial discovery, Mapbox UI,
Bedrock, Overture ingestion, admin tooling, reputation, uploads.
