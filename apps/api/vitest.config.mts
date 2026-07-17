import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        exclude: ["dist/**", "node_modules/**"],
        // Generous timeouts so cold-start module transform/import latency (the
        // route tests import the full Express app graph) can't cause spurious
        // timeout failures on a cold CI runner. Warm tests finish in ~1s; this
        // only guards the pathological cold case — it does not mask hangs.
        testTimeout: 20000,
        hookTimeout: 20000,
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            include: ["src/lib/**"],
            // No-regression RATCHET floor, not a target. src/lib/** spans the
            // well-tested security/core libs (access, credits, downloadTokens,
            // userApiKeys, upload, privateIp, llm/baseUrl+retry) AND the large,
            // still-untested feature libs (courtlistener, mcp, the tool
            // implementations), so the global number is low. These floors sit
            // just below current coverage so CI fails on a *drop*; raise them as
            // the feature-lib backlog gets covered. (Route/service behavior is
            // covered separately by the integration tests in src/__tests__.)
            thresholds: {
                statements: 8,
                branches: 6,
                functions: 11,
                lines: 8,
            },
        },
    },
});
