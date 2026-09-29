import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://perq:perq@localhost:5432/perq_poc?schema=public";

/** Shared connection pool for the POC. */
export const pool = new Pool({ connectionString });
