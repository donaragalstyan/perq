# Auth and Profile — Tasks

- [ ] 1. Identity contract + verifier interface + Cognito adapter
  - `AuthClaims`, `TokenVerifier`; `claimsFromPayload(payload)` pure mapping/validation;
    `CognitoTokenVerifier` (JWKS/iss/aud/exp). Unit tests for `claimsFromPayload`.
  - _Requirements: 1.1–1.5, 2.1–2.2_

- [ ] 2. Add `emailVerified` to User (additive migration) + provisioning
  - Prisma additive column `emailVerified Boolean @default(false)`; re-apply spatial migration
    via `db:sync`. `provisionUser(claims)` upsert-by-sub, idempotent, refreshes emailVerified,
    stores no proof. Integration tests.
  - _Requirements: 2.2, 3.1–3.4_

- [ ] 3. Profile service (owner-scoped)
  - get/update own `university` + `universityCountry`; country validation; structural authz.
    Integration tests incl. cross-user impossibility.
  - _Requirements: 4.1–4.3_

- [ ] 4. Credential service (self-asserted)
  - add/list/remove; idempotent add via unique constraint; no proof;
    `canContributeCommunityConfirmation(user)` = emailVerified. Unit + integration tests.
  - _Requirements: 5.1–5.4_

- [ ] 5. Privacy regression
  - Extend the public-shape forbidden-field scan to include `email`, `emailVerified`; confirm
    profile/credential reads are owner-only.
  - _Requirements: 6.1–6.3_

- [ ] 6. Checks + DEV_LOG
  - typecheck/lint/prisma validate/tests; log decisions + any Cognito blockers.
  - _Requirements: supports submission_
