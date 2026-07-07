import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load KEY=VALUE pairs from the operator's local env files so `npm run evals`
 * works regardless of which file the keys live in (repo-root .env.local,
 * repo-root .env, or backend/.env). Real environment variables always win —
 * nothing already set is overridden, which keeps CI (where keys arrive as
 * repository secrets) unaffected. Values stay inside the process environment;
 * the harness never prints them.
 */
export function loadLocalEnv(repoRoot: string): void {
  const candidates = [".env.local", ".env", join("backend", ".env")];
  for (const rel of candidates) {
    const path = join(repoRoot, rel);
    if (!existsSync(path)) continue;
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
      );
      if (!match) continue;
      const [, key] = match;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
