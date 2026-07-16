import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const env = {
  ...process.env,
  NEXT_PUBLIC_API_BASE_URL:
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://synthetic-build.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "synthetic-build-key"
};

const result = spawnSync(command, ["run", "build", "--prefix", "frontend"], {
  env,
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
