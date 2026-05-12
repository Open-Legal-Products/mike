import { defineConfig } from "drizzle-kit";

// drizzle-kit reads this file to drive `generate`, `migrate`, `push`, and
// `studio` commands. `generate` does not connect to a database, but the
// config still requires a `url` to be present, so a dummy value is fine for
// local generation when DATABASE_URL is unset.

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://x:x@localhost/x",
  },
  strict: true,
  verbose: true,
});
