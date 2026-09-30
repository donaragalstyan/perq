/**
 * Integration-test DB helpers. Require the local perq-db (docker compose up -d) on 5433.
 * These helpers TRUNCATE app tables between tests for determinism. They only ever touch the
 * local dev database (guarded below).
 */
import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://perq:perq@localhost:5433/perq?schema=public";

// Safety: refuse to run destructive helpers against anything that isn't the local dev DB.
if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  throw new Error("Integration tests must run against a local database only.");
}

export const testPool = new Pool({ connectionString });

/** Remove all app rows (keep schema). Order respects FKs; CASCADE covers the rest. */
export async function resetDb(): Promise<void> {
  await testPool.query(
    `TRUNCATE TABLE state_transitions, evidence, community_reports, discounts,
       user_credentials, businesses, users RESTART IDENTITY CASCADE;`,
  );
}

export async function closeDb(): Promise<void> {
  await testPool.end();
}

/** Insert a business (synthetic by default) and return its id. */
export async function insertBusiness(opts?: {
  name?: string;
  category?: string;
  city?: string;
  country?: string;
  lng?: number;
  lat?: number;
  source?: string;
}): Promise<string> {
  const {
    name = "[SYN] Test Biz",
    category = "CAFE",
    city = "Seattle",
    country = "US",
    lng = -122.3035,
    lat = 47.6553,
    source = "SYNTHETIC",
  } = opts ?? {};
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO businesses (id, name, category, city, country, source, location, "updatedAt")
     VALUES (gen_random_uuid(), $1, $2::"Category", $3, $4, $5::"BusinessSource",
             ST_SetSRID(ST_MakePoint($6,$7),4326)::geography, now())
     RETURNING id`,
    [name, category, city, country, source, lng, lat],
  );
  return rows[0]!.id;
}

/** Insert a user and return its id. */
export async function insertUser(authProviderId: string): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO users (id, "authProviderId") VALUES (gen_random_uuid(), $1) RETURNING id`,
    [authProviderId],
  );
  return rows[0]!.id;
}

/** Insert an UNCONFIRMED discount for a business and return its id. */
export async function insertDiscount(
  businessId: string,
  opts?: { discountType?: string; discountValue?: number; status?: string },
): Promise<string> {
  const { discountType = "PERCENT", discountValue = 15, status = "UNCONFIRMED" } =
    opts ?? {};
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO discounts (id, "businessId", "discountType", "discountValue",
        "verificationStatus", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2::"DiscountType", $3, $4::"VerificationStatus", now())
     RETURNING id`,
    [businessId, discountType, discountValue, status],
  );
  return rows[0]!.id;
}
