import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const isProd = process.env.NODE_ENV === "production";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required (e.g. postgres://mike:mike@localhost:5432/mike)",
  );
}

export const pool = new Pool({
  connectionString,
  // RDS Postgres requires TLS in production. We accept the AWS-managed
  // certificate without pinning the CA bundle for now; production hardening
  // is tracked in plan "Open items".
  ssl: isProd ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
