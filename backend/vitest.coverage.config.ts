import { defineConfig } from "vitest/config";
import { coverageConfigDefaults } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 65,
        functions: 65,
        branches: 60,
        statements: 65,
      },
      exclude: [
        ...coverageConfigDefaults.exclude,
        "dist/**",
        "tests/**",
        "**/*.d.ts",
        "src/index.ts",
      ],
    },
  },
});
