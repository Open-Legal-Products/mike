// Global test bootstrap. Runs before every test file.
//
// Several modules read these at import time (createServerSupabase throws when
// they are absent, the auth middleware short-circuits to 500, downloadTokens
// throws without a signing secret). We use throwaway values because Supabase,
// storage and the LLM clients are all mocked in the route suites — nothing in
// the tests makes a real network call.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SECRET_KEY ??= "test-service-role-key";
process.env.DOWNLOAD_SIGNING_SECRET ??= "test-download-signing-secret";
process.env.FRONTEND_URL ??= "http://localhost:3000";
