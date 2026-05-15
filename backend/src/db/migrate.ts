import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

async function main(): Promise<void> {
  console.log("Running migrations against", process.env.DATABASE_URL);
  await migrate(db, { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
