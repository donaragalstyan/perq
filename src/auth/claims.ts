/**
 * perq — identity claims contract (PURE).
 *
 * perq trusts only a minimal set of identity facts. Everything downstream (provisioning,
 * profile, credentials) depends on `AuthClaims`, not on any provider SDK. The pure
 * `claimsFromPayload` reduces an already-decoded/verified JWT payload to `AuthClaims` and
 * enforces the non-cryptographic invariants (issuer, audience, expiry, required fields), so
 * it is fully unit-testable without network or JWKS.
 *
 * Cryptographic signature verification lives in the provider adapter (see cognito.ts).
 */

export interface AuthClaims {
  /** Stable opaque provider subject id -> stored as User.authProviderId. */
  sub: string;
  email: string;
  emailVerified: boolean;
}

/** A verifier turns a bearer token into AuthClaims, or throws. Provider-agnostic. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthClaims>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Shape of the relevant JWT payload fields (post-decode). */
export interface JwtPayload {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  iss?: unknown;
  aud?: unknown;
  client_id?: unknown; // Cognito access tokens use client_id instead of aud
  exp?: unknown; // seconds since epoch
  token_use?: unknown; // "id" | "access"
}

export interface ClaimsExpectations {
  /** Expected issuer, e.g. https://cognito-idp.<region>.amazonaws.com/<poolId>. */
  issuer: string;
  /** Expected audience / client id. */
  audience: string;
  /** Injectable clock for deterministic tests (ms). Defaults to Date.now(). */
  nowMs?: number;
}

/**
 * Reduce a decoded JWT payload to AuthClaims, enforcing issuer/audience/expiry and required
 * fields. Throws AuthError on any violation. Pure and deterministic.
 */
export function claimsFromPayload(
  payload: JwtPayload,
  expect: ClaimsExpectations,
): AuthClaims {
  const nowMs = expect.nowMs ?? Date.now();

  if (typeof payload.iss !== "string" || payload.iss !== expect.issuer) {
    throw new AuthError("invalid issuer");
  }

  // ID tokens carry `aud`; access tokens carry `client_id`. Accept either matching value.
  const aud = typeof payload.aud === "string" ? payload.aud : undefined;
  const clientId =
    typeof payload.client_id === "string" ? payload.client_id : undefined;
  if (aud !== expect.audience && clientId !== expect.audience) {
    throw new AuthError("invalid audience");
  }

  if (typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs) {
    throw new AuthError("token expired");
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new AuthError("missing subject");
  }

  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw new AuthError("missing email");
  }

  // Cognito emits email_verified as boolean or the string "true"/"false".
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";

  return { sub: payload.sub, email: payload.email, emailVerified };
}
