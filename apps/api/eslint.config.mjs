import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import securityPlugin from "eslint-plugin-security";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
    {
        ignores: ["dist/**", "src/**/*.test.ts", "src/**/__tests__/**"],
    },
    js.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            security: securityPlugin,
        },
        rules: {
            // TypeScript-specific
            "no-unused-vars": "off",
            // no-undef is redundant under TypeScript — tsc already resolves
            // every identifier, and the rule false-positives on type-only
            // globals like NodeJS.Timeout / NodeJS.ProcessEnv. Disabling it is
            // the typescript-eslint-recommended setup for TS-parsed files.
            "no-undef": "off",
            "no-control-regex": "warn",
            "no-useless-escape": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_" },
            ],

            // Security rules — catch common Node.js security mistakes:
            // object injection, non-literal regexes, unsafe Buffer calls, etc.
            "security/detect-object-injection": "warn",
            "security/detect-non-literal-regexp": "warn",
            "security/detect-non-literal-fs-filename": "warn",
            "security/detect-unsafe-regex": "warn",
            "security/detect-buffer-noassert": "error",
            "security/detect-child-process": "warn",
            "security/detect-disable-mustache-escape": "error",
            "security/detect-eval-with-expression": "error",
            "security/detect-new-buffer": "error",
            "security/detect-no-csrf-before-method-override": "error",
            "security/detect-possible-timing-attacks": "warn",
            "security/detect-pseudoRandomBytes": "error",

            // General quality. apps/api logs exclusively through pino; console
            // is an error so a stray console.* can't regress the structured-log
            // pipeline (it would bypass requestId correlation + redaction).
            "no-console": "error",
        },
    },
    {
        // Test files — relax some rules
        files: ["src/**/*.test.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "security/detect-object-injection": "off",
        },
    },
    {
        // Standalone Node scripts (migrations, backfills) are plain .mjs run
        // directly by node, so they get Node's globals (process, console, …).
        // Without this they only match js.configs.recommended and every
        // process/console reference trips no-undef.
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
];
