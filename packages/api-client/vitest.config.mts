import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// @mike/core ships TypeScript source (its package "main" points at src), so
// resolve the workspace alias to that source directly — mirrors how the web
// app's vitest config wires the internal packages.
const resolvePath = (relative: string) =>
    fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            {
                find: "@mike/core",
                replacement: resolvePath("../core/src/index.ts"),
            },
        ],
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        exclude: ["dist/**", "node_modules/**"],
    },
});
