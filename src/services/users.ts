/**
 * perq — user provisioning + account helpers.
 *
 * Links a verified identity (AuthClaims) to a perq User. Provisioning is idempotent by the
 * provider subject (authProviderId). Stores the provider-asserted email + verified status.
 * NEVER stores any ID scan/photo or credential proof.
 */
import type { Pool } from "pg";
import type { AuthClaims } from "../auth/claims.js";

export interface PerqUser {
  id: string;
  authProviderId: string;
  emailVerified: boolean;
  university: string | null;
  universityCountry: string | null;
  trustLevel: string;
}

/**
 * Get-or-create the perq user for a verified subject, refreshing emailVerified/email.
 * Idempotent: one `sub` always maps to exactly one user (unique authProviderId + upsert).
 */
export async function provisionUser(pool: Pool, claims: AuthClaims): Promise<PerqUser> {
  const { rows } = await pool.query<PerqUser>(
    `INSERT INTO users (id, "authProviderId", email, "emailVerified")
       VALUES (gen_random_uuid(), $1, $2, $3)
     ON CONFLICT ("authProviderId") DO UPDATE
       SET email = EXCLUDED.email,
           "emailVerified" = EXCLUDED."emailVerified"
     RETURNING id, "authProviderId", "emailVerified", university,
               "universityCountry", "trustLevel"::text AS "trustLevel"`,
    [claims.sub, claims.email, claims.emailVerified],
  );
  return rows[0]!;
}

/**
 * Deterministic legitimacy check: only verified-email accounts may contribute community
 * confirmations. Consumed by the community-report flow (foundation `reports` service will
 * gate on this in the community spec). Pure boolean.
 */
export function canContributeCommunityConfirmation(user: {
  emailVerified: boolean;
}): boolean {
  return user.emailVerified === true;
}
