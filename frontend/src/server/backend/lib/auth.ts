import { betterAuth } from "better-auth";
import { Pool } from "pg";

const AUTH_BASE_PATH = "/api/v1/auth";

function resolveAuthBaseUrl() {
  const rawUrl =
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.FRONTEND_URL ??
    "http://localhost:3000";

  const url = new URL(rawUrl);
  if (url.pathname === "/api/v1" || url.pathname === "/api/v1/") {
    url.pathname = AUTH_BASE_PATH;
    return url.toString().replace(/\/$/, "");
  }

  return rawUrl;
}

export const auth = betterAuth({
  baseURL: resolveAuthBaseUrl(),
  basePath: AUTH_BASE_PATH,
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "local-build-secret-change-me-please-32-chars",
  trustedOrigins: [
    process.env.FRONTEND_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000",
  ],
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  emailAndPassword: {
    enabled: true,
  },
});
