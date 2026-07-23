import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const resolvePath = (relative: string) =>
    fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: {
        // Mirror the `@/*` path alias from tsconfig.json so unit tests resolve
        // the same module specifiers the app uses.
        alias: [
            {
                find: /^@\/(.*)$/,
                replacement: resolvePath("./src/$1"),
            },
        ],
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./vitest.setup.ts"],
        // app/lib/supabase.ts creates its client at module load, so any
        // component whose import graph reaches it needs these set. Dummy
        // values — unit tests never talk to Supabase.
        env: {
            NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: "test-anon-key",
        },
        // jsdom 27's CSS-color parser (@asamuzakjp/css-color) is CJS but
        // require()s the ESM-only @csstools/css-calc. That require() happens
        // in the worker process while the jsdom environment boots — before
        // Vite's transform pipeline is involved — so deps.inline can't fix it.
        // Instead, let Node itself handle require(esm): default on >=22.12,
        // and enabled by this (there harmless) flag on 22.0–22.11.
        execArgv: ["--experimental-require-module"],
        // Unit tests only. Keep any Playwright e2e specs (*.spec.ts) out.
        include: ["src/**/*.test.{ts,tsx}"],
        exclude: ["node_modules/**", "e2e/**", "**/*.spec.ts"],
        // Generous timeouts to absorb cold-start jsdom + transform latency on CI.
        testTimeout: 20000,
        hookTimeout: 20000,
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            // Ratchet the lib layer only, mirroring the backend's decision to
            // gate src/lib/**: components/hooks are exercised by their own
            // suites but not floor-gated (their coverage is UI-shaped and
            // noisy). src/app/lib/** is the client library: mikeApi (the
            // frontend half of the SSE contract), upload validation, model
            // availability, utils, and the supabase wrapper.
            include: ["src/app/lib/**"],
            exclude: ["src/app/lib/**/*.test.*"],
            // No-regression RATCHET floor, not a target. The global number is
            // dominated by mikeApi.ts: the request/error/stream plumbing and
            // message mapping are tested, but most of its ~100 thin endpoint
            // wrappers are not, so mikeApi sits around 40% while the small
            // pure libs (documentUploadValidation, modelAvailability, utils)
            // are at ~100%. Measured on this tree: 54.02% statements, 73.94%
            // branches, 32.20% functions, 52.74% lines. These floors sit just
            // below that (rounded down to whole percents) so CI fails on a
            // *drop*. Floors only go up: when you add tests, raise them in
            // the same PR. Backlog + per-area status:
            // docs/frontend-testing.md.
            thresholds: {
                statements: 54,
                branches: 73,
                functions: 32,
                lines: 52,
            },
        },
    },
});
