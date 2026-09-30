/**
 * perq — Cognito adapter implementing TokenVerifier.
 *
 * Uses aws-jwt-verify to validate the JWT cryptographically (signature via the pool JWKS,
 * issuer, token_use, client id, expiry). The verified payload is then reduced through the
 * PURE `claimsFromPayload` so perq's non-crypto invariants live in one testable place.
 *
 * Swappability: a Clerk adapter would implement the same TokenVerifier interface; nothing
 * downstream changes.
 */
import { CognitoJwtVerifier } from "aws-jwt-verify";
import {
  AuthError,
  claimsFromPayload,
  type AuthClaims,
  type JwtPayload,
  type TokenVerifier,
} from "./claims.js";

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
  tokenUse?: "id" | "access";
}

export class CognitoTokenVerifier implements TokenVerifier {
  private readonly verifier;
  private readonly issuer: string;
  private readonly clientId: string;

  constructor(cfg: CognitoConfig) {
    this.clientId = cfg.clientId;
    this.issuer = `https://cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`;
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: cfg.userPoolId,
      clientId: cfg.clientId,
      tokenUse: cfg.tokenUse ?? "id",
    });
  }

  async verify(token: string): Promise<AuthClaims> {
    let payload: JwtPayload;
    try {
      // Cryptographic + structural verification (signature, iss, aud/client_id, exp).
      payload = (await this.verifier.verify(token)) as unknown as JwtPayload;
    } catch (err) {
      throw new AuthError(
        `token verification failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
    // Re-assert perq invariants + reduce to AuthClaims deterministically.
    return claimsFromPayload(payload, {
      issuer: this.issuer,
      audience: this.clientId,
    });
  }
}

/** Build a verifier from environment configuration. Throws if env is missing. */
export function cognitoVerifierFromEnv(): CognitoTokenVerifier {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const region = process.env.AWS_REGION ?? process.env.COGNITO_REGION;
  if (!userPoolId || !clientId || !region) {
    throw new AuthError(
      "Cognito env not configured (COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, AWS_REGION)",
    );
  }
  return new CognitoTokenVerifier({ userPoolId, clientId, region });
}
