import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const resolvePath = (relative: string) =>
    fileURLToPath(new URL(relative, import.meta.url));

// The app pins react/react-dom 19.2.0 while the workspace root hoists a newer
// patch, so the app and the @mike/shared package would otherwise load two React
// copies — which breaks hooks with "Invalid hook call". Pin every importer to
// the single hoisted copy at the workspace root.
const reactDir = resolvePath("../../node_modules/react");
const reactDomDir = resolvePath("../../node_modules/react-dom");

export default defineConfig({
    plugins: [react()],
    resolve: {
        dedupe: ["react", "react-dom"],
        // Mirror the path aliases from tsconfig.json so unit tests resolve
        // the same module specifiers the app uses.
        alias: [
            { find: /^react$/, replacement: reactDir },
            { find: /^react\/(.*)$/, replacement: `${reactDir}/$1` },
            { find: /^react-dom$/, replacement: reactDomDir },
            { find: /^react-dom\/(.*)$/, replacement: `${reactDomDir}/$1` },
            {
                find: /^@mike\/shared\/(.*)$/,
                replacement: resolvePath("../../packages/shared/$1"),
            },
            {
                find: "@mike/api-client",
                replacement: resolvePath(
                    "../../packages/api-client/src/index.ts",
                ),
            },
            {
                find: "@mike/sdk-js",
                replacement: resolvePath("../../packages/sdk-js/src/index.ts"),
            },
            {
                find: "@mike/core",
                replacement: resolvePath("../../packages/core/src/index.ts"),
            },
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
        // jsdom 27's CSS-color parser (@asamuzakjp/css-color) is CJS but
        // require()s the ESM-only @csstools/css-calc. That require() happens
        // in the worker process while the jsdom environment boots — before
        // Vite's transform pipeline is involved — so deps.inline can't fix it.
        // Instead, let Node itself handle require(esm): default on >=22.12,
        // and enabled by this (there harmless) flag on 22.0–22.11.
        execArgv: ["--experimental-require-module"],
        // Unit tests only. Keep the Playwright e2e specs (*.spec.ts) out.
        include: ["src/**/*.test.{ts,tsx}"],
        exclude: ["node_modules/**", "e2e/**", "**/*.spec.ts"],
        // Generous timeouts to absorb cold-start jsdom + transform latency on CI.
        testTimeout: 20000,
        hookTimeout: 20000,
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            // Scope to product source; tests, generated Cloudflare types, and
            // the Playwright e2e tree are not the thing being measured.
            include: ["src/**"],
            exclude: [
                "src/**/*.test.{ts,tsx}",
                "src/**/*.spec.ts",
                "**/*.d.ts",
            ],
            // No-regression RATCHET floor, not a target — mirrors apps/api. The
            // floors sit just below current coverage so CI fails on a *drop*,
            // and get raised as the web test backlog gets covered.
            //
            // Measured 2026-07-05 (16 test files, 54 tests): statements 2.11,
            // branches 1.97, functions 1.76, lines 2.18. The number is low
            // because src/** spans the whole app while tests currently focus
            // on hooks/parsers; the floor's job is only to catch a drop.
            // When you add web tests, re-run `npm run test:coverage` and raise
            // these to just below the new numbers.
            thresholds: {
                statements: 2,
                branches: 1.8,
                functions: 1.6,
                lines: 2,
            },
        },
    },
});
