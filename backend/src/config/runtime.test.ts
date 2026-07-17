import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "./runtime";

const KEYS = [
    "ROSS_ENV",
    "NODE_ENV",
    "ROSS_HOSTED_MODE",
    "HOSTED_MODEL_PROVIDERS",
    "ROSS_PRODUCTION_CONTROLS_APPROVED",
    "LOG_RAW_LLM_STREAM",
    "RAW_LLM_STREAM_LOG_DIR",
    "CORS_ALLOWED_ORIGINS",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "DOWNLOAD_SIGNING_SECRET",
    "R2_ENDPOINT_URL",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
] as const;

function withEnvironment(
    values: Record<string, string | undefined>,
    run: () => void,
) {
    const previous = Object.fromEntries(
        KEYS.map((key) => [key, process.env[key]]),
    );
    try {
        for (const key of KEYS) delete process.env[key];
        for (const [key, value] of Object.entries(values)) {
            if (value !== undefined) process.env[key] = value;
        }
        run();
    } finally {
        for (const key of KEYS) {
            const value = previous[key];
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test("local mode preserves self-hosted defaults", () => {
    withEnvironment({ ROSS_ENV: "local" }, () => {
        const config = loadRuntimeConfig();
        assert.equal(config.hostedMode, "self-hosted");
        assert.deepEqual(config.hostedModelProviders, []);
    });
});

test("staging requires an explicit hosted mode and provider allowlist", () => {
    withEnvironment(
        { ROSS_ENV: "staging", CORS_ALLOWED_ORIGINS: "https://app.ross.test" },
        () =>
            assert.throws(
                () => loadRuntimeConfig(),
                /ROSS_HOSTED_MODE is required/,
            ),
    );
    withEnvironment(
        {
            ROSS_ENV: "staging",
            ROSS_HOSTED_MODE: "controlled-beta",
            CORS_ALLOWED_ORIGINS: "https://app.ross.test",
        },
        () =>
            assert.throws(
                () => loadRuntimeConfig(),
                /HOSTED_MODEL_PROVIDERS is required/,
            ),
    );
});

test("non-local raw model logging and unapproved production fail closed", () => {
    withEnvironment(
        {
            ROSS_ENV: "staging",
            ROSS_HOSTED_MODE: "controlled-beta",
            HOSTED_MODEL_PROVIDERS: "openai",
            CORS_ALLOWED_ORIGINS: "https://app.ross.test",
            LOG_RAW_LLM_STREAM: "true",
        },
        () =>
            assert.throws(
                () => loadRuntimeConfig(),
                /Raw LLM stream logging is forbidden/,
            ),
    );
    withEnvironment(
        {
            ROSS_ENV: "production",
            ROSS_HOSTED_MODE: "production",
            HOSTED_MODEL_PROVIDERS: "openai",
            CORS_ALLOWED_ORIGINS: "https://app.ross.test",
            SUPABASE_URL: "https://ross.supabase.co",
            SUPABASE_SECRET_KEY: "production-secret-value",
            DOWNLOAD_SIGNING_SECRET: "production-signing-value",
            R2_ENDPOINT_URL: "https://objects.ross.test",
            R2_ACCESS_KEY_ID: "production-access-value",
            R2_SECRET_ACCESS_KEY: "production-storage-secret",
            R2_BUCKET_NAME: "ross-production",
        },
        () =>
            assert.throws(
                () => loadRuntimeConfig(),
                /ROSS_PRODUCTION_CONTROLS_APPROVED=true/,
            ),
    );
});
