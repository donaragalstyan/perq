/**
 * perq — credential service (owner-scoped, self-asserted, private).
 *
 * Users record which credential types they HOLD. Credentials are self-asserted: NO proof,
 * scan, or photo is ever stored (product-principles + security). One row per
 * (userId, credentialType), enforced by the DB unique constraint (idempotent add).
 *
 * Owner-scoped: functions take only the caller's userId; no cross-user access is possible.
 */
import type { Pool } from "pg";
import type { CredentialType } from "../domain/types.js";

const VALID_CREDENTIALS: ReadonlySet<CredentialType> = new Set<CredentialType>([
  "PHYSICAL_STUDENT_ID",
  "EDU_EMAIL",
  "ANY_UNIVERSITY_ID",
  "ISIC",
  "UNIDAYS",
  "STUDENT_BEANS",
  "OTHER",
]);

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** List the caller's held credential types. */
export async function listCredentials(
  pool: Pool,
  userId: string,
): Promise<CredentialType[]> {
  const { rows } = await pool.query<{ credentialType: CredentialType }>(
    `SELECT "credentialType"::text AS "credentialType"
       FROM user_credentials WHERE "userId" = $1
      ORDER BY "credentialType"`,
    [userId],
  );
  return rows.map((r) => r.credentialType);
}

/** Add a held credential (idempotent — unique constraint prevents duplicates). */
export async function addCredential(
  pool: Pool,
  userId: string,
  credentialType: CredentialType,
): Promise<void> {
  if (!VALID_CREDENTIALS.has(credentialType)) {
    throw new ValidationError(`unknown credential type: ${credentialType}`);
  }
  await pool.query(
    `INSERT INTO user_credentials (id, "userId", "credentialType")
       VALUES (gen_random_uuid(), $1, $2::"CredentialType")
     ON CONFLICT ("userId", "credentialType") DO NOTHING`,
    [userId, credentialType],
  );
}

/** Remove a held credential (no-op if absent). */
export async function removeCredential(
  pool: Pool,
  userId: string,
  credentialType: CredentialType,
): Promise<void> {
  await pool.query(
    `DELETE FROM user_credentials
      WHERE "userId" = $1 AND "credentialType" = $2::"CredentialType"`,
    [userId, credentialType],
  );
}
