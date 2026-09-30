import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

/**
 * Shared data-access clients.
 * - `prisma` for relational reads/writes.
 * - `pool` (node-postgres) for spatial raw SQL, which Prisma can't express for PostGIS.
 *
 * Both are singletons to avoid exhausting connections in dev (Next.js hot reload).
 */
const globalForDb = globalThis as unknown as {
  prisma?: PrismaClient;
  pool?: Pool;
};

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://perq:perq@localhost:5433/perq?schema=public";

export const prisma: PrismaClient = globalForDb.prisma ?? new PrismaClient();
export const pool: Pool = globalForDb.pool ?? new Pool({ connectionString });

if (process.env.NODE_ENV !== "production") {
  globalForDb.prisma = prisma;
  globalForDb.pool = pool;
}
