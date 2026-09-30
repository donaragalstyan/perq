# Auth and Profile — Requirements

## Introduction

This spec adds authentication and the perq user profile. Identity is provided by Amazon
Cognito (email + Google), but perq depends only on a small, verifiable **claims contract**
(subject id, email, email-verified) behind a swappable verifier, so the trust-critical
profile/credential logic is testable without Cognito and the provider can be replaced (Clerk
is the pre-approved fallback).

The perq profile and self-asserted credentials are stored separately from the identity
provider, kept private by default, and never exposed through public query shapes. No student
ID scans/photos are ever required or stored.

Aligned with steering: `product-principles`, `security`, `coding-standards`, `testing`.
Builds on the `foundation-and-data-model` schema (User, UserCredential) — treated as stable.

## Glossary

- **AuthClaims** — the minimal identity facts perq trusts: `{ sub, email, emailVerified }`.
- **subject / sub** — the stable opaque identity id from the provider (Cognito subject),
  stored as `User.authProviderId`.
- **verified email** — provider-asserted `email_verified === true`.

## Requirements

### Requirement 1 — Provider-agnostic identity verification

**User story:** As the system, I want to verify a caller's identity from a bearer token and
reduce it to a minimal claims contract, so auth logic is testable and the provider is
swappable.

#### Acceptance criteria
1. THE system SHALL define an `AuthClaims` contract of `{ sub: string, email: string,
   emailVerified: boolean }`.
2. THE system SHALL define a `TokenVerifier` interface that turns a bearer token into
   `AuthClaims` or rejects it.
3. THE system SHALL provide a Cognito adapter implementing `TokenVerifier` by validating the
   token's signature, issuer, audience, and expiry against the Cognito user pool.
4. THE system SHALL reject tokens that are malformed, expired, or fail issuer/audience
   validation.
5. THE claims-reduction logic SHALL be unit-testable without network access to Cognito.

### Requirement 2 — Email and Google sign-in; verified-email tracking

**User story:** As a student, I want to sign in with email or Google; as the system, I want
to know whether the email is verified, because community verification depends on legitimate,
unique accounts.

#### Acceptance criteria
1. THE Cognito configuration SHALL support email/password and Google as sign-in methods.
2. THE system SHALL record the provider-asserted verified-email status on the perq user.
3. WHERE an account's email is not verified, THE system SHALL treat it as not eligible to
   contribute community confirmations (enforced in Requirement 5).

### Requirement 3 — Provisioning: link identity to a perq user

**User story:** As the system, I want a perq user row for each authenticated subject, created
on first authenticated request, so profile/credential data has a stable owner.

#### Acceptance criteria
1. WHEN an authenticated request presents valid claims for a `sub` with no existing user,
   THE system SHALL create a perq `User` with `authProviderId = sub`.
2. THE system SHALL persist the verified-email status on the user and update it when it
   changes.
3. THE system SHALL NOT store any student ID scan, photo, or credential proof.
4. Provisioning SHALL be idempotent (same `sub` never creates two users).

### Requirement 4 — Profile (owner-only)

**User story:** As a student, I want to set my university and university country; as the
system, I want only the owner to read/modify their profile.

#### Acceptance criteria
1. A user SHALL be able to read and update their own `university` and `universityCountry`
   (ISO 3166-1 alpha-2), both optional.
2. THE system SHALL reject any attempt by one user to read or modify another user's profile
   (authorization boundary).
3. THE system SHALL validate `universityCountry` as a 2-letter code when provided.

### Requirement 5 — Self-asserted credentials

**User story:** As a student, I want to record which credentials I hold; as the system, I
want one row per (user, credentialType) and no proof stored.

#### Acceptance criteria
1. A user SHALL be able to add, list, and remove their held credential types (from the
   `CredentialType` enum). Credentials are self-asserted; NO proof is stored.
2. THE system SHALL enforce one row per `(userId, credentialType)` (idempotent add).
3. A user SHALL only manage their own credentials (authorization boundary).
4. WHERE community actions require legitimacy, THE system SHALL require the acting user's
   email to be verified before their report counts toward community confirmation.

### Requirement 6 — Privacy: profile/credentials never public

**User story:** As a student, I want my university, country, credentials, email, and identity
to never appear in public data.

#### Acceptance criteria
1. Public query shapes SHALL NOT include `university`, `universityCountry`, held
   credentials, `email`, `emailVerified`, or `authProviderId`.
2. THE profile/credential read APIs SHALL return data only for the authenticated owner.
3. Existing public discount/evidence shapes SHALL remain free of user PII (regression-tested).
