import { describe, expect, it } from "vitest";
import { AuthError, claimsFromPayload, type JwtPayload } from "./claims.js";

const ISSUER = "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_abc123";
const AUD = "client-abc";
const NOW = 1_700_000_000_000; // fixed ms
const FUTURE_EXP = Math.floor(NOW / 1000) + 3600; // 1h ahead
const PAST_EXP = Math.floor(NOW / 1000) - 10;

function base(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    iss: ISSUER,
    aud: AUD,
    exp: FUTURE_EXP,
    sub: "sub-123",
    email: "student@uw.edu",
    email_verified: true,
    token_use: "id",
    ...overrides,
  };
}

const expectations = { issuer: ISSUER, audience: AUD, nowMs: NOW };

describe("claimsFromPayload", () => {
  it("maps a valid ID-token payload to AuthClaims", () => {
    const c = claimsFromPayload(base(), expectations);
    expect(c).toEqual({ sub: "sub-123", email: "student@uw.edu", emailVerified: true });
  });

  it("accepts client_id (access token) in place of aud", () => {
    const c = claimsFromPayload(
      base({ aud: undefined, client_id: AUD, token_use: "access" }),
      expectations,
    );
    expect(c.sub).toBe("sub-123");
  });

  it('treats email_verified string "true" as verified, else false', () => {
    expect(claimsFromPayload(base({ email_verified: "true" }), expectations).emailVerified).toBe(true);
    expect(claimsFromPayload(base({ email_verified: "false" }), expectations).emailVerified).toBe(false);
    expect(claimsFromPayload(base({ email_verified: false }), expectations).emailVerified).toBe(false);
    expect(claimsFromPayload(base({ email_verified: undefined }), expectations).emailVerified).toBe(false);
  });

  it("rejects a wrong issuer", () => {
    expect(() => claimsFromPayload(base({ iss: "https://evil" }), expectations)).toThrow(AuthError);
  });

  it("rejects a wrong audience/client_id", () => {
    expect(() =>
      claimsFromPayload(base({ aud: "other", client_id: undefined }), expectations),
    ).toThrow(/audience/);
  });

  it("rejects an expired token", () => {
    expect(() => claimsFromPayload(base({ exp: PAST_EXP }), expectations)).toThrow(/expired/);
  });

  it("rejects a missing subject", () => {
    expect(() => claimsFromPayload(base({ sub: undefined }), expectations)).toThrow(/subject/);
  });

  it("rejects a missing email", () => {
    expect(() => claimsFromPayload(base({ email: undefined }), expectations)).toThrow(/email/);
  });
});
