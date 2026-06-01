import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    // Each test file gets a fresh module registry so vi.mock state and the
    // per-test Supabase mock never leak between route suites.
    isolate: true,
    // Clear call history between tests but keep mock implementations defined
    // in vi.mock factories (restoreMocks would wipe those).
    clearMocks: true,
  },
});
