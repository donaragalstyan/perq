/**
 * perq — profile service (owner-scoped, private).
 *
 * Every function takes the authenticated caller's userId (resolved from verified claims).
 * There is no parameter by which one user can address another user's data, so cross-user
 * access is impossible by construction (authorization boundary). Profile fields are private
 * and never exposed by public query shapes.
 */
import type { Pool } from "pg";

export interface Profile {
  university: string | null;
  universityCountry: string | null;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Read the caller's own profile. Returns null if the user does not exist. */
export async function getProfile(pool: Pool, userId: string): Promise<Profile | null> {
  const { rows } = await pool.query<Profile>(
    `SELECT university, "universityCountry" FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export interface UpdateProfileInput {
  university?: string | null;
  universityCountry?: string | null;
}

/** Update the caller's own profile. Validates the country code when provided. */
export async function updateProfile(
  pool: Pool,
  userId: string,
  input: UpdateProfileInput,
): Promise<Profile> {
  if (
    input.universityCountry !== undefined &&
    input.universityCountry !== null &&
    !/^[A-Za-z]{2}$/.test(input.universityCountry)
  ) {
    throw new ValidationError("universityCountry must be a 2-letter ISO code");
  }

  const country =
    input.universityCountry == null ? input.universityCountry : input.universityCountry.toUpperCase();

  const { rows } = await pool.query<Profile>(
    `UPDATE users
        SET university = COALESCE($2, university),
            "universityCountry" = COALESCE($3, "universityCountry")
      WHERE id = $1
      RETURNING university, "universityCountry"`,
    [userId, input.university ?? null, country ?? null],
  );
  if (rows.length === 0) throw new ValidationError("user not found");
  return rows[0]!;
}
