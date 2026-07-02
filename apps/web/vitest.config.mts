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
    },
});
